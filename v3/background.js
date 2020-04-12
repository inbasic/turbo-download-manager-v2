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

/* global manager */

'use strict';

const CONFIG = {
  'use-native-when-possible': true,
  'min-segment-size': 100 * 1024,
  'max-segment-size': 100 * 1024 * 1024, // max size for a single downloading segment
  'overwrite-segment-size': true,
  'max-number-of-threads': 3,
  'max-retires': 10,
  'speed-over-seconds': 10,
  'max-simultaneous-writes': 3
};

const notify = e => chrome.notifications.create({
  type: 'basic',
  iconUrl: '/data/icons/48.png',
  title: chrome.runtime.getManifest().name,
  message: e.message || e
});

chrome.runtime.onMessage.addListener((request, sender, response) => {
  if (request.method === 'popup_ready') {
    Promise.all([
      new Promise(resolve => manager.search({state: 'not_started'}, resolve)),
      new Promise(resolve => manager.search({state: 'transfer'}, resolve)),
      new Promise(resolve => manager.search({state: 'interrupted'}, resolve)),
      new Promise(resolve => manager.search({state: 'complete'}, resolve))
    ]).then(arr => {
      response(arr.flat());
      update.perform();
    });
    return true;
  }
  else if (request.method === 'search') {
    manager.search(request.query, ds => {
      response(ds);
    });
    return true;
  }
  else if (request.method === 'erase') {
    manager.erase(request.query, response);
    return true;
  }
  else if (request.method === 'cancel' || request.method === 'resume' || request.method === 'pause') {
    manager[request.method](request.id, () => manager.search({
      id: request.id
    }, ds => response(ds[0])));
    return true;
  }
  else if (request.method === 'get-icon') {
    manager.getFileIcon(request.id, {
      size: 32
    }, response);
    return true;
  }
  else if (request.method === 'add-jobs') {
    if (request.jobs.length) {
      for (const {link, threads} of request.jobs) {
        manager.download({
          url: link
        }, undefined, {
          ...CONFIG,
          'max-number-of-threads': threads ? Math.min(8, threads) : 3
        });
      }
    }
    else {
      notify('There is no link to download');
    }
  }
  else if (request.method === 'store-links') {
    manager.schedlue(request.links);
  }
  else if (request.method === 'extract-links') {
    const re = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\\/%?=~_|!:,.;]*[-A-Z0-9+&@#\\/%=~_|])/gi;
    const links = (request.content.match(re) || []) .map(s => s.replace(/&amp;/g, '&'))
      .filter(href => href).filter((s, i, l) => s && l.indexOf(s) === i);
    response(links);
  }
  else if (request.method === 'start') {
    manager.search({
      id: request.id
    }, ([d]) => {
      manager.download({
        url: d.finalUrl
      }, () => {
        manager.erase({
          id: request.id
        });
        response();
      }, CONFIG);
    });
  }
  else if (request.method === 'collect') {
    chrome.tabs.executeScript({
      code: 'append.links'
    }, one => chrome.tabs.executeScript({
      code: `[...document.querySelectorAll('video,audio,video source, audio source')].map(s => s.src).filter(s => s)`
    }, two => {
      const links = [...one, ...two].flat().filter((s, i, l) => s && l.indexOf(s) === i);
      response(links);
    }));
    return true;
  }
});
/* allow external download and store requests */
chrome.runtime.onMessageExternal.addListener((request, sender, resposne) => {
  console.log(request);
  if (request.method === 'add-jobs') {
    if (request.jobs.length) {
      for (const {link, threads} of request.jobs) {
        manager.download({
          url: link
        }, undefined, {
          ...CONFIG,
          'max-number-of-threads': threads ? Math.min(8, threads) : 3
        });
      }
    }
    else {
      notify('There is no link to download');
    }
    resposne(true);
  }
  else if (request.method === 'store-links') {
    manager.schedlue(request.links);
    resposne(true);
  }
});

