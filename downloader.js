'use strict';
{
// get/file.js
  const File = function(name) {
    this.name = name || 'file:' + Math.random();
  };
  File.prototype.open = function({size, truncate = false}) {
    return new Promise(async(resolve, reject) => {
      const {quota, usage} = await navigator.storage.estimate();
      if (quota - usage >= size) {
        const request = indexedDB.open(this.name, 1);
        request.onupgradeneeded = () => request.result.createObjectStore('objects', {
          autoIncrement: true
        });
        request.onerror = reject;
        request.onsuccess = () => {
          this.db = request.result;
          localStorage.setItem(this.name, '');
          if (truncate) {
            const transaction = this.db.transaction('objects', 'readwrite');
            const objectStore = transaction.objectStore('objects');
            const request = objectStore.clear();
            request.onsuccess = resolve;
            request.onerror = reject;
          }
          else {
            resolve();
          }
        };
      }
      else {
        reject(new Error(`fatal: requested filesize is "${size}", but granted filesize is "${quota - usage}"`));
      }
    });
  };
  File.prototype.meta = function(obj) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('objects', 'readwrite');
      transaction.oncomplete = resolve;
      transaction.onerror = reject;
      transaction.objectStore('objects').add(obj);
    });
  };
  File.prototype.write = function({blob, offset = 0}) {
    // console.log('write', offset, offset + blob.size);
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('objects', 'readwrite');
      transaction.oncomplete = resolve;
      transaction.onerror = reject;
      transaction.objectStore('objects').add({
        offset,
        blob
      });
    });
  };
  File.prototype.chunks = function() {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('objects', 'readonly');
      const chunks = [];
      transaction.objectStore('objects').openCursor().onsuccess = e => {
        const cursor = e.target.result;
        if (cursor) {
          chunks.push(cursor.value);
          cursor.continue();
        }
      };
      transaction.onerror = reject;
      transaction.oncomplete = () => resolve(chunks);
    });
  };
  File.prototype.read = function(type) {
    return this.chunks().then(chunks => {
      chunks = chunks.filter(c => c.blob);
      chunks.sort((a, b) => a.offset - b.offset);
      return new Blob(chunks.map(c => c.blob), {
        type
       });
    });
  };
  File.prototype.download = function(filename, mime, started = () => {}) {
    // this.log('download', filename);
    return new Promise((resolve, reject) => this.read(mime).then(blob => {
      this.db.close();
      const url = URL.createObjectURL(blob);
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
                    reject(Error('fatal: I am not able to find the downloaded file!'));
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
    }));
  };
  File.prototype.remove = function() {
    if (this.db) {
      this.db.close();
    }
    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(this.name);
      request.onsuccess = () => {
        localStorage.removeItem(this.name);
        resolve();
      };
      request.onerror = reject;
    });
  };
// get/get.js
  const Get = function() {
    this.active = true;
    this.id = null;
    this.done = false;
  };
  Get.prototype.timeout = function(period, msg) {
    window.clearTimeout(this.id);
    return new Promise((resolve, reject) => {
      this.id = window.setTimeout(() => reject(msg), period);
    });
  };
  Get.prototype.abort = function() {
    window.clearTimeout(this.id);
    this.active = false;
    if (this.controller) {
      this.controller.abort();
    }
    if (this.reader) {
      this.reader.cancel().catch(() => {});
    }
  };
  Get.prototype.fetch = async function(url, props = {}, progress = () => {}) {
    props.timeout = props.timeout || 30000;
    props.credentials = 'include';
    this.controller = new AbortController();
    props.signal = this.controller.signal;
    const response = await Promise.race([
      this._fetch(url, props),
      this.timeout(props.timeout, 'noresponse timeout')
    ]);
    // console.log(response.status);
    if (response.ok === false) {
      return Promise.reject(Error('fatal: ' + response.statusText));
    }
    if (this.active === false) {
      return 'aborted';
    }
    this.reader = response.body.getReader();
    const segment = () => Promise.race([
      (async() => {
        const {done, value} = await this.reader.read();
        if (value && value.byteLength) {
          progress({
            buffer: value
          });
        }
        window.clearTimeout(this.id);
        if (done) {
          this.done = true;
          return true;
        }
        else if (this.active === false) {
          return 'aborted';
        }
        else {
          return segment();
        }
      })(),
      this.timeout(props.timeout, 'nobody timeout')
    ]);
    return segment();
  };
  Get.prototype._fetch = (url, props) => fetch(url, props);
  (isFirefox => { // Firefox polyfills
    if (isFirefox === false) {
      return;
    }
    Get.prototype._fetch = function(url, props = {}) {
      const req = new XMLHttpRequest();
      const buffers = [];
      req.open('GET', url);
      req.responseType = 'moz-chunked-arraybuffer';
      req.overrideMimeType('text/plain; charset=x-user-defined');
      Object.keys(props.headers || {}).forEach(k => req.setRequestHeader(k, props.headers[k]));
      return new Promise((resolve, reject) => {
        let postResolve = null;
        const push = obj => {
          if (postResolve) {
            postResolve(obj);
            postResolve = null;
          }
          else {
            buffers.push(obj);
          }
        };
        let once = () => {
          resolve({
            ok: req.status >= 200 && req.status < 300,
            get status() {
              return req.status;
            },
            body: {
              getReader: () => ({
                read: () => new Promise(resolve => {
                  if (buffers.length) {
                    resolve(buffers.shift());
                  }
                  else {
                    postResolve = resolve;
                  }
                }),
                cancel: () => Promise.resolve(req.abort())
              })
            }
          });
          once = () => {};
        };
        req.onprogress = () => {
          if (req.response.byteLength) {
            push({
              value: req.response,
              done: false
            });
          }
          once();
        };
        req.onload = () => {
          push({
            value: new ArrayBuffer(0),
            done: true
          });
          once();
        };
        req.ontimeout = () => reject(Error('XMLHttpRequest timeout'));
        req.onerror = () => reject(Error('XMLHttpRequest internal error'));
        req.send();
      });
    };
  })(/Firefox/.test(navigator.userAgent));
