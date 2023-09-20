'use strict';

// webext/utils/EventEmitter.js
var EventEmitter = function(process = {}, obj) {
  Object.assign(this, {
    callbacks: {},
    ifs: {},
    ignores: {},
    onces: {},
    process
  }, obj);
};
EventEmitter.prototype.on = function(id, callback) {
  if (this.callbacks[id] === undefined || this.callbacks[id].length === 0) {
    // run constructor only once when there is at least one listener
    if (this.process[id] && this.process[id].first) {
      // console.log('first is called for', id);
      this.process[id].first();
    }
    this.callbacks[id] = [];
    this.ifs[id] = [];
    this.ignores[id] = [];
    this.onces[id] = [];
  }
  const index = this.callbacks[id].push(callback) - 1;
  this.ignores[id][index] = null;
  this.ifs[id][index] = null;
  return {
    get id() {
      return index;
    },
    ignore: fun => this.ignores[id][index] = fun,
    if: fun => this.ifs[id][index] = fun
  };
};
EventEmitter.prototype.once = function(id, callback) {
  const r = this.on(id, callback);
  this.onces[id][r.id] = true;
  return r;
};
EventEmitter.prototype.off = function(id, callback) {
  const index = (this.callbacks[id] || []).indexOf(callback);
  if (index !== -1) {
    this.callbacks[id].splice(index, 1);
    this.ignores[id].splice(index, 1);
    this.ifs[id].splice(index, 1);
    this.onces[id].splice(index, 1);
    // run deconstructor once there is no other listener
    if (this.callbacks[id].length === 0 && this.process[id] && this.process[id].last) {
      // console.log('last is called for', id);
      this.process[id].last();
    }
  }
};
EventEmitter.prototype.emit = function(id, ...data) {
  const offs = [];
  const rtns = (this.callbacks[id] || []).map((c, i) => {
    const run = () => {
      if (this.onces[id][i]) {
        offs.push(c);
      }
      return c(...data);
    };

    // ignore callback if it has ignore
    if (this.ignores[id][i]) {
      if (this.ignores[id][i](...data)) {
        return;
      }
    }
    if (this.ifs[id][i]) {
      if (this.ifs[id][i](...data)) {
        return run();
      }
    }
    else {
      return run();
    }
  });
  offs.forEach(c => this.off(id, c));

  return rtns;
};
// webext/core/base.js
var webext = {};

{
  const cache = [];
  webext.policy = root => {
    Object.keys(root.policy).forEach(key => {
      const pointer = root[key];
      const storage = root.policy[key].storage;
      cache.push(root.policy[key]);

      root[key] = function(...args) {
        if (localStorage.getItem(storage) === 'deny') {
          return;
        }
        pointer.apply(this, args);
      };
    });
  };
  webext.policy.collect = () => cache;
}
// webext/core/chrome.runtime.js
/*
  webext.runtime
  Events: start-up
*/
{
  const callback = () => webext.runtime.emit('start-up');
  const onMessage = (request, sender, response) => {
    const rtns = webext.runtime.emit('message', request, sender, response);
    if (rtns.some(r => r === true)) {
      return true;
    }
  };
  const onConnect = port => webext.runtime.emit('connect', port);

  webext.runtime = new EventEmitter({
    'start-up': {
      first: () => {
        chrome.runtime.onInstalled.addListener(callback);
        chrome.runtime.onStartup.addListener(callback);
      },
      last: () => {
        chrome.runtime.onInstalled.removeListener(callback);
        chrome.runtime.onStartup.removeListener(callback);
      }
    },
    'message': {
      first: () => {
        chrome.runtime.onMessage.addListener(onMessage);
      },
      last: () => {
        chrome.runtime.onMessage.removeListener(onMessage);
      }
    },
    'connect': {
      first: () => {
        chrome.runtime.onConnect.addListener(onConnect);
      },
      last: () => {
        chrome.runtime.onConnect.removeListener(onConnect);
      }
    }
  }, chrome.runtime);
}

