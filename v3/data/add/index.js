/* global m3u8Parser */
'use strict';

const args = new URLSearchParams(location.search);
const tabId = Number(args.get('tabId'));
const links = new Set();

const check = () => {
  const entries = [...document.querySelectorAll('#list .entry')];
  document.getElementById('store').disabled = entries.length === 0;
  document.getElementById('download').disabled = entries.length === 0;
  document.getElementById('merge').disabled = entries.length < 2;

  document.getElementById('rm-hls').disabled = entries.some(e => {
    const {links} = e.querySelector('[name=links]');
    if (!links) {
      return true;
    }
  }) === false || entries.length === 0;

  document.title = 'Number of Jobs: ' + entries.length;
  document.body.dataset.count = entries.length;
};

const get = async (link, type = 'text') => {
  const r = await fetch(link, {
    credentials: 'include'
  });

  if (r.ok) {
    if (type === 'text') {
      return await r.text();
    }
    else {
      return await r.arrayBuffer().then(ab => [...new Uint8Array(ab)]);
    }
  }
  else {
    throw Error('Failed to fetch');
  }
};
// const get = (link, type = 'text') => new Promise((resolve, reject) => chrome.tabs.sendMessage(tabId, {
//   method: 'fetch',
//   link,
//   type
// }, {
//   frameId: 0
// }, r => {
//   const lastError = chrome.runtime.lastError;
//   if (lastError || !r) {
//     nget(resolve, reject);
//   }
//   else {
//     resolve(r);
//   }
// }));

const one = job => {
  const clone = document.importNode(one.t.content, true);
  clone.querySelector('[name=filename]').value = job.filename || '';
  clone.querySelector('[name=link]').value = job.link || '';
  clone.querySelector('[name=threads]').value = job.threads || 3;

  links.add(job.link);

  if (job.link.indexOf('.m3u8') !== -1) {
    const span = clone.querySelector('[name=links]');
    const parse = link => get(link).then(async content => {
      const path = (root, rel) => {
        let a = root.split('/');
        const b = rel.split('/').filter(a => a);
        const index = a.indexOf(b[0]);
        if (index === -1) {
          a.pop();
        }
        else {
          a = a.slice(0, index);
        }
        a.push(rel);
        return a.join('/');
      };
      const parser = new m3u8Parser.Parser();
      parser.push(content);
      parser.end();
      if (parser.manifest && parser.manifest.playlists && parser.manifest.playlists.length) {
        const msgs = [];
        for (const playlist of parser.manifest.playlists) {
          let hostname;
          let pathname;
          try {
            const o = new URL(playlist.uri);
            hostname = o.hostname;
            pathname = o.pathname;
          }
          catch (e) {
            hostname = pathname = playlist.uri;
          }

          if (playlist.attributes && playlist.attributes.RESOLUTION) {
            msgs.push(playlist.attributes.RESOLUTION.width + ' × ' + playlist.attributes.RESOLUTION.height + ' -> ' + hostname);
          }
          else {
            msgs.push(pathname);
          }
        }
        const index = prompt(`Which HLS stream would you like to get for:\n` +
          job.link + `\n\n` +
          msgs.map((s, i) => (i + 1) + '. ' + s).join('\n'), 1);
        if (index) {
          const uri = parser.manifest.playlists[Number(index) - 1].uri;
          if (uri) {
            if (uri.startsWith('http') === false) {
              return parse(path(link, uri));
            }
            parse(uri);
          }
        }
      }
      else if (parser.manifest && parser.manifest.segments) {
        const links = parser.manifest.segments.map(o => {
          if (o.uri.startsWith('http') === false) {
            return path(link, o.uri);
          }
          return o.uri;
        }).filter((s, i, l) => l.indexOf(s) === i);
        // example:
        //   https://videojs.com/
        //   http://demo.theoplayer.com/drm-aes-protection-128-encryption?hsCtaTracking=cc0cef76-cc09-40b0-8e84-c1c278ec8764%7C6c30cfd0-2817-49e5-addc-b1a5afc68170
        //   https://www.radiantmediaplayer.com/media/rmp-segment/bbb-abr-aes/playlist.m3u8
        //   https://anime.anidub.life/anime/anime_ongoing/11235-velikij-pritvorschik-greatpretender-01-iz-23.html
        //   m3u8 with native fetch:
        //   https://kinja-vh.akamaihd.net/i/prod/186898/186898_,240p,480p,720p,1080p,.mp4.csmil/master.m3u8
        const keys = [];
        if (links.length) {
          const parse = segment => {
            const key = segment.key;
            if (key && key.uri) {
              if (key.iv) {
                key.iv = [...new Uint8Array(key.iv.buffer)];
              }
              if (parser.cache[key.uri]) {
                return Promise.resolve(parser.cache[key.uri]);
              }
              return get(path(link, key.uri), 'arrayBuffer').then(buffer => {
                key.value = buffer;

                if (key.value.length !== 16) {
                  throw Error('key.value length is not 128 bytes');
                }
                else if (key.method !== 'AES-128') {
                  throw Error(`"${key.method}" encryption is not supported`);
                }
                else if (key.iv && key.iv.length !== 16) {
                  throw Error('key.iv length is not 128 bytes');
                }
                else {
                  parser.cache[key.uri] = key;
                  return key;
                }
              });
            }
            else {
              return Promise.resolve(false);
            }
          };
          parser.cache = {};

          span.textContent = 'Parsing M3U8. Please wait...';
          try {
            for (const segment of parser.manifest.segments) {
              const key = await parse(segment);
              if (key) {
                keys.push(key);
              }
            }
            if (keys.length) {
              span.textContent = 'Segments (AES-128): ' + links.length;
            }
            else {
              span.textContent = 'Segments: ' + links.length;
            }
            span.links = links;
            span.keys = keys;
            check();
          }
          catch (e) {
            span.textContent = 'M3U8 Parse Failed: ' + e.message;
          }
        }
      }
    });
    parse(job.link);
  }

  return clone;
};
one.t = document.getElementById('entry');

