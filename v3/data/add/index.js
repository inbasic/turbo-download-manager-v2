/* global m3u8Parser */
'use strict';

const args = new URLSearchParams(location.search);

const links = new Set();

const check = () => {
  const entries = document.querySelectorAll('#list .entry');
  document.getElementById('store').disabled = entries.length === 0;
  document.getElementById('download').disabled = entries.length === 0;
  document.getElementById('merge').disabled = entries.length < 2;

  document.title = 'Number of Jobs: ' + entries.length;
  document.body.dataset.count = entries.length;
};

const one = job => {
  const clone = document.importNode(one.t.content, true);
  clone.querySelector('[name=filename]').value = job.filename || '';
  clone.querySelector('[name=link]').value = job.link || '';
  clone.querySelector('[name=threads]').value = job.threads || 3;

  links.add(job.link);

  if (job.link.indexOf('.m3u8') !== -1) {
    const span = clone.querySelector('[name=links]');
    const parse = link => fetch(link).then(r => r.text()).then(content => {
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
        const index = prompt(
          'Which HLS streams would you like to get?\n\n' +
          parser.manifest.playlists.map((o, i) => (i + 1) + '. ' + o.uri).join('\n')
        );
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
        if (links.length) {
          span.textContent = 'Segments: ' + links.length;
          span.links = links;
        }
      }
    });
    parse(job.link);
  }

  return clone;
};
one.t = document.getElementById('entry');

if (args.has('jobs')) {
  const f = document.createDocumentFragment();
  const jobs = JSON.parse(args.get('jobs'));
  for (const job of jobs) {
    f.appendChild(one(job));
  }
  document.querySelector('#list > div').appendChild(f);
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
  document.querySelector('#new [name=link]').addEventListener('input', e => {
    if (links.has(e.target.value)) {
      e.target.setCustomValidity('This URL is already in the list');
    }
    else {
      try {
        new URL(e.target.value);
        e.target.setCustomValidity('');
      }
      catch (e) {
        e.target.setCustomValidity('Invalid URL: ' + e.message);
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
      const links = e.querySelector('[name=links]').links;
      if (links) {
        job.links = links;
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