webext.runtime.sendMessage = (request, response) => chrome.runtime.sendMessage(request, response);

webext.runtime.connectNative = (id, message) => {
  const channel = chrome.runtime.connectNative(id);
  const responses = [];

  return {
    onMessage: c => channel.onMessage.addListener(c),
    postMessage: o => channel.postMessage(o),
    build: () => new Promise((resolve, reject) => {
      channel.onDisconnect.addListener(() => reject(new Error('channel is broken')));
      channel.onMessage.addListener(r => {
        if (r && r.code === 0) {
          r.responses = responses;
          channel.disconnect();
          resolve(r);
        }
        else if (r && isNaN(r.code) === false) {
          channel.disconnect();
          reject(r);
        }
        else if (r) {
          responses.push(r);
        }
        else {
          channel.disconnect();
          reject(new Error('empty response'));
        }
      });
      if (message) {
        channel.postMessage(message);
      }
    })
  };
};
webext.runtime.Native = function(id) {
  this.id = id;
};
webext.runtime.Native.prototype.send = function(props) {
  return new Promise(resolve => chrome.runtime.sendNativeMessage(this.id, props, resolve));
};
// webext/core/chrome.contextMenus.js
/*
  webext.contextMenus
  Events: clicked
*/
{
  const callback = (info, tab) => {
    webext.contextMenus.emit('clicked', info, tab);
  };

  webext.contextMenus = new EventEmitter({
    clicked: {
      first: () => chrome.contextMenus.onClicked.addListener(callback),
      last: () => chrome.contextMenus.onClicked.removeListener(callback)
    }
  }, chrome.contextMenus);
}

webext.contextMenus.batch = arr => arr.forEach(createData => webext.contextMenus.create(createData));
webext.contextMenus.removeAll = () => new Promise(resolve => chrome.contextMenus.removeAll(resolve));
webext.contextMenus.remove = menuItemId => new Promise(resolve => chrome.contextMenus.remove(menuItemId, resolve));
// webext/core/chrome.browserAction.js
/*
  webext.contextMenus
  Events: clicked
*/
{
  const callback = tab => {
    webext.browserAction.emit('clicked', tab);
  };

  webext.browserAction = new EventEmitter({
    clicked: {
      first: () => chrome.browserAction.onClicked.addListener(callback),
      last: () => chrome.browserAction.onClicked.removeListener(callback)
    }
  }, chrome.browserAction);

  if ('browserAction' in chrome) {
    chrome.browserAction.setBadgeBackgroundColor({
      color: '#929292'
    });
  }
}
// webext/core/chrome.notifications.js
{
  const onClicked = changes => {
    webext.notifications.emit('clicked', changes);
  };

  webext.notifications = new EventEmitter({
    clicked: {
      first: () => chrome.notifications.onClicked.addListener(onClicked),
      last: () => chrome.notifications.onClicked.removeListener(onClicked)
    }
  }, chrome.notifications);
}

webext.notifications.policy = {
  create: {
    storage: 'notifications.create',
    description: 'Display desktop notifications'
  }
};

webext.notifications.create = options => {
  options = Object.assign({
    title: chrome.runtime.getManifest().name,
    type: 'basic',
    iconUrl: 'data/icons/48.png'
  }, options);
  chrome.notifications.create(options);
};
webext.policy(webext.notifications);
// webext/core/chrome.tabs.js
/*
  webext.tabs
  Event: removed
*/
{
  const onRemoved = (tabId, removeInfo) => webext.tabs.emit('removed', tabId, removeInfo);
  const onCreated = tab => webext.tabs.emit('created', tab);
  const onUpdated = (tabId, changeInfo, tab) => webext.tabs.emit('updated', tabId, changeInfo, tab);

  webext.tabs = new EventEmitter({
    removed: {
      first: () => chrome.tabs.onRemoved.addListener(onRemoved),
      last: () => chrome.tabs.onRemoved.removeListener(onRemoved)
    },
    created: {
      first: () => chrome.tabs.onCreated.addListener(onCreated),
      last: () => chrome.tabs.onCreated.removeListener(onCreated)
    },
    updated: {
      first: () => chrome.tabs.onUpdated.addListener(onUpdated),
      last: () => chrome.tabs.onUpdated.removeListener(onUpdated)
    }
  }, chrome.tabs);
}