const update = {
  id: -1,
  perform() {
    clearTimeout(update.id);
    manager.search({
      state: 'in_progress'
    }, ds => {
      if (ds.length) {
        if (ds.some(d => d.paused === false)) {
          update.id = setTimeout(() => update.perform(), 1000);
        }
        const bytesReceived = ds.reduce((p, c) => p + c.bytesReceived, 0);
        const totalBytes = ds.reduce((p, c) => p + c.totalBytes, 0);
        chrome.browserAction.setBadgeText({
          text: totalBytes ? (bytesReceived / totalBytes * 100).toFixed(0) + '%' : ''
        });
      }
      else {
        chrome.browserAction.setBadgeText({
          text: ''
        });
      }
      chrome.runtime.sendMessage({
        method: 'batch-update',
        ds
      }, () => chrome.runtime.lastError);
    });
  }
};
manager.onChanged.addListener(info => {
  if (info.native) {
    chrome.runtime.sendMessage({
      method: 'convert-to-native',
      ...info
    }, () => chrome.runtime.lastError);
  }
  else {
    update.perform();
    if (info.state && (['complete', 'interrupted', 'transfer'].some(a => a === info.state.current))) {
      manager.search({
        id: info.id
      }, ds => chrome.runtime.sendMessage({
        method: 'batch-update',
        ds
      }, () => chrome.runtime.lastError));
    }
    else if (info.filename) {
      manager.search({
        id: info.id
      }, ([d]) => chrome.runtime.sendMessage({
        method: 'prepare-one',
        d
      }, () => chrome.runtime.lastError));
    }
  }
});

// context menu
{
  const startup = () => {
    chrome.contextMenus.create({
      contexts: ['selection'],
      title: 'Extract then Download Links',
      id: 'extract-links'
    });
    chrome.contextMenus.create({
      contexts: ['selection'],
      title: 'Extract then Store Links',
      id: 'store-links'
    });
    chrome.contextMenus.create({
      contexts: ['link'],
      title: 'Download Link',
      id: 'download-link'
    });
    chrome.contextMenus.create({
      contexts: ['link'],
      title: 'Download Later',
      id: 'store-link'
    });
    chrome.contextMenus.create({
      contexts: ['image'],
      title: 'Download Image',
      id: 'download-image'
    });
    chrome.contextMenus.create({
      contexts: ['audio', 'video'],
      title: 'Download Media',
      id: 'download-media'
    });
    chrome.contextMenus.create({
      contexts: ['page'],
      title: 'Extract then Download Media Links',
      id: 'extract-media'
    });
    chrome.contextMenus.create({
      contexts: ['page'],
      title: 'Extract then Store Media Links',
      id: 'lazy-extract-media'
    });
  };
  chrome.runtime.onStartup.addListener(startup);
  chrome.runtime.onInstalled.addListener(startup);
}
chrome.contextMenus.onClicked.addListener(info => {
  if (info.menuItemId === 'extract-links') {
    chrome.tabs.executeScript({
      file: '/data/scripts/selection.js',
      runAt: 'document_start'
    });
  }
  else if (info.menuItemId === 'store-links') {
    chrome.tabs.executeScript({
      file: '/data/scripts/lazy-selection.js',
      runAt: 'document_start'
    });
  }
  else if (info.menuItemId.startsWith('download-')) {
    let url = info.linkUrl;
    if (info.menuItemId === 'download-image' || info.menuItemId === 'download-media') {
      url = info.srcUrl;
    }
    manager.download({url}, undefined, CONFIG);
  }
  else if (info.menuItemId === 'store-link') {
    manager.schedlue([info.linkUrl]);
  }
  else if (info.menuItemId === 'extract-media') {
    chrome.tabs.executeScript({
      file: '/data/scripts/collect.js',
      runAt: 'document_start'
    });
  }
  else if (info.menuItemId === 'lazy-extract-media') {
    chrome.tabs.executeScript({
      file: '/data/scripts/lazy-collect.js',
      runAt: 'document_start'
    });
  }
});

/* badge */
{
  const startup = () => chrome.browserAction.setBadgeBackgroundColor({
    color: '#646464'
  });
  chrome.runtime.onStartup.addListener(startup);
  chrome.runtime.onInstalled.addListener(startup);
}

/* FAQs & Feedback */
{
  const {management, runtime: {onInstalled, setUninstallURL, getManifest}, storage, tabs} = chrome;
  if (navigator.webdriver !== true) {
    const page = getManifest().homepage_url;
    const {name, version} = getManifest();
    onInstalled.addListener(({reason, previousVersion}) => {
      management.getSelf(({installType}) => installType === 'normal' && storage.local.get({
        'faqs': true,
        'last-update': 0
      }, prefs => {
        if (reason === 'install' || (prefs.faqs && reason === 'update')) {
          const doUpdate = (Date.now() - prefs['last-update']) / 1000 / 60 / 60 / 24 > 45;
          if (doUpdate && previousVersion !== version) {
            tabs.create({
              url: page + '?version=' + version + (previousVersion ? '&p=' + previousVersion : '') + '&type=' + reason,
              active: reason === 'install'
            });
            storage.local.set({'last-update': Date.now()});
          }
        }
      }));
    });
    setUninstallURL(page + '?rd=feedback&name=' + encodeURIComponent(name) + '&version=' + version);
  }
}
