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
      chrome.runtime.sendMessage({
        method: 'open-jobs',
        jobs: links.map(link => ({link}))
      });
    }
    else {
      alert('There is no link in the active selection');
    }
  });
}
