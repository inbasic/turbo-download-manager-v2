'use strict';

const args = new URLSearchParams(location.search);

const links = new Set();

const check = () => {
  const entries = document.querySelectorAll('#list .entry');
  document.getElementById('store').disabled = entries.length === 0;
  document.getElementById('download').disabled = entries.length === 0;

  document.title = 'Number of Jobs: ' + entries.length;
  document.body.dataset.count = entries.length;
};

const one = job => {
  const clone = document.importNode(one.t.content, true);
  clone.querySelector('[name=filename]').value = job.filename || '';
  clone.querySelector('[name=link]').value = job.link || '';
  clone.querySelector('[name=threads]').value = job.threads || 3;

  links.add(job.link);

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
  document.querySelector('#new [name=link]').dispatchEvent(new Event('input'));
  check();
});

// valid URL
{
  const pattern = new RegExp('^(https?:\\/\\/)?' + // protocol
    '((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|' + // domain name
    '((\\d{1,3}\\.){3}\\d{1,3}))' + // OR ip (v4) address
    '(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*' + // port and path
    '(\\?[;&a-z\\d%_.~+=-]*)?' + // query string
    '(\\#[-a-z\\d_]*)?$', 'i'); // fragment locator
  document.querySelector('#new [name=link]').addEventListener('input', e => {
    if (links.has(e.target.value)) {
      e.target.setCustomValidity('This URL is already in the list');
    }
    else {
      e.target.setCustomValidity(pattern.test(e.target.value) ? '' : 'Invalid URL');
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
    const jobs = [...document.querySelectorAll('#list .entry')].map(e => ({
      filename: e.querySelector('[name=filename]').value,
      link: e.querySelector('[name=link]').value,
      threads: e.querySelector('[name=threads]').value
    }));
    if (method === 'download') {
      chrome.runtime.sendMessage({
        method: 'add-jobs',
        jobs
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
  document.getElementById('store').addEventListener('click', () => {
    send('store');
  });
}
