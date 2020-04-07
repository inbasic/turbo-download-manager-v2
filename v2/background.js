/* globals downloads, webext */
'use strict';

downloads.onChanged.addListener(obj => webext.runtime.sendMessage({
  method: 'downloads.onChanged',
  obj
}));
/*
chrome.tabs.create({
  url: 'data/popup/index.html'
});

downloads.download({
  url: 'http://localhost:3000/a.mp3',
  threads: 2
});
*/
/*
downloads.download({
  url: 'https://clc.stackoverflow.com/impression.gif?an=AUUAuv8K90QpNtqM1UgFkg9USQICEMi3-As7A_CpCK6ECrWyEgAUALuAYEy0OZltej8DA5qzCgOK6QkDk-kJAMk2XQ62fx7bmv4&md=447',
  threads: 2
});
*/
// context-menu
webext.runtime.on('start-up', () => {
  webext.contextMenus.batch([{
    id: 'open-dialog',
    title: 'Add new jobs',
    contexts: ['browser_action']
  }, {
    id: 'reset-counter',
    title: 'Reset counter',
    contexts: ['browser_action']
  }, {
    id: 'download-image',
    title: 'Download this image file',
    contexts: ['image']
  }, {
    id: 'download-media',
    title: 'Download this media file',
    contexts: ['video', 'audio']
  }, {
    id: 'download-link',
    title: 'Download this link',
    contexts: ['link']
  }]);
});
// reset-counter
webext.contextMenus.on('clicked', (info, tab) => {
  webext.tabs.sendMessage(tab.id, {
    method: 'reset-counter'
  });
}).if(({menuItemId}) => menuItemId === 'reset-counter');
// open dialog
{
  const open = ({id}) => {
    webext.windows.create({
      type: 'popup',
      url: 'data/dialog/index.html?tabId=' + id,
      width: 700,
      height: 500,
      left: screen.availLeft + Math.round((screen.availWidth - 600) / 2),
      top: screen.availTop + Math.round((screen.availHeight - 500) / 2)
    });
  };
  webext.contextMenus.on('clicked', (info, tab) => open(tab))
    .if(({menuItemId}) => menuItemId === 'open-dialog');
  webext.runtime.on('message', async() => {
    open(await webext.tabs.current());
  }).if(({method}) => method === 'open-dialog');
}

// send counts to the top frame
webext.runtime.on('message', ({count}, {tab, frameId}) => {
  webext.tabs.sendMessage(tab.id, {
    method: 'count',
    count,
    frameId
  }, {
    frameId: 0
  });
}).if(({method}) => method === 'count');
// display badge number for each tab
webext.runtime.on('message', ({count}, {tab}) => webext.browserAction.setBadgeText({
  text: count === 0 ? '' : String(count),
  tabId: tab.id
})).if(({method}) => method === 'badge');
// download
{
  const add = arr => arr.forEach(obj => downloads.download(obj, undefined, {
    'segment-min': Number(localStorage.getItem('segment-min')) * 1024 || 50 * 1024,
    'segment-max': Number(localStorage.getItem('segment-max')) * 1024 * 1024 || 1024 * 1024 * 1024,
    'retry-max': Number(localStorage.getItem('retry-max')) || 30,
    'speed-cache': Number(localStorage.getItem('speed-cache')) || 10
  }));

  webext.runtime.on('message', ({jobs}, sender) => {
    chrome.tabs.remove(sender.tab.id);
    add(jobs);
  }).if(({method}) => method === 'download');
  webext.contextMenus.on('clicked', ({linkUrl}) => add([{
    url: linkUrl,
    threads: localStorage.getItem('thread-other') || 2
  }])).if(({menuItemId}) => menuItemId === 'download-link');
  webext.contextMenus.on('clicked', ({srcUrl, mediaType}) => add([{
    url: srcUrl,
    threads: ({
      audio: localStorage.getItem('thread-audio') || 1,
      video: localStorage.getItem('thread-video') || 2,
      iamge: localStorage.getItem('thread-video') || 1
    })[mediaType]
  }])).if(({menuItemId}) => menuItemId === 'download-media' || menuItemId === 'download-image');
}

// FAQs and Feedback
webext.runtime.on('start-up', () => {
  const {name, version, homepage_url} = webext.runtime.getManifest(); // eslint-disable-line camelcase
  const page = homepage_url; // eslint-disable-line camelcase
  // FAQs
  webext.storage.get({
    'version': null,
    'faqs': true,
    'last-update': 0
  }).then(prefs => {
    if (prefs.version ? (prefs.faqs && prefs.version !== version) : true) {
      const now = Date.now();
      const doUpdate = (now - prefs['last-update']) / 1000 / 60 / 60 / 24 > 45;
      webext.storage.set({
        version,
        'last-update': doUpdate ? Date.now() : prefs['last-update']
      }).then(() => {
        // do not display the FAQs page if last-update occurred less than 45 days ago.
        if (doUpdate) {
          const p = Boolean(prefs.version);
          webext.tabs.create({
            url: page + '?version=' + version +
              '&type=' + (p ? ('upgrade&p=' + prefs.version) : 'install'),
            active: p === false
          });
        }
      });
    }
  });
  // Feedback
  webext.runtime.setUninstallURL(
    page + '?rd=feedback&name=' + name + '&version=' + version
  );
});
