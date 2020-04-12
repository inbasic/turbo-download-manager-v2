'use strict';

chrome.runtime.sendMessage({
  method: 'collect'
}, links => {
  if (links.length) {
    if (window.confirm(
      `Confirm Downloading ${links.length} links:\n\n` + links.map((s, i) => `${('00' + (i + 1)).substr(-2)}. ${s}`).join('\n')
    )) {
      chrome.runtime.sendMessage({
        method: 'add-jobs',
        jobs: links.map(link => ({
          link,
          threads: 3
        }))
      });
    }
  }
  else {
    alert('There is no media link in this tab');
  }
});