// get/wget.js
  const Wget = function({
    filename, url, timeout = 30000, chunkSize = 1 * 1024 * 1024, file, range, headers = {}
  }, observer = () => {}) {
    this.filename = filename;
    this.url = url;
    this.timeout = timeout;
    this.chunkSize = chunkSize; // chuck size to trigger a write request
    this.observer = observer;
    this.file = file;
    this.headers = headers;
    this.range = range; // this can be filled on response to observer('headers', {})
  };
  Wget.prototype.inspect = function() {
    const {url, timeout} = this;
    return new Promise((resolve, reject) => {
      const req = new XMLHttpRequest();
      req.open('HEAD', url);
      req.timeout = timeout;
      req.onload = () => resolve({
        'Content-Length': req.getResponseHeader('Content-Length'),
        'Content-Encoding': req.getResponseHeader('Content-Encoding'),
        'Length-Computable': req.getResponseHeader('Length-Computable'),
        'Content-Type': req.getResponseHeader('Content-Type'),
        'Content-Disposition': req.getResponseHeader('Content-Disposition'),
        'Accept-Ranges': req.getResponseHeader('Accept-Ranges'),
        'Response-URL': req.responseURL
      });
      req.ontimeout = () => reject(Error('fatal: XMLHttpRequest timeout'));
      req.onerror = () => reject(Error('fatal: XMLHttpRequest internal error'));
      req.send();
    });
  };
  Wget.prototype.guess = function(headers) {
    const disposition = headers['Content-Disposition'];
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
      const url = this.url.replace(/\/$/, '');
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
  };
  Wget.prototype.download = async function() {
    const {url, timeout, observer} = this;
    let {headers, range, file} = this;
    let resolve;
    const next = file => {
      this.get = new Get({file});
      let buffers = [];
      const write = async(mandatory = false) => {
        if (write.busy) {
          return;
        }
        if (buffers.length === 0) {
          if (this.get.done) {
            observer('done');
            resolve();
          }
          return;
        }
        // do not write until enough bytes are fetched
        if (
          mandatory === false && this.get.done === false &&
          buffers.reduce((p, c) => p + c.byteLength, 0) < this.chunkSize
        ) {
          return;
        }
        write.busy = true;
        const blob = new Blob(buffers, {type: 'application/octet-stream'});
        buffers = [];
        await file.write({
          blob,
          offset: write.offset
        });
        observer('disk', blob.size);
        write.offset += blob.size;
        write.busy = false;
        return write();
      };
      write.offset = range ? range.start : 0;
      // set range
      if (range) {
        const {start, end} = range;
        Object.assign(this.headers, {
          Range: `bytes=${start}-${end}`
        });
      }
      // start to download
      return new Promise((r, reject) => {
        resolve = r;
        this.get.fetch(headers['Response-UR'] || url, {
          timeout,
          headers: this.headers
        }, ({buffer}) => {
          buffers.push(buffer);
          observer('network', buffer.byteLength);
          write().catch(reject);
        }).then(() => write(true)).catch(reject);
      });
    };
    if (file) { // this is an imported download
      return next(file);
    }
    else { // this is a new download
      headers = await this.inspect();
      const size = Number(headers['Content-Length']);
      observer('filesize', size);
      if (!size) {
        return Promise.reject(Error('fatal: server does not report size'));
      }
      if (headers['Accept-Ranges'] !== 'bytes') {
        return Promise.reject(Error('fatal: "Accept-Ranges" header is ' + headers['Accept-Ranges']));
      }
      if (headers['Length-Computable'] === 'false') {
        return Promise.reject(Error('fatal: "Length-Computable" header is ' + headers['Length-Computable']));
      }
      // allow to modify headers like "Range" before actually starting to download
      range = range || observer('headers', headers);
      // should I create the file
      file = file || new File();
      this.observer('filename', this.filename || this.guess(headers));
      // open the file and truncate it
      await file.open({
        size,
        truncate: true
      });
      this.observer('file', file);
      return next(file);
    }
  };
  Wget.prototype.abort = function() {
    if (this.get) {
      this.get.abort();
    }
  };