if (args.has('jobs')) {
  const jobs = JSON.parse(args.get('jobs'));
  if (jobs.length) {
    const f = document.createDocumentFragment();
    for (const job of jobs) {
      f.appendChild(one(job));
    }
    document.querySelector('#list > div').appendChild(f);
  }

  check();
}

document.getElementById('new').addEventListener('submit', e => {
  document.querySelector('#list > div').appendChild(one({
    filename: e.target.querySelector('[name=filename]').value,
    link: e.target.querySelector('[name=link]').value,
    threads: e.target.querySelector('[name=threads]').value || 3
  }));
  e.preventDefault();
  document.querySelector('#new [name=link]').value = '';
  document.querySelector('#new [name=link]').dispatchEvent(new Event('input'));
  check();
});

// valid URL
{
  document.querySelector('#new [name=link]').addEventListener('input', ({target}) => {
    if (links.has(target.value)) {
      target.setCustomValidity('This URL is already in the list');
    }
    else {
      try {
        new URL(target.value);
        target.setCustomValidity('');
      }
      catch (err) {
        target.setCustomValidity('Invalid URL: ' + err.message);
      }
    }
  });
}

// remove
document.getElementById('list').addEventListener('click', e => {
  const command = e.target.dataset.command;
  if (command === 'remove') {
    const parent = e.target.closest('.entry');
    links.delete(parent.querySelector('[name=link]').value);
    parent.remove();
    document.querySelector('#new [name=link]').dispatchEvent(new Event('input'));
    check();
  }
});
// download
{
  const send = method => {
    const jobs = [...document.querySelectorAll('#list .entry')].map(e => {
      const job = {
        filename: e.querySelector('[name=filename]').value,
        link: e.querySelector('[name=link]').value,
        threads: e.querySelector('[name=threads]').value
      };
      const {links, keys} = e.querySelector('[name=links]');
      if (links) {
        job.links = links;
        job.keys = keys;
        delete job.link;
      }
      return job;
    });
    if (method === 'download') {
      chrome.runtime.sendMessage({
        method: 'add-jobs',
        jobs
      }, () => window.close());
    }
    else if (method === 'merge') {
      if (jobs.some(j => j.links)) {
        return alert('There is at least one job which is segmented! Cannot merge jobs');
      }
      const job = {
        ...jobs[0],
        links: jobs.map(j => j.link)
      };
      delete job.url;
      chrome.runtime.sendMessage({
        method: 'add-jobs',
        jobs: [job]
      }, () => window.close());
    }
    else {
      chrome.runtime.sendMessage({
        method: 'store-links',
        links: jobs.map(o => o.link)
      }, () => window.close());
    }
  };
  document.getElementById('list').addEventListener('submit', e => {
    e.preventDefault();
    send('download');
  });
  document.getElementById('download').addEventListener('click', () => {
    document.getElementById('list').dispatchEvent(new Event('submit'));
  });
  document.getElementById('merge').addEventListener('click', () => {
    send('merge');
  });
  document.getElementById('store').addEventListener('click', () => {
    send('store');
  });
}
// no HLS
document.getElementById('rm-hls').addEventListener('click', () => {
  [...document.querySelectorAll('#list .entry')].forEach(e => {
    const n = e.querySelector('[name=links]');
    if (!n.links) {
      e.remove();
      links.delete(n.value);
    }
  });
  check();
});
