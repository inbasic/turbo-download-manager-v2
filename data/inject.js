'use strict';

var list = [];

var isTop = window.top === window;
var counts = {};

var report = () => {
  const count = Object.values(counts).reduce((p, c) => p + c, list.length);
  chrome.runtime.sendMessage({
    method: 'badge',
    count
  });
};

var append = objs => {
  const cache = {};
  list = [...list, ...objs].filter(({url}) => {
    // do not allow YouTube downloading
    if (url in cache || url.indexOf('googlevideo.') !== -1) {
      return false;
    }
    else {
      cache[url] = null;
      return true;
    }
  }).filter(({url}) => {
    return url.startsWith('data:') || url.startsWith('http:')  || url.startsWith('https:') || url.startsWith('ftp:');
  }).slice(-300); // limit to 300 entries
  if (isTop) {
    report();
  }
  else {
    chrome.runtime.sendMessage({
      method: 'count',
      count: list.length
    });
  }
};

chrome.runtime.onMessage.addListener((request, sender) => {
  if (request.method === 'count') {
    counts[request.frameId] = request.count;
    report();
  }
  else if (request.method === 'collect') {
    chrome.tabs.sendMessage(sender.tab.id, {
      method: 'collection',
      list
    });
  }
  else if (request.method === 'reset-counter') {
    list = [];
    counts = {};
    if (isTop) {
      report();
    }
  }
});

window.addEventListener('message', e => {
  if (e.data && e.data.source === 'xmlhttprequest-open') {
    append([{
      url: e.data.url,
      mime: e.data.mime,
    }]);
  }
});

document.addEventListener('canplay', ({target}) => {
  append([target, ...target.querySelectorAll('source')].map(s => ({
    url: s.src,
    mime: s.type || 'video/unknown'
  })).filter(s => s.url));
}, true);

document.documentElement.appendChild(Object.assign(document.createElement('script'), {
  textContent: `
  {
    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      open.apply(this, arguments);
      this.addEventListener('readystatechange', function _() {
        if(this.readyState == this.HEADERS_RECEIVED) {
          const contentType = this.getResponseHeader('Content-Type') || '';
          if (contentType.startsWith('video/') || contentType.startsWith('audio/')) {
            window.postMessage({
              source: 'xmlhttprequest-open',
              url,
              mime: contentType,
              method,
              contentType
            }, '*');
          }
          this.removeEventListener('readystatechange', _);
        }
      })
    }
  }
  `
}));
