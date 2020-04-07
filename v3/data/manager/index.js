'use strict';

const size = bytes => {
  const thresh = 1024;
  if (Math.abs(bytes) < thresh) {
    return bytes + ' B';
  }
  const units = ['KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  let u = -1;
  do {
    bytes /= thresh;
    ++u;
  }
  while (Math.abs(bytes) >= thresh && u < units.length - 1);
  return bytes.toFixed(1) + ' ' + units[u];
};

const gradient = (ranges, max) => {
  let index = 0;
  const colors = ['#cd51d8', '#504350', '#b6a7b6', '#df5f00', '#a02900'];
  let offset = 0;
  const images = [];
  const sizes = [];
  while (offset < max) {
    const range = ranges[index];
    if (range && offset === range[0]) {
      const color = colors[index % colors.length];
      images.push(`linear-gradient(${color},${color})`);
      sizes.push(`${(range[1] / max * 100).toFixed(0)}% 100%`);
      offset = range[1];
      index += 1;
    }
    else {
      const next = range ? range[0] : max;
      images.push(`linear-gradient(#efefef,#efefef)`);
      sizes.push(`${(next / max * 100).toFixed(0)}% 100%`);
      offset = next;
    }
  }
  return {
    'background-image': images.join(','),
    'background-size': sizes.join(',')
  };
};

const update = (e, d) => {
  // speed
  if ('speed' in d) {
    e.querySelector('[data-id=speed]').textContent = 'Speed: ' + size(d.speed) + '/s, Threads: ' + d.threads + ',';
  }
  else {
    e.querySelector('[data-id=speed]').textContent = 'Speed: ' + d.bytesReceived && d.estimatedEndTime ?
      size((d.totalBytes - d.bytesReceived) / (new Date(d.estimatedEndTime) - Date.now()) * 1000) + '/s,' :
      '0 B/s';
  }
  if (d.state === 'in_progress') {
    e.querySelector('[data-id=size]').textContent = size(d.bytesReceived) + ' of ' + size(d.totalBytes);
  }
  else {
    e.querySelector('[data-id=size]').textContent = 'Size: ' + size(d.totalBytes);
  }
  if (d.sections) {
    Object.assign(e.querySelector('[data-id=partial]').style, gradient(d.sections, d.totalBytes));
  }

  e.querySelector('[data-id=total] span').style.width = d.bytesReceived / d.totalBytes * 100 + '%';
  if (d.error) {
    e.querySelector('[data-id=link]').textContent = d.error;
  }
  else if (d.state === 'transfer') {
    e.querySelector('[data-id=link]').textContent = 'Merging Segments. Please wait...';
  }
  Object.assign((e.querySelector('.entry') || e).dataset, {
    paused: d.paused,
    state: d.state,
    canResume: d.canResume,
    threads: d.sections ? true : false
  });
};

const prepare = (e, d) => {
  e.querySelector('[data-id=link]').textContent = d.error || d.finalUrl;
  e.querySelector('[data-id=link]').href = d.finalUrl;
  const name = e.querySelector('[data-id=name]');
  name.title = name.textContent = d.filename.split('/').pop();
};

const icon = d => {
  const i = icon.cache[d.mime];
  if (i) {
    return Promise.resolve(i);
  }
  return new Promise(resolve => chrome.runtime.sendMessage({
    method: 'get-icon',
    id: d.id
  }, iconURL => {
    icon.cache[d.mime] = iconURL;
    resolve(iconURL || 'download.png');
  }));
};
icon.cache = {};

const entry = d => {
  const t = document.getElementById('entry');
  const clone = document.importNode(t.content, true);
  clone.querySelector('.entry').id = d.id;
  prepare(clone, d);
  const img = clone.querySelector('img');
  icon(d).then(iconURL => img.src = iconURL);
  update(clone, d);

  return clone;
};

const entries = ds => {
  const f = document.createDocumentFragment();
  for (const d of ds) {
    f.appendChild(entry(d));
  }
  const parent = document.getElementById('entries');
  parent.insertBefore(f, parent.firstChild);
};

chrome.runtime.sendMessage({
  method: 'popup_ready'
}, entries);

chrome.runtime.onMessage.addListener(request => {
  console.log(request);
  if (request.method === 'batch-update') {
    const ds = [];
    for (const d of request.ds) {
      const e = document.getElementById(d.id);
      if (e) {
        update(e, d);
      }
      else {
        ds.push(d);
      }
    }
    entries(ds);
  }
  else if (request.method === 'convert-to-native') {
    const e = document.getElementById(request.id);
    e.id = request.native.id;
    update(e, request.native);
    icon(request.native).then(iconURL => e.querySelector('img').src = iconURL);
  }
  // calls after filename is resolved
  else if (request.method === 'prepare-one') {
    const e = document.getElementById(request.d.id);
    prepare(e, request.d);
  }
});

// commands
const id = e => Number(e.closest('.entry').id);
document.addEventListener('click', e => {
  const command = e.target.dataset.command;
  if (command === 'add-new') {
    const next = (msg = '') => {
      const value = window.prompt(`Enter Downloadable Link(s):

 -> For multiple jobs, insert the comma-separated list of links.
 -> For threading, prepend with the number

Example:
3|http://www.google.com, 2|http://www.yahoo.com`, msg);
      if (value) {
        chrome.runtime.sendMessage({
          method: 'add-new',
          value
        });
      }
    };
    const input = document.getElementById('clipboard');
    input.classList.remove('hidden');
    input.focus();
    document.execCommand('paste');
    input.classList.add('hidden');
    // extract links
    chrome.runtime.sendMessage({
      method: 'extract-links',
      content: input.value
    }, links => next(links.map(s => '3|' + s).join(', ')));
  }
  else if (command === 'detach') {
    chrome.tabs.create({
      url: '/data/manager/index.html'
    }, () => window.close());
  }
  if (command === 'clear-complete' || command === 'clear-interrupted') {
    chrome.runtime.sendMessage({
      method: 'erase',
      query: {
        state: command.replace('clear-', '')
      }
    }, ids => {
      for (const id of ids) {
        const e = document.getElementById(id);
        if (e) {
          e.remove();
        }
      }
    });
  }
  else if (command === 'erase') {
    chrome.runtime.sendMessage({
      method: command,
      query: {
        id: id(e.target)
      }
    });
    e.target.closest('.entry').remove();
  }
  else if (['resume', 'pause', 'cancel'].some(a => a === command)) {
    chrome.runtime.sendMessage({
      method: command,
      id: id(e.target)
    }, d => update(e.target.closest('.entry'), d));
  }
  else if (['open', 'show', 'retry'].some(a => a === command)) {
    chrome.runtime.sendMessage({
      method: command,
      id: id(e.target)
    });
  }
});
