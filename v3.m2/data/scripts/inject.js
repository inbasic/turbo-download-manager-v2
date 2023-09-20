const prefs = {
  'cache.size': 100
};

const append = links => {
  for (const link of links) {
    if (link && link.startsWith('http') && append.links.indexOf(link) === -1) {
      append.links.push(link);
      if (append.notified !== true) {
        append.notified = true;
        chrome.runtime.sendMessage({
          method: 'media-available'
        });
      }
    }
  }
  if (append.links.length > prefs['cache.size']) {
    append.links.splice(0, append.links.length - prefs['cache.size']);
  }
};
append.links = [];
append.notified = false;

// from page
document.addEventListener('canplay', ({target}) => {
  append([target, ...target.querySelectorAll('source')].map(s => s.src).filter(s => s));
}, true);

// from bg
chrome.runtime.onMessage.addListener((request, sender, response) => {
  if (request.method === 'media') {
    append([request.link]);
  }
  else if (request.method === 'fetch') {
    if (request.type === 'text') {
      fetch(request.link).then(r => {
        if (r.ok) {
          r.text().then(response);
        }
      });
    }
    else {
      fetch(request.link).then(r => {
        if (r.ok) {
          r.arrayBuffer().then(ab => response([...new Uint8Array(ab)]));
        }
      });
    }
    return true;
  }
});

// init
chrome.storage.local.get(prefs, ps => Object.assign(prefs, ps));
