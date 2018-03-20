/* globals downloads, icon */
'use strict';

{
  const observe = {
    id: null
  };
  const count = async() => {
    const query = {
      paused: false,
      state: 'in_progress'
    };
    const [i1, i2] = await Promise.all([
      new Promise(resolve => chrome.downloads.search(query, resolve)),
      new Promise(resolve => downloads.search(query, resolve))
    ]);
    const i = [...i1, ...i2];
    const count = i.length;
    if (count === 0) {
      window.clearTimeout(observe.id);
      icon.build('normal', 0);
    }
    else {
      const bytesReceived = i.map(i => i.bytesReceived).reduce((p, c) => p += c, 0);
      const totalBytes = i.map(i => i.totalBytes).reduce((p, c) => p += c, 0);
      if (totalBytes) {
        const progress = bytesReceived / totalBytes * 100;
        icon.build('normal', progress);
      }
      else {
        // download size is not yet cleared
      }
    }
  };

  observe.start = () => {
    count();
    window.clearTimeout(observe.id);
    observe.id = window.setTimeout(observe.start, 1000);
  };
  observe.end = ({state}) => {
    if (state) {
      count();
    }
  };

  chrome.downloads.onCreated.addListener(observe.start);
  downloads.onCreated.addListener(observe.start);
  chrome.downloads.onChanged.addListener(observe.end);
  downloads.onChanged.addListener(observe.end);
}
