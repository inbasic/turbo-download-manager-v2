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

class File { /* write to disk */
  constructor(id = 'file:' + Math.random()) {
    this.id = id;
    this.opened = false;
  }
  async space(size) {
    const {quota, usage} = await navigator.storage.estimate();
    if (quota - usage < size) {
      throw Error(`FATAL: requested filesize is "${size}", but granted filesize is "${quota - usage}"`);
    }
  }
  async open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.id, 1);
      request.onupgradeneeded = () => {
        // TODO - Remove this line when Firefox supports indexedDB.databases()
        if (('databases' in indexedDB) === false) {
          localStorage.setItem('file:' + this.id, true);
        }
        // storage for chunks
        request.result.createObjectStore('chunks', {
          keyPath: 'offset'
        });
        request.result.createObjectStore('meta', {
          autoIncrement: true
        });
      };
      request.onerror = e => reject(Error('File.open, ' + e.target.error));
      request.onsuccess = () => {
        this.db = request.result;
        this.opened = true;
        resolve();
      };
    });
  }
  meta(...objs) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('meta', 'readwrite');
      transaction.oncomplete = resolve;
      transaction.onerror = e => reject(Error('File.meta, ' + e.target.error));
      for (const obj of objs) {
        transaction.objectStore('meta').add(obj);
      }
    });
  }
  properties() {
    // get data and convert to blob
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('meta', 'readonly');
      const store = transaction.objectStore('meta');
      const meta = store.getAll();
      meta.onsuccess = function() {
        resolve(meta.result);
      };
      meta.onerror = e => reject(Error('File.properties, ' + e.target.error));
    });
  }
  chunks(...objs) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('chunks', 'readwrite');
      transaction.oncomplete = resolve;
      transaction.onerror = e => reject(Error('File.chunks, ' + e.target.error));
      for (const obj of objs) {
        transaction.objectStore('chunks').add(obj);
      }
    });
  }
  async ranges() {
    let downloaded = 0;
    const objects = await this.objects();
    const rRanges = objects.map(a => [a.offset, a.offset + a.buffer.byteLength]);
    rRanges.sort((a, b) => a[0] - b[0]);
    const ranges = [];
    if (rRanges.length === 0) {
      return {ranges, downloaded};
    }
    let start = rRanges[0][0];
    let end = rRanges[0][0];
    rRanges.forEach((range, i) => {
      downloaded += range[1] - range[0];
      if (end === range[0]) {
        end = range[1];
      }
      else {
        ranges.push([start, end - 1]);

        start = rRanges[i][0];
        end = rRanges[i + 1] ? rRanges[i + 1][0] : NaN;
      }
    });
    ranges.push([start, rRanges.pop()[1] - 1]);

    return {ranges, downloaded};
  }
  objects() {
    // get data and convert to blob
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('chunks', 'readonly');
      const chunks = [];
      transaction.objectStore('chunks').openCursor().onsuccess = e => {
        const cursor = e.target.result;
        if (cursor) {
          chunks.push(cursor.value);
          cursor.continue();
        }
      };
      transaction.onerror = e => reject(Error('File.objects, ' + e.target.error));
      transaction.oncomplete = () => resolve(chunks);
    });
  }
  blob(type) {
    return this.objects().then(os => new Blob(os.map(o => o.buffer), {
      type
    }));
  }
  async download(filename = 'unknown', mime, started = () => {}) {
    // console.log('BLOB STATE', Date());
    const blob = await this.blob(mime);
    // console.log('BLOB END', Date());
    const url = URL.createObjectURL(blob);

    return new Promise((resolve, reject) => {
      chrome.downloads.download({
        url,
        filename
      }, id => {
        chrome.downloads.search({
          id
        }, ([d]) => started(d));
        function observe(d) {
          if (d.id === id && d.state) {
            if (d.state.current === 'complete' || d.state.current === 'interrupted') {
              chrome.downloads.onChanged.removeListener(observe);
              URL.revokeObjectURL(url);
              if (d.state.current === 'complete') {
                chrome.downloads.search({id}, ([d]) => {
                  if (d) {
                    resolve(d);
                  }
                  else {
                    reject(Error('I am not able to find the downloaded file!'));
                  }
                });
              }
              else {
                reject(Error('The downloading job got interrupted'));
              }
            }
          }
        }
        chrome.downloads.onChanged.addListener(observe);
      });
    });
  }
  remove() {
    if (this.db) {
      this.db.close();
    }
    if (('databases' in indexedDB) === false) {
      localStorage.removeItem('file:' + this.id);
    }
    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(this.id);
      request.onsuccess = () => {
        resolve();
      };
      request.onerror = e => reject(Error(e.target.error));
    });
  }
}
class SGet { /* a single threading get */
  constructor({
    observe,
    offset // append this bytes offset to disk calls
  }) {
    this.observe = {
      connected() {},
      disk() {},
      warning() {},
      ...observe
    };
    this.size = 0;
    this.offset = offset || 0;
    // if provided, the download is aborted when the content size passes this value
    this['max-size'] = 0;
  }
  async fetch(link, {
    headers = {}
  }) {
    const controller = this.controller = new AbortController();
    const response = await fetch(link, {
      headers,
      credentials: 'include',
      signal: controller.signal
    });
    this.observe.connected(response);
    const reader = response.body.getReader();
    for (;;) {
      const {done, value} = await reader.read();
      if (value && value.byteLength) {
        if (this['max-size']) {
          if (this.size < this['max-size']) {
            const ok = this.size + value.byteLength <= this['max-size'];
            const o = {
              buffer: ok ? value : value.slice(0, this['max-size'] - this.size),
              offset: this.offset + this.size
            };
            this.observe.disk(o);
            this.size += o.buffer.byteLength;
            if (ok === false) {
              controller.abort();
              break;
            }
          }
          else {
            this.observe.warning('Still fetching data which is not needed');
          }
        }
        else {
          this.observe.disk({
            buffer: value,
            offset: this.offset + this.size
          });
          this.size += value.byteLength;
        }
      }
      if (done) {
        break;
      }
    }
    return this.size;
  }
  abort() {
    this.controller.abort();
  }
  policy(method, value) {
    if (method === 'abort-when-size-exceeds') {
      if (value < this.size) {
        throw Error('Download size exceeds the requested size');
      }
      this['max-size'] = value;
    }
  }
}
class MGet { /* extends multi-threading */
  constructor({
    configs = {},
    observe = {}
  }) {
    // keeps track of active ranges
    this.ranges = [];
    // active gets
    this.gets = new class extends Set {
      delete(o) {
        super.delete(o);
        observe.threads(this.size);
      }
      new(...args) {
        const get = new SGet(...args);
        super.add(get);
        observe.threads(this.size);
        return get;
      }
    }();

    let paused = true;
    this.properties = {
      errors: 0, // total number of sequential fails
      downloaded: 0, // number of bytes that is written to the disk
      size: 0 // file-size returned by the server
    };
    // current downloading status
    Object.defineProperty(this.properties, 'paused', {
      get() {
        return paused;
      },
      set(bol) {
        if (paused !== bol) {
          paused = bol;
          observe.paused(bol);
        }
      }
    });
    this.configs = {
      'max-number-of-threads': 5,
      'max-retires': 10,
      'use-native-when-possible': true,
      'min-segment-size': 1 * 1024 * 1024,
      'max-segment-size': 100 * 1024 * 1024, // max size for a single downloading segment
      'overwrite-segment-size': true, // if true, the segment size will be decided when headers received
      ...configs
    };
    this.observe = observe = {
      threads() {}, // called when number of active threads changed
      disk() {}, // called when write is required
      paused() {}, // called when pause status changes
      headers() {}, // called when headers are ready
      complete() {}, // called when downloading ends with or without errors
      error() {}, // called on broken channel
      ...observe
    };
  }
  disk(o) {
    this.properties.downloaded += o.buffer.byteLength;
    this.observe.disk(o);
    if (this.properties.downloaded === this.properties.size) {
      this.properties.paused = true;
      this.observe.complete(true);
    }
    else if (this.properties.downloaded > this.properties.size) {
      this.pause();
      this.observe.complete(false, Error('downloaded size exceeds file size'));
    }
  }
  /*
    get the first available range
    size: file size; max: max range size; reserved: array of bytes that already fetched
  */
  range(size = this.properties.size - 1, max = this.configs['max-segment-size'], reserved = this.ranges) {
    let cursor = 0;
    let offset = 0;
    for (;;) {
      if (offset > size) {
        return;
      }
      else if (reserved[cursor] && reserved[cursor][0] - offset < max) {
        if (reserved[cursor][0] > offset) {
          const range = [offset, reserved[cursor][0] - 1];
          reserved.splice(cursor, 0, range);
          return range;
        }
        offset = reserved[cursor][1] + 1;
        cursor += 1;
      }
      else {
        const range = [offset, Math.min(size, offset + max)];
        reserved.splice(cursor, 0, range);
        return range;
      }
    }
  }
  /* does servers supports threading */
  support(response) {
    const size = Number(response.headers.get('Content-Length'));
    if (!size) {
      return 'FATAL: server does not report size';
    }
    this.properties.size = size;
    const type = response.headers.get('Accept-Ranges');
    if (type !== 'bytes') {
      return 'FATAL: "Accept-Ranges" header is ' + type;
    }
    if (response.headers.get['Length-Computable'] === 'false') {
      return 'FATAL: "Length-Computable" header is false';
    }
  }
  /* fix the range associate with a broken get */
  fix(range, size) {
    const index = this.ranges.indexOf(range);
    if (size) {
      this.ranges[index][1] = this.ranges[index][0] + size - 1;
    }
    else {
      this.ranges.splice(index, 1);
    }
  }
  /* staring point for new downloads only */
  async fetch(link, headers = {}) {
    const {gets, properties, observe, configs} = this;
    properties.link = link;
    properties.headers = headers;
    const get = gets.new({
      observe: {
        disk: o => this.disk(o),
        connected: response => {
          const e = this.support(response);
          if (e) {
            this.pause();
            return observe.complete(false, Error(e));
          }
          // everything looks fine. Let's fix max-segment-size
          if (configs['overwrite-segment-size']) {
            configs['max-segment-size'] = Math.max(
              configs['min-segment-size'],
              Math.floor(properties.size / configs['max-number-of-threads'])
            );
          }
          // Let's do threading
          range = this.range();
          // break this initial get at the end of the first range
          get.policy('abort-when-size-exceeds', range[1] + 1);
          this.thread();
          observe.headers(response);
        }
      }
    });
    properties.paused = false;
    let range;
    try {
      await get.fetch(link, {headers});
    }
    catch (e) {
      this.fix(range, get.size);
      // if nothing is downloaded from the initial segment, stop
      if (properties.paused === false) {
        observe.error(e);
        if (properties.downloaded === 0) {
          properties.paused = true;
          observe.complete(false, e);
        }
      }
    }
    gets.delete(get);
    if (properties.paused === false) {
      this.thread();
    }
  }
  /* check to see if we can add a new thread or not */
  async thread() {
    const {observe, gets, properties, configs} = this;

    if (gets.size >= configs['max-number-of-threads']) { // max reached
      return;
    }
    if (properties.errors > configs['max-retires']) { // max retries
      if (gets.size === 0) {
        properties.paused = true;
        observe.complete(false, Error('max retires reached'));
      }
      return;
    }
    if (properties.paused) { // paused state
      return;
    }
    if (properties.downloaded > properties.size) { // max retries
      properties.paused = true;
      observe.complete(false, Error('filesize is smaller than downloaded sections'));
      return;
    }
    const range = this.range();
    if (!range) { // no segment left
      if (gets.size === 0) {
        properties.paused = true;
        observe.complete(false, Error('no range left and there is no ongoing thread'));
      }
      return;
    }
    const get = gets.new({
      offset: range[0],
      observe: {
        disk: o => this.disk(o),
        connected: response => {
          if (response.ok && response.status === 206) {
            this.thread();
            // since we have a new connection clear the errors count
            properties.errors = 0;
          }
          else if (response.status !== 206) {
            this.pause();
            observe.complete(false, Error('response type of a segmented request is not 206'));
          }
        }
      }
    });
    // clone the fetch options and append range value
    try {
      await get.fetch(properties.link, {
        headers: {
          ...properties.headers,
          Range: 'bytes=' + range.join('-')
        }
      });
    }
    catch (e) {
      if (properties.paused === false) {
        properties.errors += 1;
        observe.error(e);
      }
      // fix the range after broken pipe exited
      this.fix(range, get.size);
    }
    gets.delete(get);
    this.thread();
  }
  increase() {
    this.configs['max-number-of-threads'] = Math.min(10, this.configs['max-number-of-threads'] + 1);
    this.thread();
  }
  decrease() {
    this.configs['max-number-of-threads'] = Math.max(1, this.configs['max-number-of-threads'] - 1);
    const values = this.gets.values();
    const get = values.next().value;
    if (get) {
      get.abort();
    }
  }
  pause() {
    this.properties.paused = true;
    for (const get of this.gets) {
      get.abort();
    }
  }
  resume() {
    const {properties, configs} = this;;
    properties.paused = false;
    properties.errors = 0;
    // revisit segment size
    if (configs['overwrite-segment-size']) {
      configs['max-segment-size'] = Math.max(
        configs['min-segment-size'],
        Math.floor((properties.size - properties.downloaded) / configs['max-number-of-threads'])
      );
    }
    this.thread();
  }
}
class MSGet extends MGet { /* extends speed calculation */
  constructor(...args) {
    super(...args);

    const {configs, properties, observe} = this;
    configs['speed-over-seconds'] = configs['speed-over-seconds'] || 10;

    const states = properties.states = {}; // keep stat objects for each pause period
    const times = [];
    let downloaded = properties.downloaded;
    Object.defineProperty(properties, 'downloaded', {
      get() {
        return downloaded;
      },
      set(value) {
        const bytes = value - downloaded;
        const time = (Date.now() / 1000).toFixed(0).toString();
        if (times.indexOf(time) === -1) {
          times.push(time);
          states[time] = 0;
          for (const time of times.splice(0, times.length - configs['speed-over-seconds'])) {
            delete states[time];
          }
        }
        states[time] += bytes;
        //
        downloaded = value;
      }
    });
    // overwrite paused observer
    const {paused} = observe;
    observe.paused = bol => {
      if (bol) {
        for (const time of times) {
          delete states[time];
        }
      }
      paused(bol);
    };
  }
  speed() {
    const bytes = Object.values(this.properties.states);
    return bytes.length ? bytes.reduce((p, c) => p + c, 0) / bytes.length : 0;
  }
  progress() {
    const {size, downloaded} = this.properties;
    return (downloaded / size * 100).toFixed(1);
  }
}
class FGet extends MSGet { /* extends write to disk */
  constructor(...args) {
    super(...args);
    const {observe, configs, properties} = this;
    configs['max-simultaneous-writes'] = configs['max-simultaneous-writes'] || 3;

    const {complete, headers} = observe;
    // only get called when there is no active disk write
    let rargs = false; // releasing arguments
    observe.complete = (...args) => {
      const success = args[0];
      if (success === false) {
        complete(...args);
      }
      else if (instances === 0 && file.opened) { // make sure file is opened
        file.ready = true;
        complete(...args);
      }
      else {
        rargs = args;
      }
    };

    // a dummy file
    let file = {
      opened: false
    };
    // temporary storage until disk is ready
    const caches = [];
    const diskerror = e => {
      this.pause();
      complete(false, e);
    };
    // write to disk
    let instances = 0;
    const disk = async () => {
      if (instances >= configs['max-simultaneous-writes'] || file.opened === false) {
        return;
      }
      if (caches.length === 0) {
        if (instances === 0 && rargs) {
          // console.log('DISK COMPLETE', Date());
          file.ready = true;
          complete(...rargs);
        }
        return;
      }
      instances += 1;
      const objs = [];
      while (caches.length) {
        objs.push(caches.pop());
      }
      await file.chunks(...objs).catch(diskerror);
      instances -= 1;
      disk();
    };
    observe.disk = o => {
      caches.push(o);
      disk(o);
    };
    // open file when headers are ready and check disk space
    observe.headers = (...args) => {
      if (properties.file === undefined) {
        file = properties.file = new File();
      }
      else {
        file = properties.file;
      }
      // open file
      file.open().then(disk).catch(diskerror).then(() => file.meta({
        link: properties.link,
        configs
      }));
      // check disk space
      file.space(properties.size).catch(diskerror);
      headers(...args);
    };
  }
  /* download the file to user disk (only call when there is no instance left) */
  async download(un, um, started, verify = false) {
    const {file, filename, mime, size} = this.properties;
    if (file.ready && file.opened) {
      const download = async () => {
        await file.download(un || filename || 'unknown', um || mime, started);
        await file.remove();
      };
      if (verify) {
        const {ranges, downloaded} = await file.ranges();
        if (downloaded === size && ranges.length === 1) {
          return await download();
        }
      }
      else {
        return await download();
      }
      throw Error('File cannot be verified');
    }
    throw Error('File is not ready');
  }
}
class NFGet extends FGet { /* extends filename guessing */
  constructor(...args) {
    super(...args);

    const {properties, observe} = this;
    const {headers} = observe;
    observe.headers = response => {
      properties.filename = this.guess(response.headers);
      properties.mime = response.headers.get('Content-Type');
      headers(response);
    };
  }
  guess(headers) {
    const disposition = headers.get('Content-Disposition');
    let name = '';
    // get name from Content-Disposition
    if (!name && disposition) {
      const tmp = /filename\*=UTF-8''([^;]*)/.exec(disposition);
      if (tmp && tmp.length) {
        name = tmp[1].replace(/["']$/, '').replace(/^["']/, '');
        name = decodeURIComponent(name);
      }
    }
    if (!name && disposition) {
      const tmp = /filename=([^;]*)/.exec(disposition);
      if (tmp && tmp.length) {
        name = tmp[1].replace(/["']$/, '').replace(/^["']/, '');
      }
    }
    if (disposition && name) {
      const arr = [...name].map(v => v.charCodeAt(0)).filter(v => v <= 255);
      name = (new TextDecoder('UTF-8')).decode(Uint8Array.from(arr));
    }
    // get name from URL
    if (!name) {
      const url = this.properties.link.replace(/\/$/, '');
      const tmp = /(title|filename)=([^&]+)/.exec(url);
      if (tmp && tmp.length) {
        name = tmp[2];
      }
      else {
        name = url.substring(url.lastIndexOf('/') + 1);
      }
      name = decodeURIComponent(name.split('?')[0].split('&')[0]) || 'unknown-name';
      return name;
    }
    // extracting extension from file name
    const se = /\.\w{2,}$/.exec(name);
    if (se && se.length) {
      name = name.replace(se[0], '');
    }
    // removing exceptions
    name = name.replace(/[\\/:*?"<>|"]/g, '-');
    // removing trimming white spaces
    name = name.trim();
    // append extension
    if (se && se.length) {
      return name + se[0];
    }
    return name;
  }
}
class SNGet extends NFGet { /* extends session restore */
  /* id = get.properties.file.id */
  async restore(id) {
    const file = new File(id);
    this.properties.file = file;
    await file.open();
    const properties = {};
    for (const o of await file.properties()) {
      Object.assign(properties, o);
    }
    if (properties.link === undefined) {
      throw Error('Cannot find link address');
    }
    if (properties.configs) {
      Object.assign(this.configs, properties.configs);
    }
    // restore ranges
    const {ranges, downloaded} = await file.ranges();

    // restore response
    const response = await fetch(properties.link);
    if (response.ok) {
      const message = this.support(response);
      if (message) {
        throw Error(message);
      }
      this.ranges = ranges;
      this.properties.link = properties.link;
      this.properties.downloaded = downloaded;

      this.observe.headers(response);
    }
    else {
      throw Error('server response is not ok');
    }
  }
}
window.Get = SNGet;

// const link = 'http://localhost:2000/file.dmg';
// const get = new SNGet({
//   configs: {
//     'max-segment-size': 10 * 1024 * 1024, // max size for a single downloading segment
//     'max-number-of-threads': 5,
//     'max-retires': 5,
//     'speed-over-seconds': 10,
//     'max-simultaneous-writes': 1
//   },
//   observe: {
//     threads: n => console.log('Number of active threads:', n),
//     complete(success, message) {
//       console.log('DONE', success, message);
//       if (success) {
//         get.download();
//       }
//     },
//     paused: bol => console.log('Paused', bol),
//     headers: e => console.log('Headers Ready', e),
//     error: e => console.log('Error Occurred', e)
//   }
// });
// get.fetch(link, {});
