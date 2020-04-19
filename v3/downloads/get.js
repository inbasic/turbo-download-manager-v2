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
    const objects = await new Promise((resolve, reject) => {
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
  stream() {
    const chunks = [];
    let resolve;
    const transaction = this.db.transaction('chunks', 'readonly');
    const request = transaction.objectStore('chunks').openCursor();
    request.onsuccess = e => {
      const cursor = e.target.result;
      if (cursor) {
        chunks.push(cursor.value.buffer);
        cursor.continue();
      }
      if (resolve) {
        resolve();
      }
    };
    transaction.onerror = e => {
      throw Error('File.stream, ' + e.target.error);
    };
    return new ReadableStream({
      pull(controller) {
        if (chunks.length) {
          controller.enqueue(chunks.shift());
        }
        else if (request.readyState === 'done') {
          controller.close();
        }
        else {
          return new Promise(r => resolve = r).then(() => {
            const chunk = chunks.shift();
            if (chunk) {
              controller.enqueue(chunk);
            }
            else {
              controller.close();
            }
          });
        }
      }
    }, {});
  }
  async download(filename = 'unknown', mime, started = () => {}) {
    const stream = this.stream();
    const response = new Response(stream, {
      headers: {
        'Content-Type': mime
      }
    });
    const blob = await response.blob();
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
      await this.wait();
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
  wait() {
    return Promise.resolve();
  }
  abort() {
    this.controller.abort();
  }
  policy(method, value) {
    if (method === 'abort-when-size-exceeds') {
      if (value < this.size) {
        throw Error('Download size exceeds the requested size.');
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
    const me = this;
    this.gets = new class extends Set {
      delete(o) {
        super.delete(o);
        observe.threads(this.size);
      }
      new(...args) {
        const get = new class extends SGet {
          wait() {
            return me.wait();
          }
        }(...args);
        super.add(get);
        observe.threads(this.size);
        return get;
      }
    }();

    let paused = true;
    this.properties = {
      'errors': 0, // total number of sequential fails
      'downloaded': 0, // number of bytes that is written to the disk
      'size': 0 // file-size returned by the server,
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
      'absolute-max-segment-size': 100 * 1024 * 1024, // no thread size can exceed this value
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
  // use this function to pause network access on all threads
  wait() {
    return Promise.resolve();
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
  fixConfigs() {
    const {configs, properties} = this;

    if (configs['overwrite-segment-size']) {
      configs['max-segment-size'] = Math.max(
        configs['min-segment-size'],
        Math.floor((properties.size - properties.downloaded) / configs['max-number-of-threads'])
      );
    }
    configs['max-segment-size'] = Math.min(
      configs['max-segment-size'],
      configs['absolute-max-segment-size']
    );
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
          this.fixConfigs();
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
        if (properties.downloaded === properties.size) {
          observe.complete(true);
        }
        else {
          observe.complete(false, Error('no range left and there is no ongoing thread'));
        }
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
    // python servers sometimes return more bytes
    get.policy('abort-when-size-exceeds', range[1] - range[0] + 1);
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
    const {properties, configs} = this;
    properties.paused = false;
    properties.errors = 0;
    // revisit segment size
    this.fixConfigs();
    this.thread();
  }
}
class MSGet extends MGet { /* extends speed calculation */
  constructor(...args) {
    super(...args);

    const {configs, properties, observe} = this;

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
  fixConfigs() {
    const {configs} = this;
    super.fixConfigs();
    configs['speed-over-seconds'] = configs['speed-over-seconds'] || 10;
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
    properties['disk-instances'] = 0;
    properties['disk-caches'] = []; // temporary storage until disk is ready
    properties['disk-resolves'] = []; // resolve this array when disk write is ok

    const {complete, headers} = observe;
    // only get called when there is no active disk write
    let rargs = false; // releasing arguments
    observe.complete = (...args) => {
      const success = args[0];
      if (success === false) {
        complete(...args);
      }
      else if (properties['disk-instances'] === 0 && file.opened) { // make sure file is opened
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

    const diskerror = e => {
      this.pause();
      complete(false, e);
    };
    // write to disk
    const disk = async () => {
      if (properties['disk-instances'] >= configs['max-simultaneous-writes'] || file.opened === false) {
        this.busy = true;
        return;
      }
      if (properties['disk-caches'].length === 0 && properties['disk-resolves'].length === 0) {
        if (properties['disk-instances'] === 0 && rargs) {
          // console.log('DISK COMPLETE', Date());
          file.ready = true;
          complete(...rargs);
        }
        return;
      }
      // empty resolve list
      let resolve;
      while (resolve = properties['disk-resolves'].shift()) {
        resolve();
      }
      properties['disk-instances'] += 1;
      const objs = [];
      while (properties['disk-caches'].length) {
        objs.push(properties['disk-caches'].pop());
      }
      await file.chunks(...objs).catch(diskerror);
      properties['disk-instances'] -= 1;
      disk();
    };
    observe.disk = o => {
      properties['disk-caches'].push(o);
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
      file.open().then(disk).catch(diskerror).then(() => {
        // if file is restored, there is no need to add a new meta data
        if (properties.restored !== false) {
          file.meta({
            link: properties.link,
            configs
          });
        }
      });
      // check disk space
      file.space(properties.size).catch(diskerror);
      headers(...args);
    };
  }
  fixConfigs() {
    super.fixConfigs();
    const {configs} = this;
    configs['max-simultaneous-writes'] = configs['max-simultaneous-writes'] || 1;
    // pause all network activities until this value meets
    configs['max-number-memory-chunks'] = configs['max-number-memory-chunks'] || 20;
  }
  wait() {
    const {properties, configs} = this;
    return new Promise(resolve => {
      if (properties['disk-caches'].length > configs['max-number-memory-chunks']) {
        properties['disk-resolves'].push(resolve);
      }
      else {
        resolve();
      }
    });
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
    const mime = headers.get('Content-Type').split(';')[0];
    const fse = {
      'text/html': 'html',
      'text/css': 'css',
      'text/xml': 'xml',
      'image/gif': 'gif',
      'image/jpeg': 'jpg',
      'application/x-javascript': 'js',
      'application/atom+xml': 'atom',
      'application/rss+xml': 'rss',
      'text/plain': 'txt',
      'text/javascript': 'js',
      'image/png': 'png',
      'image/tiff': 'tiff',
      'image/x-icon': 'ico',
      'image/x-ms-bmp': 'bmp',
      'image/svg+xml': 'svg',
      'image/webp': 'webp',
      'application/java-archive': 'jar',
      'application/msword': 'doc',
      'application/pdf': 'pdf',
      'application/postscript': 'ps',
      'application/rtf': 'rtf',
      'application/vnd.ms-excel': 'xls',
      'application/vnd.ms-powerpoint': 'ppt',
      'application/x-7z-compressed': '7z',
      'application/x-rar-compressed': 'rar',
      'application/x-shockwave-flash': 'swf',
      'application/x-xpinstall': 'xpi',
      'application/xhtml+xml': 'xhtml',
      'application/zip': 'zip',
      'application/octet-stream': 'bin',
      'audio/midi': 'midi',
      'audio/mpeg': 'mp3',
      'audio/ogg': 'ogg',
      'video/3gpp': '3gp',
      'video/mpeg': 'mpg',
      'video/quicktime': 'mov',
      'video/x-flv': 'flv',
      'video/x-mng': 'mng',
      'video/x-ms-asf': 'asf',
      'video/x-ms-wmv': 'wmv',
      'video/x-msvideo': 'avi',
      'video/mp4': 'mp4'
    }[mime] || '';

    let name = this.properties.filename || '';
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
    else if (fse) {
      return name + '.' + fse;
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
    this.properties.restored = false;

    for (const o of await file.properties()) {
      Object.assign(properties, o);
    }
    this.properties.link = properties.link;
    if (properties.link === undefined) {
      throw Error('Cannot find link address');
    }
    if (properties.configs) {
      Object.assign(this.configs, properties.configs);
    }
    // restore response (optional)
    try {
      const controller = this.controller = new AbortController();
      const response = await fetch(properties.link, {
        signal: controller.signal
      });
      if (response.ok) {
        controller.abort();
        const message = this.support(response);
        if (message) {
          throw Error(message);
        }
        this.observe.headers(response);
      }
    }
    catch (e) {
      console.warn('Cannot restore headers. Will try on resume');
    }
  }
  async resume() {
    const {observe, properties} = this;
    // this causes the UI to change to in_progress so that the user is not clicking on the resume button multiple times
    properties.paused = false;
    try {
      // seems like the filesize is not yet resolved, lets get head one more time
      if (!properties.size) {
        // restore response
        const controller = this.controller = new AbortController();
        const response = await fetch(properties.link, {
          signal: controller.signal
        });
        if (response.ok) {
          controller.abort();
          const message = this.support(response);
          if (message) {
            throw Error(message);
          }
          this.observe.headers(response);
        }
        else {
          throw Error('Cannot connect to the server');
        }
      }
      if (properties.restored === false) {
        // restore ranges
        const {ranges, downloaded} = await properties.file.ranges();
        this.properties.downloaded = downloaded;
        this.ranges = ranges;
        delete properties.restored;
      }
    }
    catch (e) {
      properties.paused = true;
      observe.complete(false, Error('cannot resume, ' + e.message));
    }
    super.resume();
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
