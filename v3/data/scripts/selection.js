{
  const div = document.createElement('div');
  const selection = window.getSelection();
  for (let i = 0; i < selection.rangeCount; i++) {
    const range = selection.getRangeAt(i);
    const f = range.cloneContents();
    div.appendChild(f);
  }
  let links = [...div.querySelectorAll('a')].map(a => a.href);

  chrome.runtime.sendMessage({
    method: 'extract-links',
    content: div.innerHTML
  }, ls => {
    links.push(...ls);
    links = links.filter((s, i, l) => s && l.indexOf(s) === i);
    if (links.length) {
      if (window.confirm(
        `Confirm Downloading ${links.length} links:\n\n` + links.map((s, i) => `${('00' + (i + 1)).substr(-2)}. ${s}`).join('\n')
      )) {
        chrome.runtime.sendMessage({
          method: 'add-jobs',
          jobs: links.map(link => ({
            link,
            threads: 3
          }))
        });
      }
    }
    else {
      alert('There is no link in the active selection');
    }
  });
}