// get/mwget.js
  const mwget = ({
    threads = 2, filename, url, timeout = 30000, headers = {}, id = 0,
    sections = [], fileSize = 0, file, paused = false, // to resume
    debug = false
  }, props = {
    'segment-min': 50 * 1024,
    'segment-max': 1024 * 1024 * 1024,
    'retry-max': 30,
    'speed-cache': 10
  }) => {
    let stats = [];
    const info = { // Chrome like download object
      id,
      startTime: (new Date()).toISOString(),
      url,
      finalUrl: url, // will be replaced when resolved
      get filename() {
        return filename || 'unknown';
      },
      mime: 'NA',
      endTime: '',
      get estimatedEndTime() {
        if (info.endTime) {
          return info.endTime;
        }
        const len = stats.length;
        if (len < 2 || fileSize === 0) {
          return 'NA';
        }
        else {
          const dt = stats[len - 1].time - stats[0].time;
          const fetched = stats.map(o => o.value).reduce((p, c) => p += c, 0);
          const rm = (fileSize - info.bytesReceived) / fetched * dt;
          return (new Date(Date.now() + rm)).toISOString();
        }
      },
      state: 'in_progress', // "in_progress", "interrupted", or "complete"
      paused,
      get canResume() {
        return info.state === 'in_progress' && info.paused === true;
      },
      get bytesReceived() {
        return sections.map(s => s.fetched).reduce((p, c) => p + c, 0);
      },
      get totalBytes() {
        return fileSize;
      },
      get fileSize() {
        return fileSize;
      },
      exists: true,
      sections,
      props
    };
    let report = () => {};
    const map = new WeakMap();
    const split = () => {
      let len = Math.floor(fileSize / threads);
      len = Math.max(len, props['segment-min']);
      len = Math.min(len, props['segment-max']);
      len = Math.min(fileSize, len);
      threads = Math.floor(fileSize / len);
      const arr = Array.from(new Array(threads), (x, i) => i);
      arr.map((a, i, l) => sections.push({
        start: a * len,
        end: l.length === i + 1 ? fileSize - 1 : (a + 1) * len - 1,
        wrote: 0,
        fetched: 0
      }));
      sections.forEach(s => s.size = s.end - s.start + 1);
    };
    let first;
    let setup = Boolean(fileSize && sections.length); // do not setup if it is a resume
    let count = 0; // number of retries
    let policy;
    const finalize = (state, error) => {
      try {
        file.remove();
      }
      catch (e) {
        error = error || e;
      }
      if (error) {
        info.error = error;
      }
      info.state = state;
      info.endTime = (new Date()).toISOString();
      report('state', info.state);
    };
    const hold = () => {
      info.paused = true;
      sections.filter(s => s.wrote !== s.size).forEach(s => {
        const wget = map.get(s);
        if (wget) {
          wget.abort();
          map.delete(s);
        }
      });
    };
    const pause = () => {
      hold();
      report('paused');
    };
    const cancel = () => {
      hold();
      finalize('interrupted', 'download is canceled by user');
    };
    const resume = () => {
      info.paused = false;
      count = 0;
      // if a download is restored, it might be already finished
      if (info.bytesReceived === info.totalBytes) {
        observer(0, 'disk', 0); // sending a fake disk request
      }
      else {
        // ignore fetched but not wrote
        sections.forEach(s => s.fetched = s.wrote);
        sections.forEach((s, i) => {
          if (s.size !== s.wrote) {
            policy('resume', i, true);
          }
        });
        info.error = '';
        report('resumed');
      }
    };
    const validate = i => {
      const {fetched, size} = sections[i];
      if (fetched !== size) {
        throw Error('fatal: segment size mismatched');
      }
    };
    const observer = (index, key, value) => {
      // console.log(index, key, value);
      if (setup === false && index === 0) {
        if (key === 'headers') {
          info.finalUrl = value['Response-URL'];
          info.mime = value['Content-Type'];
          split();
          map.set(sections[0], first);
          return sections[0]; // set the new range to wget.js
        }
        else if (key === 'filename') {
          filename = value;
          report('filename', value);
        }
        else if (key === 'filesize') {
          fileSize = value;
          report('filesize', value);
        }
        // when file is created, we can start all threads
        else if (key === 'file') {
          file = value;
          file.meta({
            options: {
              threads: sections.length,
              filename: info.filename,
              fileSize,
              url: info.url,
              timeout,
              headers
            },
            props,
            extra: {
              startTime: info.startTime,
              mime: info.mime
            }
          });
          report('file', value);
          sections.slice(1).forEach((range, i) => {
            const wget = new Wget(
              {filename, url, timeout, headers, range, file},
              (key, value) => observer(i + 1, key, value)
            );
            map.set(sections[i + 1], wget);
            if (info.paused === false) {
              wget.download().then(() => validate(i + 1)).catch(e => policy(e, i + 1));
            }
          });
          setup = true;
        }
      }
      else if (key === 'disk') {
        sections[index].wrote += value;
        const {wrote, size} = sections[index];
        if (wrote === size) {
          if (info.paused === false && sections.filter(s => s.wrote === s.size).length === sections.length) {
            file.download(filename, info.mime, d => {
              info.id = d.id;
              filename = d.filename;
              Object.defineProperty(info, 'exists', {
                get() {
                  return d.exists;
                }
              });
              report('native', info);
            }).then(() => finalize('complete'));
          }
        }
      }
      else if (key === 'network') {
        sections[index].fetched += value;
        stats.push({
          value: value,
          time: Date.now()
        });
        stats = stats.slice(-1 * props['speed-cache']);
      }
    };
    policy = (e, index, silent = false) => {
      if (info.paused) {
        return;
      }
      if (debug) {
        console.log(e, index, count);
      }
      if (silent !== true) {
        count += 1;
      }
      if (count > props['retry-max']) {
        pause();
      }
      else if (e.message && (e.message.startsWith('fatal:') || e instanceof DOMException)) {
        pause();
        finalize('interrupted', e.message);
      }
      else {
        const wget = new Wget({filename, url, timeout, headers, range: {
          start: sections[index].start + sections[index].wrote,
          end: sections[index].end
        }, file}, (key, value) => observer(index, key, value));
        map.set(sections[index], wget);
        if (info.paused === false) {
          wget.download().catch(e => policy(e, index, wget));
        }
        report('retrying', index);
      }
    };
    // this is a new download
    if (sections.length === 0) {
      first = new Wget({filename, url, timeout, headers, file}, (key, value) => observer(0, key, value));
      first.download().then(() => validate(0)).catch(e => policy(e, 0));
    }
    // this is a resumed download
    else if (paused === false) {
      resume();
    }
    return {
      cancel,
      resume,
      pause,
      object: () => ({ // useful to store for resume
        sections,
        file,
        fileSize,
        filename,
        map
      }),
      info,
      report: c => report = c
    };
  };
