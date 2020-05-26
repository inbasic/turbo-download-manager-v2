'use strict';

const toast = document.getElementById('toast');

// reset
document.getElementById('reset').addEventListener('click', e => {
  if (e.detail === 1) {
    toast.textContent = 'Double-click to reset!';
    window.setTimeout(() => toast.textContent = '', 750);
  }
  else {
    localStorage.clear();
    chrome.storage.local.clear(() => {
      chrome.runtime.reload();
      window.close();
    });
  }
});
// support
document.getElementById('support').addEventListener('click', () => chrome.tabs.create({
  url: chrome.runtime.getManifest().homepage_url + '?rd=donate'
}));
// save
document.getElementById('save').addEventListener('click', () => {
  const size = Math.min(1000, Math.max(1, Number(document.getElementById('cache.size').value)));
  chrome.storage.local.set({
    'cache.size': size
  }, () => {
    document.getElementById('cache.size').value = size;
    toast.textContent = 'Options saved';
    window.setTimeout(() => toast.textContent = '', 750);
  });
});


document.getElementById('webRequest').addEventListener('click', () => chrome.permissions.request({
  permissions: ['webRequest']
}, granted => {
  if (granted) {
    chrome.runtime.getBackgroundPage(bg => bg.webRequest.install());
  }
  toast.textContent = 'webRequest permission is ' + (granted ? 'granted' : 'rejected');
  window.setTimeout(() => toast.textContent = '', 750);
}));

chrome.storage.local.get({
  'cache.size': 100
}, prefs => document.getElementById('cache.size').value = prefs['cache.size']);
