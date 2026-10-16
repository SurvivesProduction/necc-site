(function () {
  'use strict';

  var loadedAt = Date.now();
  var form = document.getElementById('estimate-form');
  var thanks = document.getElementById('thanks');
  var formError = document.getElementById('form-error');
  var btn = document.getElementById('submit-btn');
  document.getElementById('yr').textContent = new Date().getFullYear();

  // Source: ?src= if present and sane, otherwise the postcard default (direct landing).
  var srcParam = new URLSearchParams(location.search).get('src') || '';
  var source = /^[a-z0-9_-]{1,40}$/i.test(srcParam) ? srcParam : 'postcard-2026-10';
  document.getElementById('src').value = source;

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

  // Light formatting as they type: (860) 555-0123
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
    var needs = form.querySelectorAll('input[name="needs"]:checked');
    check('needs', !needs.length, form.querySelector('input[name="needs"]'));
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

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    formError.hidden = true;
    if (!validate()) return;

    var endpoint = window.NECC_ENDPOINT;
    if (!endpoint) {
      showFormError('This form isn’t connected yet. Please call (860) 481-5640 and we’ll help you right away.');
      return;
    }

    var f = form.elements;
    var payload = {
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

    // text/plain keeps this a "simple" request, so the browser skips the CORS preflight Apps Script can't answer.
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && res.ok) {
          form.hidden = true;
          thanks.hidden = false;
          thanks.focus();
          window.scrollTo(0, 0);
        } else {
          showFormError((res && res.error) || 'Something went wrong. Please try again or call (860) 481-5640.');
        }
      })
      .catch(function () {
        showFormError('We couldn’t send that. Please check your connection and try again, or call (860) 481-5640.');
      })
      .then(function () { btn.disabled = false; btn.textContent = label; });
  });
})();
