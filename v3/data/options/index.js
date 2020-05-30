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
  const cache = Math.min(1000, Math.max(1, Number(document.getElementById('cache.size').value)));
  const queue = Math.min(1000, Math.max(1, Number(document.getElementById('queue.size').value)));
  chrome.storage.local.set({
    'cache.size': cache,
    'queue.size': queue
  }, () => {
    document.getElementById('cache.size').value = cache;
    document.getElementById('queue.size').value = queue;
    toast.textContent = 'Options saved';
    window.setTimeout(() => toast.textContent = '', 750);
  });
});

chrome.storage.local.get({
  'cache.size': 100,
  'queue.size': 3
}, prefs => {
  document.getElementById('cache.size').value = prefs['cache.size'];
  document.getElementById('queue.size').value = prefs['queue.size'];
});
