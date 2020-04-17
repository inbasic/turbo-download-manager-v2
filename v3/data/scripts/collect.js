'use strict';

chrome.runtime.sendMessage({
  method: 'collect'
}, links => {
  if (links.length) {
    chrome.runtime.sendMessage({
      method: 'open-jobs',
      jobs: links.map(link => ({link}))
    });
  }
  else {
    alert('There is no media link in this tab');
  }
});
