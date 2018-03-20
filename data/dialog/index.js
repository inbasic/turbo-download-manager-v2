/* globals dom, popup */
'use strict';

var args = location.search.substr(1).split('&').reduce((p, c) => {
  const [key, value] = c.split('=');
  p[key] = decodeURIComponent(value);
  return p;
}, {});

const add = (() => {
  const t = document.getElementById('entry');
  const list = document.getElementById('list');

  const threads = {
    audio: dom.storage.get('thread-audio', 1),
    video: dom.storage.get('thread-video', 2),
    image: dom.storage.get('thread-image', 1),
    other: dom.storage.get('thread-other', 2)
  };

  return ({url, mime = '', checked = true}) => {
    const clone = document.importNode(t.content, true);
    clone.querySelector('input[name=url]').value = url;
    clone.querySelector('input[name=threads]').value = threads[mime.split('/')[0]] || 1;
    clone.querySelector('input[type=checkbox]').checked = checked;
    list.appendChild(clone);
    list.dispatchEvent(new Event('change', {
      bubbles: true
    }));
  };
})();

if (args.tabId) {
  chrome.tabs.executeScript(Number(args.tabId), {
    code: 'list',
    runAt: 'document_start',
    matchAboutBlank: true,
    allFrames: true
  }, arr => {
    if (chrome.runtime.lastError === undefined) {
      [].concat.apply([], arr).filter((s, i, l) => s && l.indexOf(s) === i)
        .forEach(obj => add(obj));
    }
  });
}
else {
  console.log('no tab id is provided');
}

const jobs = () => [...document.querySelectorAll('#list input[type=checkbox]:checked')]
  .map(e => e.parentNode)
  .map(e => ({
    url: e.querySelector('[name=url]').value,
    filename: e.querySelector('[name=filename]').value,
    threads: Math.min(5, Number(e.querySelector('[name=threads]').value)),
  }));

dom.$('download').on('submit', e => {
  e.preventDefault();

  popup.post({
    method: 'download',
    jobs: jobs()
  }).then(() => window.close());
});
dom.$('add').on('submit', e => {
  e.preventDefault();

  add({
    url: e.target.querySelector('[name=url]').value
  });
});
dom.$('copy').on('click', () => {
  document.oncopy = e => {
    const urls = jobs().map(o => o.url);
    e.clipboardData.setData('text/plain', urls.join('\n'));
    e.preventDefault();
    popup.notify(urls.length + ' URL(s) copied to the clipboard');
  };
  document.execCommand('Copy', false, null);
});
{
  const select = val => {
    [...document.querySelectorAll('#list input[type=checkbox]')].forEach(e => {
      e.checked = val;
      e.dispatchEvent(new Event('change', {
        bubbles: true
      }));
    });
  };
  dom.$$('[data-cmd=select-all]').on('click', () => select(true));
  dom.$$('[data-cmd=select-none]').on('click', () => select(false));
}
