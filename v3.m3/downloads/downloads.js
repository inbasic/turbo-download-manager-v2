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

'use strict';

const downloads = {
  cache: {},
  NORMAL_START_INDEX: 100000,
  index: 100000
};

downloads.intercept = {
  start(href, referrer) {
    if (referrer) {
      return new Promise(resolve => chrome.runtime.sendMessage({
        method: 'downloads.set.referrer',
        href,
        referrer
      }, resolve));
    }
    return Promise.resolve();
  },
  stop(id) {
    setTimeout(() => chrome.runtime.sendMessage({
      method: 'downloads.remove.referrer',
      id
    }), 5000);
  }
};

downloads.download = (options, callback = () => {}, configs = {}, start = true) => {
  if (!options.filename) {
    delete options.filename;
  }
  if (typeof options.urls === 'undefined') {
    if (configs['max-number-of-threads'] === 1 && configs['use-native-when-possible']) {
      return File.prototype.store(options).then(callback);
    }
    options.urls = [options.url];
  }
  else {
    options.url = options.urls[0];
  }
  const id = downloads.index;
  downloads.index += 1;
  const post = obj => {
    const o = {
      ...obj,
      id
    };
    chrome.runtime.sendMessage({
      method: 'downloads.changed',
      o
    });
  };
  const info = downloads.cache[id] = {
    state: 'in_progress', // "in_progress", "interrupted", or "complete"
    exists: true,
    paused: true,
    id,
    links: options.urls,
    offsets: [0] // keep track of offsets for segmented requests
  };

  let core; // keep track of the active core
  const observe = {
    file: file => info.file = file,
    extra: extra => {
      info.links = extra.links || info.links;
      info.offsets = extra.offsets || info.offsets;
      if (extra.referrer && extra.links) {
        options.referrer = extra.referrer;
      }
    },
    error: e => console.warn('a fetch request is broken', e)
  };

  observe.complete = (success, error) => {
    const onerror = async error => {
      console.warn('Job Failed:', error.message);
      info.error = error.message;
      info.state = 'interrupted';
      // we cannot download, let's use native
      if (
        core.properties.restored !== false &&
        core.properties.downloaded === 0 &&
        info.links.length < 2 &&
        configs['use-native-when-possible'] &&
        info.dead !== true
      ) {
        File.prototype.store(options).then(nativeID => chrome.runtime.sendMessage({
          method: 'downloads.search',
          id: nativeID
        }, ([native]) => {
          post({native});
          try {
            info.file.remove();
          }
          catch (e) {}
          delete downloads.cache[id];
        }));
      }
      else if (
        info.links.length &&
        core.properties.downloaded === 0 &&
        info.dead !== true
      ) {
        info.error += '. Using fetch API...';
        info.state = 'in_progress';
        if (!info.file) {
          info.file = new File(undefined, configs['use-memory-disk']);
          await info.file.open();
        }
        // abort native fetch if pause is requested or response status is not okay
        const controller = new AbortController();
        core.pause = () => {
          controller.abort();
        };

        const href = core.properties.link;
        downloads.intercept.start(href, options.referrer).then(id => {
          downloads.intercept.stop(id);
          fetch(href, {
            signal: controller.signal
          }).then(r => {
            if (r.ok) {
              // we don't have filename info when the first chunk is not supporting threading
              Object.assign(core.properties, core.guess(r), {
                mime: r.headers.get('Content-Type')
              });
              r.arrayBuffer().then(ab => {
                const buffer = new Uint8Array(ab);
                info.file.chunks({
                  buffer,
                  offset: core.properties['disk-write-offset']
                }).then(() => {
                  info.file.ready = true;
                  observe.complete(true);
                }).catch(e => {
                  info.dead = true;
                  onerror(e);
                });
              });
            }
            else {
              info.dead = true;
              controller.abort();
              onerror(Error('Failed to fetch'));
            }
          }).catch(() => {
            info.dead = true;
            controller.abort();
            onerror(Error('Failed to fetch'));
          });
        });
      }
      post({
        [info.state === 'interrupted' ? 'error' : 'warning']: {current: info.error}
      });
    };

    const index = info.links.indexOf(core.properties.link);
    if (success && index + 1 === info.links.length) {
      const offset = core.properties.size + core.properties['disk-write-offset'];
      info.offsets.push(offset);
      info.state = 'complete';

      core.download({
        offsets: info.offsets,
        keys: options.keys
      }, native => {
        post({native});
        delete downloads.cache[id];
      }).catch(e => {
        info.dead = true;
        onerror(e);
      });
    }
    else if (success) {
      const offset = core.properties.size + core.properties['disk-write-offset'];

      downloads.intercept.start(info.links[index + 1], options.referrer).then(id => {
        downloads.intercept.stop(id);
        core = new window.Get({configs, observe});
        // use user-defined filename
        core.properties.filename = options.filename || '';
        core.properties.file = info.file;
        core.properties['disk-write-offset'] = offset;
        info.offsets.push(offset);
        info.core = core;

        core.fetch(info.links[index + 1]);
      });
    }
    else {
      onerror(error);
    }
  };
  observe.paused = current => {
    info.paused = current;
    if (current === false) {
      info.error = '';
    }
    info.state = 'in_progress';
    if (current && core.properties.downloaded === core.properties.size && core.properties.downloaded) {
      info.state = 'transfer';
    }
    post({
      state: {current: 'transfer'},
      paused: {current},
      canResume: {current}
    });
  };
  observe.headers = response => {
    core.properties.finalUrl = response.url;

    const {filename, fileextension} = core.properties;
    post({
      filename: {
        current: fileextension ? filename + '.' + fileextension : filename
      },
      totalBytes: {current: core.properties.size}
    });
  };

  info.core = core = new class extends window.Get {
    async resume(...args) {
      const id = await downloads.intercept.start(this.properties.link, options.referrer);
      downloads.intercept.stop(id);
      return super.resume(...args);
    }
  }({configs, observe});

  Object.assign(core.properties, {
    filename: options.filename || '', // use user-defined filename
    extra: {
      links: [...options.urls], // this will cause links to be appended to the db
      referrer: options.referrer
    }
  });

  configs = core.configs; // read back all configs from core after being fixed

  if (start) {
    downloads.intercept.start(options.url, options.referrer).then(id => {
      downloads.intercept.stop(id);
      core.fetch(options.url);
    });
  }
  callback(id);
  chrome.runtime.sendMessage({
    method: 'downloads.create',
    info
  });
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
  downloads.cache[id].dead = true;
  downloads.cache[id].state = 'interrupted';
  downloads.cache[id].error = 'USER_CANCELED';
  // try {
  //   downloads.cache[id].core.properties.file.remove();
  // }
  // catch (e) {
  //   console.warn('Cannot remove file', e);
  // }
  // downloads.cache[id].exists = false;
  downloads.cache[id].core.observe.complete(false, Error('USER_CANCELED'));
  callback();
};

