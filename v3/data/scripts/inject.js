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
  if (append.links.length > 50) {
    append.links.splice(0, append.links.length - 50);
  }
};
append.links = [];
append.notified = false;

document.addEventListener('canplay', ({target}) => {
  append([target, ...target.querySelectorAll('source')].map(s => s.src).filter(s => s));
}, true);

const script = document.createElement('script');
script.addEventListener('append', e => {
  append([e.detail]);
  e.stopPropagation();
});
script.textContent = `{
  const open = XMLHttpRequest.prototype.open;
  const script = document.currentScript;
  XMLHttpRequest.prototype.open = function (method, url) {
    open.apply(this, arguments);
    this.addEventListener('readystatechange', function _() {
      if(this.readyState == this.HEADERS_RECEIVED) {
        const contentType = this.getResponseHeader('Content-Type') || '';
        if (contentType.startsWith('video/') || contentType.startsWith('audio/')) {
          script.dispatchEvent(new CustomEvent('append', {
            detail: url
          }));
        }
        this.removeEventListener('readystatechange', _);
      }
    })
  }
}`;
document.documentElement.appendChild(script);
script.remove();