// get/restore.js
  const restore = {};
  restore.list = function() {
    return Object.keys(localStorage).filter(k => k.startsWith('file:'));
  };
  restore.file = name => {
    const file = new File(name);
    return file.open({size: 0}).then(() => file.chunks().then(chunks => {
      const meta = chunks.filter(o => o.options).shift();
      let sections = [{
        start: 0,
        end: meta.options.fileSize - 1,
        wrote: 0,
        original: true
      }];
      chunks.filter(o => o.blob).forEach(o => {
        const section = sections.filter(r => r.start <= o.offset && r.end >= o.offset + o.blob.size - 1).shift();
        if (section) {
          const index = sections.indexOf(section);
          sections.splice(index, 1);
          sections.push({
            start: section.start,
            end: o.offset - 1,
            wrote: 0
          }, {
            start: o.offset,
            end: o.offset + o.blob.size - 1,
            wrote: o.blob.size
          }, {
            start: o.offset + o.blob.size,
            end: section.end,
            wrote: 0
          });
        }
        else {
          throw new Error('out of range chunk');
        }
      });
      sections = sections.filter(s => s.end - s.start > 0).map(s => Object.assign(s, {
        size: s.end - s.start + 1,
        fetched: s.wrote
      }));
      // sorting
      sections.sort((a, b) => a.start - b.start);
      // can we merge sections
      sections.forEach((section, index) => {
        if (index) {
          const p = sections[index - 1];
          if (p.wrote === p.size) {
            section.merge = p.end + 1 === section.start;
          }
        }
      });
      for (let i = sections.length - 1; i >= 0; i -= 1) {
        const section = sections[i];
        if (section.merge) {
          sections[i - 1].end = section.end;
          sections[i - 1].fetched += section.fetched;
          sections[i - 1].wrote += section.wrote;
          sections[i - 1].size += section.size;
        }
      }
      sections = sections.filter(s => s.merge !== true);
      sections = sections.map(section => {
        delete section.merge;
        return section;
      });
      return {
        options: Object.assign({
          sections: sections.length === 1 && sections[0].start === 0 && sections[0].wrote === 0 ? [] : sections,
          file,
          paused: true
        }, meta.options),
        props: meta.props,
        extra: meta.extra,
      };
    }));
  };
