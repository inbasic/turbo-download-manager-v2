/* globals webext */
'use strict';

var downloads = {
  template: document.getElementById('entry'),
  body: document.getElementById('list')
};

var background = {
  bg: null
};

background.search = query => new Promise(resolve => background.bg.downloads.search(query, resolve));

downloads.unit = bytes => {
  const thresh = 1024;
  if (Math.abs(bytes) < thresh) {
    return bytes + ' B';
  }
  const units = ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  let u = -1;
  do {
    bytes /= thresh;
    ++u;
  }
  while (Math.abs(bytes) >= thresh && u < units.length - 1);
  return bytes.toFixed(1) + ' ' + units[u];
};

downloads.icon = {
  cache: {},
  fetch: id => new Promise(resolve => webext.downloads.getFileIcon(id, src => {
    if (chrome.runtime.lastError === undefined) {
      resolve(src);
    }
  })),
  resolve: item => {
    const mime = downloads.icon.cache[item.mime];
    if (mime) {
      return Promise.resolve(mime);
    }
    else {
      return downloads.icon.fetch(item.id).then(src => {
        downloads.icon.cache[item.mime] = src;
        return src;
      });
    }
  }
};

downloads.add = item => {
  const {id, filename = '', url, fileSize, bytesReceived, totalBytes, sections, paused, state, exists, canResume, mime} = item;
  const clone = document.importNode(downloads.template.content, true);

  const root = clone.querySelector('.entry');
  root.dataset.wget = Boolean(sections);
  clone.querySelector('[data-id="name"]').textContent = filename.split(/[/\\]/).pop();
  clone.querySelector('[data-id="url"]').textContent = url;
  clone.querySelector('[data-id="size"]').textContent = downloads.unit(fileSize);
  clone.querySelector('[data-id="progress"]>div').style.width = bytesReceived / totalBytes * 100 + '%';
  Object.assign(root.dataset, {
    paused,
    state,
    exists,
    id,
    canResume,
    mime
  });
  downloads.body.appendChild(clone);
  downloads.update(item);
};

downloads.search = query => new Promise(resolve => webext.downloads.search(query, resolve));

downloads.status = item => {
  const {state, paused, error, exists, id} = item;
  const div = document.querySelector(`[data-id="${id}"]`);
  if (div) {
    if (state === 'in_progress') {
      div.querySelector('[data-id="status"]').textContent = paused === true ? 'Paused' : 'Downloading';
    }
    else if (state === 'interrupted') {
      div.querySelector('[data-id="status"]').textContent = error || 'Error';
    }
    else {
      div.querySelector('[data-id="status"]').textContent = exists === false ? 'Deleted' : 'Downloaded';
    }
  }
};

downloads.update = item => {
  const {id, startTime, estimatedEndTime, bytesReceived, totalBytes, sections} = item;
  const div = document.querySelector(`[data-id="${id}"]`);
  if (div) {
    const dt = new Date(estimatedEndTime).getTime() - Date.now();
    let speed = (totalBytes - bytesReceived) / (dt / 1000);
    if (isNaN(speed)) {
      const dt = Date.now() - new Date(startTime).getTime();
      speed = bytesReceived / dt;
    }

    div.querySelector('[data-id=speed]').textContent = dt ? downloads.unit(speed) + '/s' : 'NA';
    div.querySelector('[data-id=fetched]').textContent = downloads.unit(bytesReceived);
    div.querySelector('[data-id=progress]>div').style.width = bytesReceived / totalBytes * 100 + '%';

    downloads.status(item);

    if (sections) {
      sections.forEach((section, index) => {
        let e = div.querySelector(`[data-id=sections]>div:nth-child(${index + 1})`);
        if (!e) {
          e = document.createElement('div');
          div.querySelector('[data-id="sections"]').appendChild(e);
          e.style.left = (section.start / totalBytes * 100) + '%';
        }
        e.style.width = (section.fetched / totalBytes * 100) + '%';
      });
    }
  }
  else {
    console.log(id, 'not found');
  }
};
// converting multhi-thread to native
webext.downloads.on('changed', ({id, native}) => {
  const div = document.querySelector(`[data-id="${id}"]`);
  if (div) {
    div.dataset.id = native.id;
    div.dataset.wget = false;
    downloads.update(native);
    downloads.icon.resolve(native.id).then(src => div.style['background-image'] = `url(${src})`);
    webext.downloads.emit('changed', native);
  }
}).if(({native}) => native);

webext.downloads.on('changed', obj => {
  const id = obj.id;
  const div = document.querySelector(`[data-id="${id}"]`);
  if (div) {
    const item = Object.keys(obj).filter(key => key !== 'id').reduce((p, c) => {
      p[c] = obj[c].current;
      return p;
    }, {});
    Object.assign(div.dataset, item);
    item.id = id;

    if (item.filename) {
      div.querySelector('[data-id="name"]').textContent = item.filename.split(/[/\\]/).pop();
    }

    downloads.status(item);
  }
  else {
    console.log(id, 'not found');
  }
});

async function init() {
  const items = [].concat.apply([], await Promise.all([
    downloads.search({limit: 30}),
    downloads.search({state: 'in_progress'}),   // make sure to include all in progressed items,
    background.search({})
  ]));

  const cache = items.reduce((p, c) => {
    p[c.id] = c;
    return p;
  }, {});
  const entries = Object.values(cache).map(o => {
    o.sTime = new Date(o.startTime).getTime();
    return o;
  })
    .sort((a, b) => b.sTime - a.sTime);
  // fix mime types
  entries.filter(i => i.mime === '').forEach(i => {
    const re = /\.([^./\\?]*)$/.exec(i.filename);
    if (re && re.length) {
      i.mime = re[1];
    }
  });

  entries.filter(i => i.mime).forEach(downloads.add);
  // resolving icons
  const mimes = {};
  entries.filter(i => i.mime).forEach(i => {
    mimes[i.mime] = mimes[i.mime] || [];
    mimes[i.mime].push(i);
  });
  Object.values(mimes).forEach(items => {
    downloads.icon.resolve(items[0]).then(src => {
      [...document.querySelectorAll(`[data-mime="${items[0].mime}"]`)].forEach(root => {
        root.style['background-image'] = `url('${src}')`;
      });
    });
  });
}

// update
async function update() {
  // built-ins
  (await downloads.search({
    state: 'in_progress',
    paused: false
  })).forEach(downloads.update);
  // from wget
  (await background.search()).forEach(downloads.update);
}

document.addEventListener('click', ({target}) => {
  const cmd = target.dataset.cmd;
  if (cmd === 'pause' || cmd === 'resume' || cmd === 'cancel' || cmd === 'open') {
    const entry = target.closest('.entry');
    const id = Number(entry.dataset.id);
    if (entry.dataset.wget === 'true') {
      background.bg.downloads[cmd](id);
    }
    else {
      webext.downloads[cmd](id);
    }
  }
  else if (cmd === 'open-dialog') {
    webext.runtime.sendMessage({
      method: 'open-dialog'
    });
  }
  else if (cmd === 'clear-completed') {
    webext.downloads.erase({
      state: 'interrupted'
    }, () => webext.downloads.erase({
      state: 'complete'
    }, () => window.close()));
  }
});

// init

webext.runtime.getBackgroundPage(bg => {
  background.bg = bg;
  init();
  window.setInterval(update, 700);
  update();
});
webext.runtime.on('message', ({obj}) => {
  webext.downloads.emit('changed', obj);
}).if(({method}) => method === 'downloads.onChanged');
