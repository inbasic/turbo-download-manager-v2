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

/**
Tests:
1. file with no content-type header:
https://tuxproject.de/projects/vim/

2. partial download (402 Payment Required)
https://gz.blockchair.com/bitcoin/addresses/

3. wrong filename
https://www.mozilla.org/en-CA/firefox/all/#product-desktop-release

4. M3U8
https://videojs.com/
https://www.radiantmediaplayer.com/media/rmp-segment/bbb-abr-aes/playlist.m3u8

5. M3U8 AES-128 encrypted
http://demo.theoplayer.com/drm-aes-protection-128-encryption?hsCtaTracking=cc0cef76-cc09-40b0-8e84-c1c278ec8764%7C6c30cfd0-2817-49e5-addc-b1a5afc68170

6. HLS that needs referrer header
https://anime.anidub.life/anime/anime_ongoing/11270-devushki-poni-enkoma-umayon-01-iz-13.html

7. referrer needed
https://seinfeld9.com/episodes/seinfeld-season-1-episode-1/

*/

'use strict';

const manager = {
  PUASE_ON_META: 3,
  NOT_START_INDEX: 200000,
  nindex: 200000,
  ncache: {},
  listeners: {
    change: new Set()
  },

  native(id) {
    return id < 100000; /* downloads.NORMAL_START_INDEX; */
  },
  schedule(job, store = true) {
    const olinks = Object.values(manager.ncache).map(o => o.url);
    job.url = job.url || job.link;
    delete job.link;
    delete job.id;

    if (olinks.indexOf(job.url) === -1) {
      const id = manager.nindex;

      manager.nindex += 1;
      manager.ncache[id] = {
        filename: job.url.split('/').pop(),
        id,
        state: 'not_started',
        ...job
      };

      if (store) {
        chrome.storage.sync.set({
          jobs: Object.values(manager.ncache),
          links: []
        });
      }
    }
    return Promise.resolve();
  },
  search(options, callback, comprehensive = true) {
    if (options.id && options.id >= manager.NOT_START_INDEX) {
      callback([manager.ncache[options.id]]);
    }
    else if (options.id && manager.native(options.id) === false) {
      chrome.runtime.sendMessage({
        method: 'downloads.search.id',
        id: options.id,
        comprehensive
      }, o => callback([o]));
      return;
    }
    else if (options.id) {
      if (manager.native(options.id)) {
        chrome.downloads.search(options, callback);
      }
      else {
        chrome.runtime.sendMessage({
          method: 'downloads.search',
          options
        }, callback);
      }
    }
    else if (options.state === 'not_started') {
      callback(Object.values(manager.ncache));
    }
    else {
      Promise.all([
        new Promise(resolve => chrome.runtime.sendMessage({
          method: 'downloads.search',
          options,
          comprehensive
        }, resolve)),
        options.state && options.state === 'transfer' ?
          Promise.resolve([]) :
          new Promise(resolve => chrome.downloads.search(options, resolve))
      ]).then(arr => arr.flat()).then(callback);
    }
  },
  resume(id, callback) {
    if (manager.native(id)) {
      return chrome.downloads.resume(id, callback);
    }
    chrome.runtime.sendMessage({
      method: 'downloads.resume',
      id
    }, callback);
  },
  pause(id, callback) {
    if (manager.native(id)) {
      return chrome.downloads.pause(id, callback);
    }
    chrome.runtime.sendMessage({
      method: 'downloads.pause',
      id
    }, callback);
  },
  cancel(id, callback = () => {}) {
    if (manager.native(id)) {
      return chrome.downloads.cancel(id, callback);
    }
    chrome.runtime.sendMessage({
      method: 'downloads.cancel',
      id
    }, callback);
  },
  erase(query, callback = () => {}) {
    manager.search(query, (ds = []) => {
      for (const {id} of ds) {
        if (id >= manager.NOT_START_INDEX) {
          delete manager.ncache[id];
          chrome.storage.sync.set({
            jobs: Object.values(manager.ncache)
          });
        }
        else if (manager.native(id) === false) {
          chrome.runtime.sendMessage({
            method: 'downloads.erase',
            id
          });
        }
        else {
          chrome.downloads.erase({
            id
          });
        }
      }
      callback(ds.map(d => d.id));
    }, false);
  },
  download(options, callback = () => {}, configs = {}, start = true) {
    manager.search({
      state: 'in_progress'
    }, ds => {
      if (start && ds.filter(d => d.paused === false).length >= manager.PUASE_ON_META) {
        configs['pause-on-meta'] = true;
      }
      chrome.runtime.sendMessage({
        method: 'downloads.download',
        options,
        configs,
        start
      }, callback);
    }, false);
  },
  onChanged: {
    addListener(c) {
      manager.listeners.change.add(c);
    }
  }
};

chrome.downloads.onChanged.addListener(o => {
  for (const c of manager.listeners.change) {
    c(o);
  }
});
chrome.runtime.onMessage.addListener(request => {
  if (request.method === 'downloads.changed') {
    for (const c of manager.listeners.change) {
      c(request.o);
    }
  }
});


// start from queue
{
  let id;
  const next = () => manager.search({
    state: 'in_progress'
  }, ds => {
    if (ds.filter(d => d.paused === false) < manager.PUASE_ON_META) {
      const d = ds.filter(d => d.paused && d.core && d.core.properties.queue).shift();
      if (d) {
        d.core.resume();
      }
    }
  }, false);
  const c = () => {
    clearTimeout(id);
    id = setTimeout(next, 300);
  };
  manager.onChanged.addListener(c);
}

// restore not started
chrome.storage.sync.get({
  links: [],
  jobs: []
}, prefs => {
  chrome.runtime.lastError;
  if (prefs && prefs.links.length) {
    for (const url of prefs.links) {
      manager.schedule({
        url
      }, false);
    }
  }
  if (prefs && prefs.jobs.length) {
    for (const job of prefs.jobs) {
      manager.schedule(job, false);
    }
  }
});

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
