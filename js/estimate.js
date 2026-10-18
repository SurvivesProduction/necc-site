(function () {
  'use strict';

  var TIMEOUT_MS = 10000;      // per attempt
  var RETRY_DELAY_MS = 2000;   // one automatic retry after backend failure
  var PENDING_KEY = 'necc_pending_submission';
  var FALLBACK_TO = 'estimates@neccbuilds.com';

  var loadedAt = Date.now();
  var form = document.getElementById('estimate-form');
  var thanks = document.getElementById('thanks');
  var fallback = document.getElementById('fallback');
  var formError = document.getElementById('form-error');
  var btn = document.getElementById('submit-btn');
  document.getElementById('yr').textContent = new Date().getFullYear();

  // Source: ?src= if present and sane, otherwise the postcard default (direct landing).
  var srcParam = new URLSearchParams(location.search).get('src') || '';
  var source = /^[a-z0-9_-]{1,40}$/i.test(srcParam) ? srcParam : 'postcard-2026-10';
  document.getElementById('src').value = source;

  // ---- Web-app URL -------------------------------------------------------
  function endpoint() {
    // TEST HOOK (filming/QA only): /estimate/?backend=dead swaps in a deliberately invalid URL so the
    // "backend is down" fallback can be demonstrated. It is ignored on every host except localhost/127.0.0.1.
    var h = location.hostname;
    if ((h === 'localhost' || h === '127.0.0.1') && new URLSearchParams(location.search).get('backend') === 'dead') {
      return 'https://backend-dead.invalid/exec';
    }
    return window.NECC_ENDPOINT || '';
  }

  // ---- Validation (client side) -------------------------------------------
  var ERR = {
    name: 'Please enter your name.',
    address: 'Please enter the address of the home that needs work.',
    phone: 'Please enter a 10-digit US phone number.',
    email: 'That email address doesn’t look right.',
    needs: 'Please pick at least one.',
    time: 'Please pick a time for our call.',
    consent: 'Please check the box so we can call you back.',
    signature: 'Please type your full name as your signature.'
  };

  function digits10(v) {
    var d = String(v).replace(/\D/g, '');
    if (d.length === 11 && d.charAt(0) === '1') d = d.slice(1);
    return d.length === 10 && /^[2-9]/.test(d) ? d : null;
  }

  var phone = document.getElementById('phone');
  phone.addEventListener('blur', function () {
    var d = digits10(phone.value);
    if (d) phone.value = '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
  });

  function setErr(key, msg, el) {
    var p = document.getElementById('err-' + key);
    if (!p) return;
    p.textContent = msg || '';
    p.hidden = !msg;
    if (el) { el.classList.toggle('invalid', !!msg); el.setAttribute('aria-invalid', msg ? 'true' : 'false'); }
  }

  function validate() {
    var f = form.elements;
    var firstBad = null;
    function check(key, bad, el) {
      setErr(key, bad ? ERR[key] : '', el);
      if (bad && !firstBad) firstBad = el || document.getElementById(key);
    }
    check('name', !f.name.value.trim(), f.name);
    check('address', !f.property_address.value.trim(), f.property_address);
    check('phone', !digits10(f.phone.value), f.phone);
    var em = f.email.value.trim();
    check('email', em && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em), f.email);
    check('needs', !form.querySelectorAll('input[name="needs"]:checked').length, form.querySelector('input[name="needs"]'));
    check('time', !form.querySelector('input[name="best_time"]:checked'), form.querySelector('input[name="best_time"]'));
    check('consent', !f.consent.checked, f.consent);
    check('signature', !f.signature_name.value.trim(), f.signature_name);
    if (firstBad) firstBad.focus();
    return !firstBad;
  }

  function showFormError(msg) {
    formError.textContent = msg;
    formError.hidden = false;
    formError.focus();
  }

  // ---- Sending -------------------------------------------------------------
  // One attempt. Resolves {kind:'ok'} | {kind:'validation', error} | {kind:'backend'}; never rejects.
  // Backend failure = network error, timeout, non-2xx, unparseable JSON, {ok:false, code:'BACKEND'},
  // or any response we don't recognise. We never treat "no error thrown" as success: only {ok:true} is.
  function attempt(url, payload) {
    if (!url) return Promise.resolve({ kind: 'backend' });
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, TIMEOUT_MS);
    // text/plain keeps this a "simple" request (no CORS preflight); fetch follows Apps Script's 302 to the response.
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: ctl.signal
    })
      .then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status);
        return r.json();
      })
      .then(function (res) {
        if (res && res.ok === true) return { kind: 'ok' };
        if (res && res.ok === false && res.code === 'VALIDATION') return { kind: 'validation', error: res.error };
        return { kind: 'backend' };
      })
      .catch(function () { return { kind: 'backend' }; })
      .then(function (out) { clearTimeout(timer); return out; });
  }

  function sendWithRetry(url, payload) {
    return attempt(url, payload).then(function (r) {
      if (r.kind !== 'backend') return r;
      return new Promise(function (res) { setTimeout(res, RETRY_DELAY_MS); }).then(function () { return attempt(url, payload); });
    });
  }

  // ---- Saved-for-later (localStorage, always in try/catch) --------------------
  function savePending(payload) { try { localStorage.setItem(PENDING_KEY, JSON.stringify(payload)); } catch (e) { /* private mode etc. */ } }
  function clearPending() { try { localStorage.removeItem(PENDING_KEY); } catch (e) { /* ignore */ } }
  function loadPending() {
    try {
      var p = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
      return p && typeof p === 'object' && p.submission_id ? p : null;
    } catch (e) { return null; }
  }

  // Quietly resend a request that failed earlier. The server ignores a repeated submission_id, so this
  // can never create a second row; and a successful send clears it, so it is never resent after success.
  var pending = loadPending();
  if (pending) {
    attempt(endpoint(), pending).then(function (r) {
      if (r.kind === 'ok') clearPending();
      else if (r.kind === 'validation') { clearPending(); } // the server will never accept it; the mailto fallback already carried it
    });
  }

  // ---- Fallback screen -----------------------------------------------------
  function mailtoFor(p) {
    var body = [
      'Estimate request (sent from the website form fallback)',
      '',
      'Name: ' + p.name,
      'Property address: ' + p.property_address,
      'Phone: ' + p.phone,
      'Email: ' + (p.email || '(none)'),
      'Needs: ' + p.needs.join(', '),
      'Best time for a call: ' + p.best_time,
      'Notes: ' + (p.notes || '(none)'),
      'Source: ' + p.source,
      '',
      'Callback permission, exact wording shown on the form:',
      '"' + p.consent_text + '"',
      'Box checked: ' + (p.consent ? 'Yes' : 'No'),
      'Signature (typed): ' + p.signature_name,
      '',
      'Reference: ' + p.submission_id
    ].join('\r\n');
    return 'mailto:' + FALLBACK_TO + '?subject=' + encodeURIComponent('Estimate request (form fallback)') + '&body=' + encodeURIComponent(body);
  }

  function showFallback(p) {
    form.hidden = true;
    document.getElementById('fallback-mailto').setAttribute('href', mailtoFor(p));
    var dl = document.getElementById('fallback-answers');
    dl.textContent = '';
    [['Name', p.name], ['Property address', p.property_address], ['Phone', p.phone], ['Email', p.email || '(none)'],
     ['What you need', p.needs.join(', ')], ['Best time for a call', p.best_time], ['Anything else', p.notes || '(none)'],
     ['Callback permission', p.consent_text], ['Signature', p.signature_name]].forEach(function (kv) {
      var dt = document.createElement('dt'); dt.textContent = kv[0];
      var dd = document.createElement('dd'); dd.textContent = kv[1];   // textContent: never HTML
      dl.appendChild(dt); dl.appendChild(dd);
    });
    fallback.hidden = false;
    fallback.focus();
    window.scrollTo(0, 0);
  }

  // ---- Submit ----------------------------------------------------------------
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    formError.hidden = true;
    if (!validate()) return;

    var f = form.elements;
    var payload = {
      submission_id: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2)),
      name: f.name.value.trim(),
      property_address: f.property_address.value.trim(),
      phone: f.phone.value.trim(),
      email: f.email.value.trim(),
      needs: Array.prototype.map.call(form.querySelectorAll('input[name="needs"]:checked'), function (i) { return i.value; }),
      notes: f.notes.value.trim(),
      best_time: form.querySelector('input[name="best_time"]:checked').value,
      source: f.source.value,
      consent: f.consent.checked,
      // Exact wording shown on the page, read from the DOM so the record can't drift from what they saw.
      consent_text: document.getElementById('consent-text').textContent.trim(),
      signature_name: f.signature_name.value.trim(),
      user_agent: navigator.userAgent,
      company_website: f.company_website.value, // honeypot
      elapsed_ms: Date.now() - loadedAt
    };

    btn.disabled = true;
    var label = btn.textContent;
    btn.textContent = 'Sending…';

    sendWithRetry(endpoint(), payload).then(function (r) {
      if (r.kind === 'ok') {
        clearPending();
        form.hidden = true;
        thanks.hidden = false;
        thanks.focus();
        window.scrollTo(0, 0);
      } else if (r.kind === 'validation') {
        showFormError(r.error || 'Please check the form and try again.');
      } else {
        savePending(payload);   // resent automatically next time this page loads
        showFallback(payload);
      }
      btn.disabled = false;
      btn.textContent = label;
    });
  });
})();
