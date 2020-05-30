/**
    Turbo Download Manager - .A download manager with the ability to pause and resume downloads

    Copyright (C) 2014-2020 [InBasic](https://add0n.com/turbo-download-manager-v2.html)

    This program is free software: you can redistribute it and/or modify
    it under the terms of the Mozilla Public License as published by
    the Mozilla Foundation, either version 2 of the License, or
    (at your option) any later version.
    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    Mozilla Public License for more details.
    You should have received a copy of the Mozilla Public License
    along with this program.  If not, see {https://www.mozilla.org/en-US/MPL/}.

    GitHub: https://github.com/inbasic/turbo-download-manager-v2/
    Homepage: https://add0n.com/turbo-download-manager-v2.html
*/

'use strict';

if (location.href.indexOf('?popup') !== -1) {
  document.body.dataset.popup = true;
}

const icon = d => {
  const i = icon.cache[d.mime];
  if (i) {
    return Promise.resolve(i);
  }
  return new Promise(resolve => chrome.runtime.sendMessage({
    method: 'get-icon',
    id: d.id
  }, iconURL => {
    icon.cache[d.mime] = iconURL;
    resolve(iconURL || 'download.png');
  }));
};
icon.cache = {};

const entry = d => {
  const e = document.createElement('download-item');
  e.id = d.id;
  e.once(d);
  e.update(d);
  icon(d).then(iconURL => e.preview(iconURL));

  return e;
};

const entries = ds => {
  const f = document.createDocumentFragment();
  for (const d of ds) {
    f.appendChild(entry(d));
  }
  const parent = document.getElementById('entries');
  parent.insertBefore(f, parent.firstChild);
};
// start
chrome.runtime.sendMessage({
  method: 'popup_ready'
}, entries);

chrome.runtime.onMessage.addListener(request => {
  if (request.method === 'batch-update') {
    const ds = [];
    for (const d of request.ds) {
      const e = document.getElementById(d.id);
      if (e) {
        e.update(d);
      }
      else {
        ds.push(d);
      }
    }
    // attach new entries
    entries(ds);
  }
  else if (request.method === 'convert-to-native') {
    const e = document.getElementById(request.id);
    e.id = request.native.id; // convert to the native id
    e.update(request.native);
    e.once(request.native);
    icon(request.native).then(iconURL => e.preview(iconURL));
  }
  // calls after filename is resolved
  else if (request.method === 'prepare-one') {
    const e = document.getElementById(request.d.id);
    e.once(request.d);
  }
});

// toolbar commands
document.addEventListener('click', e => {
  const command = e.target.dataset.command;
  if (command === 'add-new') {
    const input = document.getElementById('clipboard');
    input.classList.remove('hidden');
    input.focus();
    input.value = '';
    document.execCommand('paste');
    input.classList.add('hidden');
    // extract links
    chrome.runtime.sendMessage({
      method: 'extract-links',
      content: input.value
    }, links => chrome.runtime.sendMessage({
      method: 'open-jobs',
      jobs: [...links, ...(e.target.links || [])].filter(a => a).map(link => ({link}))
    }));
  }
  else if (command === 'detach') {
    chrome.tabs.create({
      url: '/data/manager/index.html'
    }, () => window.close());
  }
  else if (command === 'clear-complete' || command === 'clear-interrupted') {
    if (e.shiftKey) {
      [...document.querySelectorAll('download-item')].filter(o => o.entry.dataset.paused === 'true').forEach(o => {
        o.entry.querySelector('[data-command="cancel"]').click();
      });
    }
    else {
      chrome.runtime.sendMessage({
        method: 'erase',
        query: {
          state: command.replace('clear-', '')
        }
      }, ids => {
        for (const id of ids) {
          const e = document.getElementById(id);
          if (e) {
            e.remove();
          }
        }
      });
    }
  }
});

// per item command
document.getElementById('entries').addEventListener('command', e => {
  const command = e.detail;
  const id = Number(e.target.id);

  if (command === 'erase') {
    chrome.runtime.sendMessage({
      method: command,
      query: {
        id
      }
    });
    e.target.remove();
  }
  else if (['resume', 'pause', 'cancel'].some(a => a === command)) {
    chrome.runtime.sendMessage({
      method: command,
      id
    }, d => e.target.update(d));
  }
  else if (command === 'open') {
    chrome.downloads.open(id);
  }
  else if (command === 'show') {
    chrome.downloads.show(id);
  }
  else if (command === 'retry') {
    chrome.runtime.sendMessage({
      method: 'retry',
      id
    });
  }
  else if ([
    'zip-manager', 'json-beautifier', 'pdf-reader', 'epub-reader', 'convert-to-mp3',
    'image-vectorizer', 'image-to-base64', 'png-optimizer',
    'video-converter', 'audio-converter'
  ].some(a => a === command)) {
    chrome.tabs.create({
      url: 'https://webbrowsertools.com/' + command
    });
  }
  else if (command === 'start') {
    chrome.runtime.sendMessage({
      method: 'start',
      id
    }, () => e.target.remove());
  }
});

// media links
chrome.runtime.sendMessage({
  method: 'collect'
}, links => {
  if (links && links.length) {
    const e = document.querySelector('[data-command="add-new"]');
    e.dataset.value = links.length;
    e.links = links;
  }
});

// confirm
chrome.permissions.contains({
  permissions: ['webRequest']
}, result => {
  if (result === false) {
    chrome.storage.local.get({
      'webRequest.confirm': true
    }, prefs => {
      if (prefs['webRequest.confirm']) {
        document.getElementById('confirm').classList.remove('hidden');
      }
    });
  }
});
document.querySelector('#confirm span[data-command=no]').addEventListener('click', () => chrome.storage.local.set({
  'webRequest.confirm': false
}));
document.querySelector('#confirm span[data-command=yes]').addEventListener('click', () => chrome.permissions.request({
  permissions: ['webRequest']
}, granted => {
  document.getElementById('confirm').classList.add('hidden');
  if (granted) {
    chrome.runtime.getBackgroundPage(bg => bg.webRequest.install());
  }
}));
