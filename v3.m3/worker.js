/**
    Turbo Download Manager - A download manager with the ability to pause and resume downloads

    Copyright (C) 2014-2023 [InBasic](https://webextension.org/listing/turbo-download-manager-v2.html)

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
    Homepage: https://webextension.org/listing/turbo-download-manager-v2.html
*/

/* global manager, clients */

self.importScripts('connect.js');
self.importScripts('manager.js');

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
const EXCONFIG = {
  'native-search-limit': 20 // set a limit when search from chrome.downloads
};
// read user configs
{
  const startup = () => chrome.storage.local.get({
    'internal-get-configs': {},
    'extra-configs': {}
  }, prefs => {
    Object.assign(CONFIG, prefs['internal-get-configs']);
    Object.assign(EXCONFIG, prefs['extra-configs']);
  });
  chrome.runtime.onStartup.addListener(startup);
  chrome.runtime.onInstalled.addListener(startup);
}


const notify = e => chrome.notifications.create({
  type: 'basic',
  iconUrl: '/data/icons/48.png',
  title: chrome.runtime.getManifest().name,
  message: e.message || e
});

const job = async (jobs, tab) => {
  const win = await chrome.windows.getCurrent();

  chrome.storage.local.get({
    'job-width': 700,
    'job-height': 500,
    'job-left': win.left + Math.round((win.width - 700) / 2),
    'job-top': win.top + Math.round((win.height - 500) / 2)
  }, async prefs => {
    tab = tab || await new Promise(resolve => chrome.tabs.query({
      active: true,
      lastFocusedWindow: true
    }, tabs => resolve(tabs[0] || {})));
    const args = new URLSearchParams();
    args.append('tabId', tab.id);
    args.append('referrer', tab.url);
    args.append('jobs', JSON.stringify(jobs));

    chrome.windows.create({
      url: '/data/add/index.html?' + args.toString(),
      width: prefs['job-width'],
      height: prefs['job-height'],
      left: prefs['job-left'],
      top: prefs['job-top'],
      type: 'popup'
    });
  });
};

