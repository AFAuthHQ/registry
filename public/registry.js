// Copy-to-clipboard for [data-copy] buttons. Served as a static file
// (not inlined) so the page can run under a strict `script-src 'self'`
// Content-Security-Policy.
(function () {
  document.querySelectorAll('button[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var text = btn.getAttribute('data-copy') || '';
      var label = btn.querySelector('[data-copy-label]');
      var original = label ? label.textContent : 'Copy';
      var done = function () {
        if (!label) return;
        label.textContent = 'Copied';
        btn.classList.add('copied');
        setTimeout(function () {
          label.textContent = original;
          btn.classList.remove('copied');
        }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(done);
      } else {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(ta);
        done();
      }
    });
  });
})();