// get/downloads.js
  var downloads = {
    cache: {},
    index: 10000,
    listeners: {
      onCreated: [],
      onChanged: []
    }
  };
  downloads.native = options => {
    // console.log('using native method', options);
    const opts = {
      url: options.url
    };
    if (options.filename) {
      opts.filename = options.filename;
    }
    chrome.downloads.download(opts);
  };
  downloads.download = (options, callback = () => {}, props) => {
    if (options.threads === 1 && options.allowSingleThread !== true) {
      return downloads.native(options);
    }
    options.id = downloads.index;
    const d = downloads.cache[downloads.index] = mwget(options, props);
    d.useNative = 'useNative' in options ? options.useNative : true; // user native method when there is a fatal error
    const post = obj => {
      Object.assign(obj, {
        id: options.id
      });
      downloads.listeners.onChanged.forEach(c => c(obj));
    };
    d.report((key, value) => {
      // console.log(key, value);
      if (key === 'paused' || key === 'resumed') {
        post({
          paused: {
            current: key === 'paused'
          },
          canResume: {
            current: key === 'paused'
          }
        });
      }
      else if (key === 'filename') {
        post({
          filename: {
            current: value
          }
        });
      }
      else if (key === 'filesize') {
        post({
          fileSize: {
            current: value
          },
          totalBytes: {
            current: value
          }
        });
      }
      else if (key === 'state') {
        post({
          state: {
            current: value
          }
        });
        if (value === 'interrupted' && d.useNative) { // ask Chrome to download when there is an error
          if (options.debug) {
            console.log('Download failed', 'Using the native download manager');
          }
          downloads.native(options);
        }
        if (value === 'interrupted') {
          delete downloads.cache[options.id];
        }
      }
      else if (key === 'native') {
        delete downloads.cache[options.id];
        post({
          native: value
        });
      }
    });
    callback(downloads.index);
    downloads.listeners.onCreated.forEach(c => c(d.info));
    downloads.index += 1;
  };
  downloads.search = (query = {}, callback = () => {}) => {
    let items = Object.values(downloads.cache).map(m => m.info);
    if (query.query) {
      items = items.filter(({filename, url, finalUrl}) => {
        return query.query.some(s => url.indexOf(s) !== -1 || finalUrl.indexOf(s) !== -1 || filename.indexOf(s) !== -1);
      });
    }
    if ('paused' in query) {
      items = items.filter(({paused}) => query.paused === paused);
    }
    callback(items);
  };
  downloads.pause = (id, callback = () => {}) => {
    downloads.cache[id].pause();
    callback();
  };
  downloads.resume = (id, callback = () => {}) => {
    downloads.cache[id].resume();
    callback();
  };
  downloads.cancel = (id, callback = () => {}) => {
    downloads.cache[id].useNative = false;
    downloads.cache[id].cancel();
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
  {
    const callback = async() => {
      const used = Object.values(downloads.cache)
        .filter(({info}) => info.file) // file might not yet be created
        .map(({info}) => info.file.name);
      const unused = restore.list().filter(name => used.indexOf(name) === -1);
      for (const name of unused) {
        try {
          const {options, props, extra} = await restore.file(name);
          downloads.download(options, id => {
            downloads.cache[id].info.mime = extra.mime;
          }, props);
        }
        catch (e) {
          console.log(e);
          const file = new File(name);
          file.remove();
        }
      }
    };
    chrome.runtime.onStartup.addListener(callback);
    chrome.runtime.onInstalled.addListener(callback);
  }
  window.downloads = downloads;
}