const onMessage = (request, sender, response) => {
  if (request.method === 'popup_ready') {
    // make sure downloading engine is ready
    (chrome.runtime.getContexts ? chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL('/downloads/index.html')]
    }) : Promise.resolve([])).then(async a => {
      if (a.length === 0) {
        await chrome.offscreen.createDocument({
          url: '/downloads/index.html',
          reasons: ['IFRAME_SCRIPTING'],
          justification: 'run TDM engine'
        }).catch(() => {});
      }
      Promise.all([
        new Promise(resolve => manager.search({state: 'not_started'}, resolve)),
        new Promise(resolve => manager.search({
          orderBy: ['-startTime'],
          state: 'transfer'
        }, resolve)),
        new Promise(resolve => manager.search({
          limit: EXCONFIG['native-search-limit'],
          orderBy: ['-startTime'],
          state: 'interrupted'
        }, resolve)),
        new Promise(resolve => manager.search({
          limit: EXCONFIG['native-search-limit'],
          orderBy: ['-startTime'],
          state: 'complete'
        }, resolve))
      ]).then(([a, b, c, d]) => {
        response([...a.reverse(), ...b.reverse(), ...c.reverse(), ...d.reverse()]);
        update.perform();
      });
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
  else if (request.method === 'add-jobs') {
    if (request.jobs.length) {
      (async () => {
        let r = '';
        if (request.tabId) {
          const tab = await new Promise(resolve => chrome.tabs.get(request.tabId, resolve));
          if (tab && tab.url && tab.url.startsWith('http')) {
            r = tab.url;
          }
        }
        for (const {link, referrer, base, links, keys, filename, threads} of request.jobs) {
          const job = {
            url: link,
            filename,
            referrer: referrer || r
          };
          if (links) {
            delete job.url;

            job.urls = links;
            if (base) {
              job.urls = job.urls.map(s => s.startsWith('http') ? s : base + s);
            }
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
    manager.schedule(request.job);

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
      if (d.base) {
        d.urls = d.links.map(s => s.startsWith('http') ? s : d.base + s);
        delete d.base;
        delete d.links;
      }

      manager.download(d, () => {
        manager.erase({
          id: request.id
        });
        response();
      }, CONFIG);
    });
  }
  else if (request.method === 'collect') {
    chrome.scripting.executeScript({
      target: {
        tabId: request.tabId,
        allFrames: true
      },
      func: () => {
        const one = typeof append === 'function' ? self.append?.links : [];
        const two = [...document.querySelectorAll('video, audio, video source, audio source')]
          .map(s => s.src).filter(s => s && s.startsWith('http'));

        return [...(one || []), ...(two || [])];
      }
    }).then(r => {
      const links = r.map(o => o.result).flat().filter((s, i, l) => s && l.indexOf(s) === i);
      response(links);
    }).catch(() => response([]));
    return true;
  }
  else if (request.method === 'media-available') {
    chrome.action.setIcon({
      tabId: sender.tab.id,
      path: {
        '16': '/data/icons/media/16.png',
        '32': '/data/icons/media/32.png',
        '48': '/data/icons/media/48.png'
      }
    });
    chrome.action.setTitle({
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
  keepAwake: 'display',
  perform() {
    clearTimeout(update.id);
    manager.search({
      state: 'in_progress'
    }, ds => {
      // only when there are ongoing downloads
      if (chrome.power) {
        if (update.keepAwake && ds.some(d => d.paused === false)) {
          chrome.power.requestKeepAwake(update.keepAwake);
        }
        else {
          chrome.power.releaseKeepAwake();
        }
      }
      // badge
      if (ds.length) {
        if (ds.some(d => d.paused === false)) {
          update.id = setTimeout(() => update.perform(), 1000);
        }
        const dsb = ds.filter(d => d.totalBytes > 0 && d.restored !== false);
        const bytesReceived = dsb.reduce((p, c) => p + c.bytesReceived, 0);
        const totalBytes = dsb.reduce((p, c) => p + c.totalBytes, 0);
        chrome.action.setBadgeText({
          text: totalBytes ? (bytesReceived / totalBytes * 100).toFixed(0) + '%' : ''
        });
      }
      else {
        chrome.action.setBadgeText({
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
chrome.storage.local.get({
  'keep.awake': 'display'
}, prefs => update.keepAwake = prefs['keep.awake']);
chrome.storage.onChanged.addListener(ps => {
  if (ps['keep.awake']) {
    update.keepAwake = ps['keep.awake'].newValue;
  }
});

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
    chrome.tabs.query({
      active: true,
      lastFocusedWindow: true
    }).then(([tab]) => chrome.scripting.executeScript({
      target: {tabId: tab.id, allFrames: true},
      func: () => {
        if (typeof self.append !== 'undefined') {
          self.append.links = [];
          self.append.notified = false;
        }
      }
    }).then(() => {
      chrome.action.setIcon({
        tabId: tab.id,
        path: {
          '16': '/data/icons/16.png',
          '32': '/data/icons/32.png',
          '48': '/data/icons/48.png'
        }
      });
      chrome.action.setTitle({
        tabId: tab.id,
        title: chrome.runtime.getManifest().name
      });
    }).catch(e => console.error(e)));
  }
  else if (info.menuItemId === 'extract-links') { /// allFrames????
    chrome.tabs.query({
      active: true,
      lastFocusedWindow: true
    }).then(([tab]) => chrome.scripting.executeScript({
      target: {
        tabId: tab.id
      },
      files: ['/data/scripts/selection.js']
    }));
  }
  else if (info.menuItemId.startsWith('download-')) {
    let url = info.linkUrl;
    if (info.menuItemId === 'download-image' || info.menuItemId === 'download-media') {
      url = info.srcUrl;
    }
    manager.download({
      referrer: tab.url && tab.url.startsWith('http') ? tab.url : '',
      url
    }, undefined, CONFIG);
  }
  else if (info.menuItemId === 'store-link') {
    manager.schedule({
      url: info.linkUrl,
      referrer: tab.url.startsWith('http') ? tab.url : ''
    });
  }
  else if (info.menuItemId === 'store-image' || info.menuItemId === 'store-media') {
    manager.schedule({
      url: info.srcUrl,
      referrer: tab.url.startsWith('http') ? tab.url : ''
    });
  }
  else if (info.menuItemId === 'extract-requests') { /// allFrames?
    chrome.scripting.executeScript({
      target: {
        tabId: tab.id
      },
      func: tabId => self.tabId = tabId,
      args: [tab.id]
    }).then(() => chrome.scripting.executeScript({
      target: {
        tabId: tab.id
      },
      files: ['/data/scripts/collect.js']
    }));
  }
});

/* badge */
{
  const startup = () => chrome.action.setBadgeBackgroundColor({
    color: '#646464'
  });
  chrome.runtime.onStartup.addListener(startup);
  chrome.runtime.onInstalled.addListener(startup);
}

const webRequest = {
  observe: {
    type_1(d) {
      if (d.tabId > 0) {
        chrome.tabs.sendMessage(d.tabId, {
          method: 'media',
          link: d.url
        }, {
          frameId: d.frameId
        }, () => chrome.runtime.lastError);
      }
    },
    type_2(d) {
      if (d.tabId > 0) {
        chrome.tabs.sendMessage(d.tabId, {
          method: 'media',
          link: d.url
        }, {
          frameId: d.frameId
        }, () => chrome.runtime.lastError);
      }
    }
  },
  install() {
    if (chrome.webRequest) {
      chrome.webRequest.onBeforeRequest.removeListener(webRequest.observe.type_1);
      chrome.webRequest.onBeforeRequest.addListener(webRequest.observe.type_1, {
        urls: ['*://*/*'],
        types: ['media']
      });
      chrome.webRequest.onBeforeRequest.removeListener(webRequest.observe.type_2);
      chrome.webRequest.onBeforeRequest.addListener(webRequest.observe.type_2, {
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
webRequest.install();

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
            tabs.query({active: true, lastFocusedWindow: true}, tbs => tabs.create({
              url: page + '?version=' + version + (previousVersion ? '&p=' + previousVersion : '') + '&type=' + reason,
              active: reason === 'install',
              ...(tbs && tbs.length && {index: tbs[0].index + 1})
            }));
            storage.local.set({'last-update': Date.now()});
          }
        }
      }));
    });
    setUninstallURL(page + '?rd=feedback&name=' + encodeURIComponent(name) + '&version=' + version);
  }
}
