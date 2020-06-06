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
    'queue.size': queue,
    'context.extract-links': document.getElementById('context.extract-links').checked,
    'context.download-link': document.getElementById('context.download-link').checked,
    'context.store-link': document.getElementById('context.store-link').checked,
    'context.download-image': document.getElementById('context.download-image').checked,
    'context.store-image': document.getElementById('context.store-image').checked,
    'context.download-media': document.getElementById('context.download-media').checked,
    'context.store-media': document.getElementById('context.store-media').checked,
    'context.extract-requests': document.getElementById('context.extract-requests').checked
  }, () => {
    document.getElementById('cache.size').value = cache;
    document.getElementById('queue.size').value = queue;
    toast.textContent = 'Options saved';
    window.setTimeout(() => toast.textContent = '', 750);
  });
});

chrome.storage.local.get({
  'cache.size': 100,
  'queue.size': 3,
  'context.extract-links': true,
  'context.download-link': true,
  'context.store-link': true,
  'context.download-image': true,
  'context.store-image': true,
  'context.download-media': true,
  'context.store-media': true,
  'context.extract-requests': true
}, prefs => {
  document.getElementById('cache.size').value = prefs['cache.size'];
  document.getElementById('queue.size').value = prefs['queue.size'];
  document.getElementById('context.extract-links').checked = prefs['context.extract-links'];
  document.getElementById('context.download-link').checked = prefs['context.download-link'];
  document.getElementById('context.store-link').checked = prefs['context.store-link'];
  document.getElementById('context.download-image').checked = prefs['context.download-image'];
  document.getElementById('context.store-image').checked = prefs['context.store-image'];
  document.getElementById('context.download-media').checked = prefs['context.download-media'];
  document.getElementById('context.store-media').checked = prefs['context.store-media'];
  document.getElementById('context.extract-requests').checked = prefs['context.extract-requests'];
});