webext.tabs.query = queryInfo => new Promise(resolve => chrome.tabs.query(queryInfo, resolve));

webext.tabs.current = () => new Promise(resolve => chrome.tabs.query({
  active: true,
  currentWindow: true
}, ([tab]) => resolve(tab)));

webext.tabs.single = createProperties => new Promise(resolve => chrome.tabs.query({
  url: chrome.runtime.getURL(createProperties.url)
}, tabs => {
  if (tabs && tabs.length) {
    chrome.tabs.update(tabs[0].id, {
      active: true
    }, () => resolve({
      tab: tabs[0],
      method: 'update'
    }));
    chrome.windows.update(tabs[0].windowId, {
      focused: true
    });
  }
  else {
    return webext.tabs.create(createProperties, tab => resolve({
      tab,
      method: 'create'
    }));
  }
}));

webext.tabs.execute = {};
webext.tabs.execute.script = (tabId, details) => new Promise((resolve, reject) => {
  chrome.tabs.executeScript(tabId, details, arr => {
    const lastError = chrome.runtime.lastError;
    if (lastError) {
      reject(new Error(lastError.message));
    }
    else {
      resolve(arr);
    }
  });
});
// webext/core/chrome.storage.js
/*
  webext.storage
  Event: changed
*/
{
  const callback = changes => {
    webext.storage.emit('changed', changes);
  };

  webext.storage = new EventEmitter({
    changed: {
      first: () => chrome.storage.onChanged.addListener(callback),
      last: () => chrome.storage.onChanged.removeListener(callback)
    }
  }, chrome.storage.local);
}
webext.storage.get = items => new Promise(resolve => chrome.storage.local.get(items, resolve));
webext.storage.set = items => new Promise(resolve => chrome.storage.local.set(items, resolve));
// webext/core/chrome.windows.js
webext.windows = Object.assign({}, chrome.windows);

webext.windows.current = () => new Promise(resolve => chrome.windows.getCurrent(resolve));
webext.windows.create = createData => new Promise(resolve => chrome.windows.create(createData, resolve));
webext.windows.single = createData => {
  const url = createData.url.startsWith('http') ? createData.url : chrome.runtime.getURL(createData.url);
  chrome.tabs.query({
    url
  }, tabs => {
    if (tabs && tabs.length) {
      chrome.tabs.update(tabs[0].id, {
        active: true
      });
      chrome.windows.update(tabs[0].windowId, {
        focused: true
      });
    }
    else {
      return webext.windows.create(createData);
    }
  });
};
// webext/core/chrome.downloads.js
/*
  webext.downloads
  Events: changed
*/
{
  const onCreated = item => webext.downloads.emit('created', item);
  const onErased = item => webext.downloads.emit('erased', item);
  const onChanged = item => webext.downloads.emit('changed', item);

  webext.downloads = new EventEmitter({
    created: {
      first: () => chrome.downloads.onCreated.addListener(onCreated),
      last: () => chrome.downloads.onCreated.removeListener(onCreated)
    },
    erased: {
      first: () => chrome.downloads.onErased.addListener(onErased),
      last: () => chrome.downloads.onErased.removeListener(onErased)
    },
    changed: {
      first: () => chrome.downloads.onChanged.addListener(onChanged),
      last: () => chrome.downloads.onChanged.removeListener(onChanged)
    },
  }, chrome.downloads);
}
