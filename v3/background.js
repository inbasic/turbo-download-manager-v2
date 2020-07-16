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
  // each fetch could have this size, so the total memory could be
  // up to 'max-number-of-threads' * 'max-segment-size'
  'max-segment-size': 100 * 1024 * 1024, // max size for a single downloading segment
  'absolute-max-segment-size': 100 * 1024 * 1024, // no thread size can exceed this value
  'overwrite-segment-size': true,
  'max-number-of-threads': 3,
  'max-retires': 10,
  'speed-over-seconds': 10,
  'max-simultaneous-writes': 3,
  'max-number-memory-chunks': 500
};
// read user configs
{
  const startup = () => chrome.storage.local.get({
    'internal-get-configs': {}
  }, prefs => Object.assign(CONFIG, prefs['internal-get-configs']));
  chrome.runtime.onStartup.addListener(startup);
  chrome.runtime.onInstalled.addListener(startup);
}


const notify = e => chrome.notifications.create({
  type: 'basic',
  iconUrl: '/data/icons/48.png',
  title: chrome.runtime.getManifest().name,
  message: e.message || e
});

const job = (jobs, tab) => chrome.storage.local.get({
  'job-width': 700,
  'job-height': 500,
  'job-left': screen.availLeft + Math.round((screen.availWidth - 700) / 2),
  'job-top': screen.availTop + Math.round((screen.availHeight - 500) / 2)
}, async prefs => {
  tab = tab || await new Promise(resolve => chrome.tabs.query({
    active: true,
    currentWindow: true
  }, tabs => resolve(tabs[0] || {})));

  chrome.windows.create({
    url: chrome.extension.getURL('data/add/index.html?tabId=' + tab.id + '&jobs=' + encodeURIComponent(JSON.stringify(jobs))),
    width: prefs['job-width'],
    height: prefs['job-height'],
    left: prefs['job-left'],
    top: prefs['job-top'],
    type: 'popup'
  });
});

const onMessage = (request, sender, response) => {
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
    manager.search(request.query, response);
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
      (async () => {
        for (const {link, links, keys, filename, threads} of request.jobs) {
          const job = {
            url: link,
            filename
          };
          if (links) {
            delete job.url;
            job.urls = links;
            job.keys = keys;
          }
          manager.download(job, undefined, {
            ...CONFIG,
            ...(request.configs || {}),
            'max-number-of-threads': threads ? Math.min(8, threads) : 3
          });
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      })();
      response(true);
    }
    else {
      notify('There is no link to download');
    }
  }
  else if (request.method === 'store-links') {
    manager.schedlue(request.links);

    response(true);
  }
  else if (request.method === 'open-jobs') {
    job(request.jobs);
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
      code: `typeof append === 'function' ? append.links : []`,
      allFrames: true
    }, one => {
      chrome.runtime.lastError;
      chrome.tabs.executeScript({
        code: `[...document.querySelectorAll('video,audio,video source, audio source')]
                 .map(s => s.src).filter(s => s && s.startsWith('http'))`
      }, two => {
        chrome.runtime.lastError;
        const links = [...(one || []), ...(two || [])].flat().filter((s, i, l) => s && l.indexOf(s) === i);
        response(links);
      });
    });
    return true;
  }
  else if (request.method === 'media-available') {
    chrome.browserAction.setIcon({
      tabId: sender.tab.id,
      path: {
        '16': 'data/icons/media/16.png',
        '19': 'data/icons/media/19.png',
        '32': 'data/icons/media/32.png',
        '38': 'data/icons/media/38.png',
        '48': 'data/icons/media/48.png'
      }
    });
    chrome.browserAction.setTitle({
      tabId: sender.tab.id,
      title: 'Use page context to download or store collected media links'
    });
  }
};
chrome.runtime.onMessage.addListener(onMessage);

/* allow external download and store requests */
chrome.runtime.onMessageExternal.addListener((request, sender, response) => {
  if (request.method === 'add-jobs' || request.method === 'store-links') {
    onMessage(request, sender, response);
  }
});

