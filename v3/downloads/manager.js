'use strict';

const downloads = {
  cache: {},
  START_INDEX: 10000,
  index: 10000,
  listeners: {
    onCreated: [],
    onChanged: []
  }
};

downloads.download = (options, callback = () => {}, configs = {}, start = true) => {
  if (configs['max-number-of-threads'] === 1 && configs['use-native-when-possible']) {
    return chrome.downloads.download(options, callback);
  }
  const id = downloads.index;
  downloads.index += 1;
  const post = obj => {
    const o = {
      ...obj,
      id
    };
    downloads.listeners.onChanged.forEach(c => c(o));
  };
  const info = {
    state: 'in_progress', // "in_progress", "interrupted", or "complete"
    exists: true,
    paused: true,
    id
  };
  const core = new window.Get({
    configs,
    observe: {
      complete(success, error) {
        info.state = success ? 'complete' : 'interrupted';
        if (success) {
          core.download(undefined, undefined, native => {
            post({native});
            delete downloads.cache[id];
          });
        }
        else {
          console.warn('Downloading Failed', error);
          info.error = error.message;
          post({
            error: {current: info.error}
          });
          // we cannot download, let's use native
          if (
            core.properties.downloaded === 0 &&
            configs['use-native-when-possible'] &&
            error.message !== 'USER_CANCELED'
          ) {
            chrome.downloads.download(options, nativeID => chrome.downloads.search({
              id: nativeID
            }, ([native]) => {
              post({native});
              delete downloads.cache[id];
            }));
          }
        }
      },
      paused(current) {
        info.paused = current;
        if (current && core.properties.downloaded === core.properties.size && core.properties.downloaded) {
          info.state = 'transfer';
        }
        post({
          state: {current: 'transfer'},
          paused: {current},
          canResume: {current}
        });
      },
      headers(response) {
        core.properties.finalUrl = response.url;
        post({
          filename: {current: core.properties.filename},
          totalBytes: {current: core.properties.size}
        });
      },
      error: e => console.warn('a fetch request is broken', e)
    }
  });
  configs = core.configs; // read back all configs from core after being fixed
  info.core = core;
  downloads.cache[id] = info;


  if (start) {
    core.fetch(options.url);
  }
  callback(id);
  downloads.listeners.onCreated.forEach(c => c(info));
};
downloads.search = (options = {}, callback = () => {}) => {
  let ds = Object.values(downloads.cache);
  if ('paused' in options) {
    ds = ds.filter(({paused}) => options.paused === paused);
  }
  if ('state' in options) {
    ds = ds.filter(({state}) => options.state === state);
  }
  callback(ds);
};
downloads.cancel = (id, callback) => {
  downloads.cache[id].core.pause();
  downloads.cache[id].state = 'interrupted';
  downloads.cache[id].error = 'USER_CANCELED';
  try {
    downloads.cache[id].core.properties.file.remove();
  }
  catch (e) {
    console.warn('Cannot remove file', e);
  }
  downloads.cache[id].exists = false;
  downloads.cache[id].core.observe.complete(false, Error('USER_CANCELED'));
  callback();
};
downloads.onCreated = {
  addListener: c => {
    downloads.listeners.onCreated.push(c);
  }
};
downloads.onChanged = {
  addListener: c => downloads.listeners.onChanged.push(c)
};

const manager = {
  search(options, callback, comprehensive = true) {
    // console.log('manager.search', options, comprehensive);
    const sections = core => [...core.ranges].map(r => {
      for (const get of core.gets) {
        if (get.offset === r[0]) {
          return [get.offset, get.offset + get.size];
        }
      }
      return r;
    });
    const object = ({id, state, exists, paused, core, error}) => {
      const {mime, downloaded, size, filename = '', finalUrl, link} = core.properties;
      return {
        id,
        state,
        exists,
        paused,
        filename,
        finalUrl: finalUrl || link,
        mime,
        bytesReceived: downloaded,
        totalBytes: size,
        sections: sections(core),
        speed: core.speed(),
        threads: core.gets.size,
        error
      };
    };
    if (options.id && options.id >= downloads.START_INDEX) {
      return callback([
        comprehensive ? object(downloads.cache[options.id]) : downloads.cache[options.id]
      ]);
    }
    if (options.id) {
      if (options.id < downloads.START_INDEX) {
        chrome.downloads.search(options, callback);
      }
      else {
        downloads.search(options, callback);
      }
    }
    else {
      Promise.all([
        new Promise(resolve => downloads.search(options, resolve)).then(ds => {
          if (comprehensive) {
            return ds.map(object);
          }
          return ds;
        }),
        options.state && options.state === 'transfer' ?
          Promise.resolve([]) :
          new Promise(resolve => chrome.downloads.search(options, resolve))
      ]).then(arr => arr.flat()).then(callback);
    }
  },
  resume(id, callback) {
    // console.log('manager.resume');
    if (id < downloads.START_INDEX) {
      return chrome.downloads.resume(id, callback);
    }
    downloads.cache[id].core.resume();
    callback();
  },
  pause(id, callback) {
    // console.log('manager.pause');
    if (id < downloads.START_INDEX) {
      return chrome.downloads.pause(id, callback);
    }
    downloads.cache[id].core.pause();
    callback();
  },
  cancel(id, callback) {
    // console.log('manager.cancel');
    if (id < downloads.START_INDEX) {
      return chrome.downloads.cancel(id, callback);
    }
    downloads.cancel(id, callback);
  },
  erase(query, callback = () => {}) {
    // console.log('manager.erase');
    manager.search(query, ds => {
      for (const {id} of ds) {
        if (id < downloads.START_INDEX) {
          chrome.downloads.erase({
            id
          });
        }
        else {
          try {
            downloads.cache[id].core.properties.file.remove();
          }
          catch (e) {
            console.warn('Cannot remove internal file', e);
          }
          delete downloads.cache[id];
        }
      }
      callback(ds.map(d => d.id));
    }, false);
  },
  getFileIcon(id, options, callback) {
    // console.log('manager.getFileIcon');
    if (id < downloads.START_INDEX) {
      return chrome.downloads.getFileIcon(id, options, callback);
    }
    callback('');
  },
  download(...args) {
    downloads.download(...args);
  },
  onChanged: {
    addListener(c) {
      downloads.onChanged.addListener(c);
      chrome.downloads.onChanged.addListener(c);
    }
  }
};

// downloads.download({url: 'http://127.0.0.1:2000/df'}, () => {}, {
//   'max-segment-size': 10 * 1024 * 1024, // max size for a single downloading segment
//   'max-number-of-threads': 5,
//   'overwrite-segment-size': true, // change segment sizes after size is resolved
//   'max-retires': 5,
//   'speed-over-seconds': 10,
//   'max-simultaneous-writes': 3
// });
// window.setTimeout(() => {
//   downloads.pause(10000);
// }, 2000);

// restore
{
  const restore = () => indexedDB.databases().then(os => {
    for (const o of os) {
      downloads.download({}, id => {
        const {core} = downloads.cache[id];
        core.restore(o.name).catch(e => {
          console.warn('Cannot restore segments', e, core);
          try {
            core.properties.file.remove();
            delete downloads.cache[id];
          }
          catch (e) {}
        });
      }, undefined, false);
    }
  });
  chrome.runtime.onStartup.addListener(restore);
  chrome.runtime.onInstalled.addListener(restore);
}
