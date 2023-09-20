/* globals dom */
'use strict';

dom.set({
  'thread-audio': dom.storage.get('thread-audio', 1),
  'thread-video': dom.storage.get('thread-video', 2),
  'thread-image': dom.storage.get('thread-image', 1),
  'thread-other': dom.storage.get('thread-other', 2),
  'timeout': dom.storage.get('timeout', 30),
  'retry-max': dom.storage.get('retry-max', 30),
  'segment-max': dom.storage.get('segment-max', 1024),
  'segment-min': dom.storage.get('segment-min', 50),
  'speed-cache': dom.storage.get('speed-cache', 10),
});

dom.$$('form').on('submit', e => {
  e.preventDefault();

  dom.storage.set({
    'thread-audio': dom.$('thread-audio').value,
    'thread-video': dom.$('thread-video').value,
    'thread-image': dom.$('thread-image').value,
    'thread-other': dom.$('thread-other').value,
    'timeout': dom.$('timeout').value,
    'retry-max': dom.$('retry-max').value,
    'segment-max': dom.$('segment-max').value,
    'segment-min': dom.$('segment-min').value,
    'speed-cache': dom.$('speed-cache').value,
  });

  const info = dom.$('info', 'textContent');
  info.value = 'options saved';
  window.setTimeout(() => info.value = '', 750);
});

dom.$('support').on('click', () => chrome.tabs.open({
  url: chrome.runtime.getManifest().homepage_url + '?rd=donate'
}));

dom.$('reset').on('click', () => {
  localStorage.clear();
  chrome.storage.local.clear(() => {
    chrome.runtime.reload();
    window.close();
  });
});