const update = {
  id: -1,
  keepAwake: 'system',
  perform() {
    clearTimeout(update.id);
    manager.search({
      state: 'in_progress'
    }, ds => {
      if (ds.length) {
        if (ds.some(d => d.paused === false)) {
          update.id = setTimeout(() => update.perform(), 1000);
        }
        const dsb = ds.filter(d => d.totalBytes > 0 && d.restored !== false);
        const bytesReceived = dsb.reduce((p, c) => p + c.bytesReceived, 0);
        const totalBytes = dsb.reduce((p, c) => p + c.totalBytes, 0);
        chrome.browserAction.setBadgeText({
          text: totalBytes ? (bytesReceived / totalBytes * 100).toFixed(0) + '%' : ''
        });
        if (update.keepAwake && chrome.power) {
          chrome.power.requestKeepAwake(update.keepAwake);
        }
      }
      else {
        chrome.browserAction.setBadgeText({
          text: ''
        });
        if (update.keepAwake && chrome.power) {
          chrome.power.releaseKeepAwake();
        }
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
  const startup = () => chrome.storage.local.get({
    'context.extract-links': true,
    'context.download-link': true,
    'context.store-link': true,
    'context.download-image': true,
    'context.store-image': true,
    'context.download-media': true,
    'context.store-media': true,
    'context.extract-requests': true,
    'context.clear-cache': true,
    'context.test': true
  }, prefs => {
    const map = {
      'extract-links': {
        contexts: ['selection'],
        title: 'Extract Links',
        documentUrlPatterns: ['*://*/*']
      },
      'download-link': {
        contexts: ['link'],
        title: 'Download Link',
        targetUrlPatterns: ['*://*/*']
      },
      'store-link': {
        contexts: ['link'],
        title: 'Store Link',
        targetUrlPatterns: ['*://*/*']
      },
      'download-image': {
        contexts: ['image'],
        title: 'Download Image',
        targetUrlPatterns: ['*://*/*', 'data:image/*']
      },
      'store-image': {
        contexts: ['image'],
        title: 'Store Image',
        targetUrlPatterns: ['*://*/*', 'data:image/*']
      },
      'download-media': {
        contexts: ['audio', 'video'],
        title: 'Download Media',
        targetUrlPatterns: ['*://*/*', 'data:video/*']
      },
      'store-media': {
        contexts: ['audio', 'video'],
        title: 'Store Media',
        targetUrlPatterns: ['*://*/*', 'data:video/*']
      },
      'extract-requests': {
        contexts: ['page'],
        title: 'Extract Media Links',
        documentUrlPatterns: ['*://*/*']
      },
      'clear-cache': {
        contexts: ['browser_action'],
        title: 'Clear Detected Media List (for this tab)',
        documentUrlPatterns: ['*://*/*']
      },
      'test': {
        contexts: ['browser_action'],
        title: 'Open Test Page',
        documentUrlPatterns: ['*://*/*']
      }
    };
    for (const id of Object.keys(map)) {
      if (prefs['context.' + id]) {
        chrome.contextMenus.create({
          ...map[id],
          id
        }, () => chrome.runtime.lastError);
      }
      else {
        chrome.contextMenus.remove(id, () => chrome.runtime.lastError);
      }
    }
  });
  chrome.runtime.onStartup.addListener(startup);
  chrome.runtime.onInstalled.addListener(startup);
  let id;
  chrome.storage.onChanged.addListener(ps => {
    if (Object.keys(ps).some(key => key.startsWith('context.'))) {
      clearTimeout(id);
      id = setTimeout(startup, 200);
    }
  });
}
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'test') {
    chrome.tabs.create({
      url: 'https://webbrowsertools.com/test-download-with/'
    });
  }
  else if (info.menuItemId === 'clear-cache') {
    chrome.tabs.executeScript({
      code: `
        if (typeof append !== 'undefined') {
          append.links = [];
          append.notified = false;
        }
      `,
      runAt: 'document_start',
      allFrames: true,
      matchAboutBlank: true
    }, () => {
      if (!chrome.runtime.lastError) {
        chrome.browserAction.setIcon({
          tabId: tab.id,
          path: {
            '16': 'data/icons/16.png',
            '19': 'data/icons/19.png',
            '32': 'data/icons/32.png',
            '38': 'data/icons/38.png',
            '48': 'data/icons/48.png'
          }
        });
        chrome.browserAction.setTitle({
          tabId: tab.id,
          title: chrome.runtime.getManifest().name
        });
      }
    });
  }
  else if (info.menuItemId === 'extract-links') {
    chrome.tabs.executeScript({
      file: '/data/scripts/selection.js',
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
  else if (info.menuItemId === 'store-image' || info.menuItemId === 'store-media') {
    manager.schedlue([info.srcUrl]);
  }
  else if (info.menuItemId === 'extract-requests') {
    chrome.tabs.executeScript({
      file: '/data/scripts/collect.js',
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

window.webRequest = {
  observe: {
    type_1(d) {
      if (d.tabId > 0) {
        chrome.tabs.sendMessage(d.tabId, {
          method: 'media',
          link: d.url
        }, {
          frameId: d.frameId
        });
      }
    },
    type_2(d) {
      if (d.tabId > 0) {
        chrome.tabs.sendMessage(d.tabId, {
          method: 'media',
          link: d.url
        }, {
          frameId: d.frameId
        });
      }
    }
  },
  install() {
    if (chrome.webRequest) {
      chrome.webRequest.onBeforeRequest.removeListener(window.webRequest.observe.type_1);
      chrome.webRequest.onBeforeRequest.addListener(window.webRequest.observe.type_1, {
        urls: ['*://*/*'],
        types: ['media']
      });
      chrome.webRequest.onBeforeRequest.removeListener(window.webRequest.observe.type_2);
      chrome.webRequest.onBeforeRequest.addListener(window.webRequest.observe.type_2, {
        urls: [
          '*://*/*.flv*', '*://*/*.avi*', '*://*/*.wmv*', '*://*/*.mov*', '*://*/*.mp4*',
          '*://*/*.pcm*', '*://*/*.wav*', '*://*/*.mp3*', '*://*/*.aac*', '*://*/*.ogg*', '*://*/*.wma*',
          '*://*/*.m3u8*'
        ],
        types: ['xmlhttprequest']
      });
    }
  }
};
window.webRequest.install();

/* Start */
{
  const startup = () => chrome.storage.local.get({
    'queue.size': 3
  }, prefs => manager.PUASE_ON_META = prefs['queue.size']);
  chrome.runtime.onStartup.addListener(startup);
  chrome.runtime.onInstalled.addListener(startup);
  chrome.storage.onChanged.addListener(ps => {
    if (ps['queue.size']) {
      manager.PUASE_ON_META = ps['queue.size'].newValue;
    }
  });
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
