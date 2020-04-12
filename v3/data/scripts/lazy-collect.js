'use strict';

chrome.runtime.sendMessage({
  method: 'collect'
}, links => {
  if (links.length) {
    if (window.confirm(
      `Confirm storing ${links.length} links:\n\n` + links.map((s, i) => `${('00' + (i + 1)).substr(-2)}. ${s}`).join('\n')
    )) {
      chrome.runtime.sendMessage({
        method: 'store-links',
        links
      });
    }
  }
  else {
    alert('There is no media link in this tab');
  }
});
