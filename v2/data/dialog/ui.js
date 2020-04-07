'use strict';

// select an entry when clicked
document.addEventListener('click', ({target}) => {
  const entry = target.closest('.entry');
  if (entry) {
    const e = entry.querySelector('input[type=checkbox]');
    if (e !== target) {
      e.checked = true;
      e.dispatchEvent(new Event('change', {
        bubbles: true
      }));
    }
  }
});
// enable the Download button
{
  const submit = document.querySelector('#download [type=submit]');
  const copy = document.getElementById('copy');
  document.addEventListener('change', () => {
    const active = Boolean(document.querySelector('#list input[type=checkbox]:checked'));
    copy.disabled = submit.disabled = active === false;
  });
}
// paste HTTP and HTTPS links from clipboard
window.addEventListener('load', () => {
  const url = document.querySelector('#add [name=url]');
  url.focus();
  if (document.execCommand('paste') && url.value) {
    url.value = url.value.trim();
    if (url.value.startsWith('http') === false) {
      url.value = '';
    }
    else {
      url.select();
    }
  }
});
