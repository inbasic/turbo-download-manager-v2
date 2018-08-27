/* globals args, add, popup, dom */
'use strict';

document.getElementById('image').addEventListener('click', () => {
  chrome.tabs.executeScript(Number(args.tabId), {
    code: String.raw`
      [
        ...[...document.images].map(img => img.src),
        ...[...document.querySelectorAll('*')]
          .filter(e => e.style.backgroundImage)
          .map(e => e.style.backgroundImage)
          .filter(i => i.startsWith('url'))
          .map(i => i.replace(/^url\(['"]*/, '').replace(/['"]*\)$/, ''))
          .map(i => i.startsWith('//') ? document.location.protocol + i : i)
          .map(i => i.startsWith('/') ? document.location.origin + i : i)
          .filter((img, i, l) => l.indexOf(img) === i)
      ]
    `
  }, arr => {
    const lastError = chrome.runtime.lastError;
    if (lastError) {
      return popup.notify(lastError.message);
    }
    [].concat([], ...arr).filter((s, i, l) => s && l.indexOf(s) === i)
      .forEach(url => add({
        url,
        mime: 'image'
      }));
  });
});