const sections = core => [...core.ranges].map(r => {
  for (const get of core.gets) {
    if (get.offset === r[0]) {
      return [get.offset, get.offset + get.size];
    }
  }
  return r;
});
const object = ({id, state, exists, paused, core, error, links}) => {
  const {queue, mime, downloaded, size, filename = '', fileextension, finalUrl, link, restored} = core.properties;
  return {
    id,
    state,
    queue,
    exists,
    paused,
    filename: fileextension ? filename + '.' + fileextension : filename,
    finalUrl: finalUrl || link,
    mime,
    bytesReceived: downloaded,
    totalBytes: size,
    m3u8: {
      current: links.indexOf(link || finalUrl),
      count: links.length
    },
    sections: sections(core),
    speed: core.speed ? core.speed() : 0,
    threads: core.gets.size,
    error,
    restored
  };
};

chrome.runtime.onMessage.addListener((request, sender, response) => {
  if (request.method === 'downloads.resume') {
    downloads.cache[request.id].core.resume();
    response();
  }
  else if (request.method === 'downloads.pause') {
    downloads.cache[request.id].core.pause();
    response();
  }
  else if (request.method === 'downloads.cancel') {
    downloads.cancel(request.id, response);
    return true;
  }
  else if (request.method === 'downloads.erase') {
    try {
      downloads.cache[request.id].core.properties.file.remove();
    }
    catch (e) {
      console.warn('Cannot remove internal file', e);
    }
    delete downloads.cache[request.id];
  }
  else if (request.method === 'downloads.download') {
    downloads.download(request.options, response, request.configs, request.start);
    return true;
  }
  else if (request.method === 'downloads.search.id') {
    const o = downloads.cache[request.id];
    response(request.comprehensive ? object(o) : o);
  }
  else if (request.method === 'downloads.search') {
    downloads.search(request.options, ds => {
      if (request.comprehensive) {
        response(ds.map(object));
      }
      else {
        response(ds);
      }
    });
    return true;
  }
});

// restore indexdb
document.addEventListener('DOMContentLoaded', async () => {
  const os = 'databases' in indexedDB ? await indexedDB.databases() : Object.keys(localStorage)
    .filter(name => name.startsWith('file:'))
    .map(name => ({
      name: name.replace('file:', '')
    }));

  for (const o of os) {
    downloads.download({}, id => {
      const {core} = downloads.cache[id];
      core.restore(o.name).catch(e => {
        console.warn('Cannot restore segments. This database will be removed', e, core);
        try {
          core.properties.file.remove();
          delete downloads.cache[id];
        }
        catch (e) {}
      });
    }, undefined, false);
  }
});
