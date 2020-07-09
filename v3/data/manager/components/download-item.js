const isFirefox = /Firefox/.test(navigator.userAgent);

class DownloadItem extends HTMLElement {
  constructor() {
    super();
    const shadowRoot = this.attachShadow({
      mode: 'open'
    });
    shadowRoot.innerHTML = `
      <style>
        .entry {
          display: grid;
          grid-template-columns: 48px 1fr;
          grid-row-gap: 10px;
          background-color: var(--white);
          margin: 10px;
          padding: 10px;
          position: relative;
        }
        .entry[data-state=complete] {
          background-color: var(--state-complete);
        }
        .entry[data-state=interrupted] {
          background-color: var(--state-interrupted);
        }
        .entry[data-paused=true][data-state="in_progress"] {
          background-color: var(--state-paused);
        }
        .entry[data-paused=true][data-state="in_progress"][data-queue=true] {
          background-color: var(--state-queue);
        }
        .entry[data-paused=true][data-state="in_progress"][data-queue=true]::after {
          content: 'In Queue';
          position: absolute;
          top: 0;
          right: 0;
          background-color: #cee8db;
          padding: 1px 10px;
        }
        .entry[data-state="transfer"] {
          background-color: var(--state-transfer);
        }
        .entry[data-state="not_started"] {
          background-color: var(--state-not_started);
        }
        .entry > img {
          grid-row-start: 1;
          grid-row-end: 3;
        }
        .entry div[data-id=tools] {
          display: grid;
          grid-template-columns: min-content 1fr;
          grid-column-gap: 10px;
          white-space: nowrap;
        }
        .entry div[data-id="actions"] {
          justify-self: end;
          color: var(--blue);
          user-select: none;
        }
        .entry div[data-id="actions"] [data-command] {
          margin-left: 5px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .entry div[data-id="actions"] [data-command]:active {
          opacity: 0.6;
          transition: all 0;
        }
        .entry div[data-id="actions"] [data-command][data-remote] {
          color: var(--green);
        }
        @media screen and (max-width: 600px)  {
          .entry div[data-id="actions"] [data-command][data-remote]:nth-of-type(2) {
            display: none;
          }
        }
        @media screen and (max-width: 500px)  {
          .entry div[data-id="actions"] [data-command][data-remote]:nth-of-type(3) {
            display: none;
          }
        }
        .entry:not([data-state="in_progress"]) [data-id="speed"],
        .entry[data-state="in_progress"]:not([data-paused="false"]) [data-id="speed"] {
          display: none;
        }
        .entry:not([data-state="in_progress"]) div[data-id="actions"] [data-command="pause"],
        .entry[data-state="in_progress"]:not([data-paused="false"]) div[data-id="actions"] [data-command="pause"] {
          display: none;
        }
        .entry:not([data-state="in_progress"]):not([data-state="interrupted"]) div[data-id="actions"] [data-command="resume"],
        .entry[data-state="in_progress"]:not([data-paused="true"]) div[data-id="actions"] [data-command="resume"] {
          display: none;
        }
        .entry[data-state="in_progress"][data-paused=false] [data-command="cancel"],
        .entry:not([data-state="in_progress"]) div[data-id="actions"] [data-command="cancel"] {
          display: none;
        }
        .entry:not([data-state="complete"]) div[data-id="actions"] [data-command="show"] {
          display: none;
        }
        .entry[data-state="in_progress"] [data-command="erase"] {
          display: none;
        }
        .entry:not([data-state="not_started"]) [data-command="start"] {
          display: none;
        }
        .entry:not([data-state="complete"]) [data-remote] {
          display: none;
        }
        .entry:not([data-extension="ZIP"]) [data-command="zip-manager"] {
          display: none;
        }
        .entry:not([data-extension="EPUB"]) [data-command="epub-reader"] {
          display: none;
        }
        .entry:not([data-mime="application/json"]) [data-command="json-beautifier"] {
          display: none;
        }
        .entry:not([data-mime="application/pdf"]) [data-command="pdf-reader"] {
          display: none;
        }
        .entry:not([data-mime="image/png"]) [data-command="png-optimizer"] {
          display: none;
        }
        .entry:not([data-mime^="video/"]):not([data-mime^="audio/"]) [data-command="convert-to-mp3"] {
          display: none;
        }
        .entry:not([data-mime^="video/"]) [data-command="video-converter"] {
          display: none;
        }
        .entry:not([data-mime^="audio/"]) [data-command="audio-converter"] {
          display: none;
        }
        .entry:not([data-mime^="image/"]) [data-command="image-vectorizer"] {
          display: none;
        }
        .entry:not([data-mime^="image/"]) [data-command="image-to-base64"] {
          display: none;
        }

        .entry[data-state="transfer"] div[data-id="actions"] [data-command] {
          display: none;
        }

        .entry div[data-id="name-container"] {
          display: grid;
          grid-template-columns: min-content 1fr;
          grid-column-gap: 10px;
        }
        @media screen and (max-width: 600px) {
          .entry div[data-id="name-container"] {
            grid-template-columns: 1fr;
          }
        }
        .entry span[data-id=name] {
          font-weight: bold;
          display: inline-block;
          max-width: 300px;
          cursor: pointer;
        }
        @media screen and (max-width: 600px) {
          .entry span[data-id=name] {
            max-width: unset;
          }
        }
        .entry span[data-id=name],
        .entry a[data-id=link] {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .entry:not([data-state="complete"]) span[data-id=name] {
          pointer-events: none;
        }
        .entry[data-state="complete"][data-exists="true"] span[data-id=name] {
          color: var(--blue);
        }
        .entry[data-state="complete"][data-exists="false"] span[data-id=name],
        .entry[data-state="0"] span[data-id=name] {
          text-decoration: line-through;
          color: inherit;
          cursor: default;
        }
        .entry a[data-id=link] {
          color: var(--gray);
          text-decoration: none;
        }
        .entry span[data-id=state] {
          font-weight: bold;
        }
        .entry[data-state="complete"] div[data-id="progress"],
        .entry[data-state="not_started"] div[data-id="progress"],
        .entry[data-state="interrupted"] div[data-id="progress"] {
          display: none;
        }
        .entry div[data-id="progress"] {
          grid-column-start: 1;
          grid-column-end: 3;
        }
        .entry div[data-id="progress"] > div[data-id=partial] {
          background-color: var(--bg-gray);
          background-repeat: no-repeat;
          display: flex;
          height: 3px;
        }
        .entry[data-state="transfer"] div[data-id=partial] {
          display: none;
        }
        .entry[data-threads=false] div[data-id="progress"] > div[data-id=partial] {
          display: none;
        }
        .entry div[data-id="progress"] > div[data-id=total] {
          background-color: var(--bg-gray);
          display: flex;
        }
        .entry div[data-id="progress"] div[data-id=total] span {
          height: 3px;
          display: inline-block;
          background-color: var(--blue);
        }
        .entry[data-threads=false] div[data-id="progress"] div[data-id=total] span {
          height: 4px;
        }
      </style>
      <div class="entry">
        <img data-id="icon" src="download.png">
        <div data-id="name-container">
          <span data-id="name" data-command="open"></span>
          <a data-id="link"></a>
        </div>
        <div data-id="tools">
          <div>
            <span data-id="speed"></span>
            <span data-id="size"></span>
          </div>
          <div data-id="actions">
            <span data-remote data-command="png-optimizer">OPTIMIZE</span>
            <span data-remote data-command="image-to-base64">BASE64</span>
            <span data-remote data-command="image-vectorizer">VECTORIZE</span>
            <span data-remote data-command="video-converter">CONVERT</span>
            <span data-remote data-command="audio-converter">CONVERT</span>
            <span data-remote data-command="convert-to-mp3">MP3</span>
            <span data-remote data-command="epub-reader">READER</span>
            <span data-remote data-command="pdf-reader">READER</span>
            <span data-remote data-command="json-beautifier">BEAUTIFY</span>
            <span data-remote data-command="zip-manager">EXTRACT</span>
            <span data-command="cancel">CANCEL</span>
            <span data-command="pause">PAUSE</span>
            <span data-command="resume">RESUME</span>
            <span data-command="start">START</span>
            <span data-command="show">SHOW</span>
            <span data-command="erase">REMOVE</span>
          </div>
        </div>
        <div data-id="progress">
          <div data-id="total">
            <span></span>
          </div>
          <div data-id="partial">
            <span></span>
          </div>
        </div>
      </div>
    `;
    this.entry = shadowRoot.querySelector('.entry');
  }
  connectedCallback() {
    this.entry.addEventListener('click', e => {
      const detail = e.target.dataset.command;
      if (detail) {
        this.dispatchEvent(new CustomEvent('command', {
          detail,
          bubbles: true
        }));
      }
    });
  }
  format(bytes, na = 'NA') {
    if (bytes <= 0) {
      return na;
    }
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
  }
  progress(d) {
    const {entry} = this;
    entry.querySelector('[data-id=total] span').style.width = d.bytesReceived / d.totalBytes * 100 + '%';
    if (d.sections) {
      const [ranges, max] = [d.sections, d.totalBytes];

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
      Object.assign(entry.querySelector('[data-id=partial]').style, {
        'background-image': images.join(','),
        'background-size': sizes.join(',')
      });
    }
  }
  /* ui */
  speed(d) {
    const {speed, threads, startTime, estimatedEndTime, bytesReceived, totalBytes} = d;
    const {format, entry} = this;
    const e = entry.querySelector('[data-id=speed]');
    if ('speed' in d) {
      e.textContent = 'Speed: ' + format(speed, '0') + '/s, Threads: ' + threads + ',';
    }
    else {
      if (totalBytes > 0) {
        const s = (totalBytes - bytesReceived) / (new Date(estimatedEndTime) - Date.now()) * 1000;
        e.textContent = 'Speed: ' + (bytesReceived && estimatedEndTime ? format(s) + '/s,' : '0 B/s,');
      }
      else {
        const s = bytesReceived / (Date.now() - new Date(startTime)) * 1000;
        e.textContent = 'Speed: ' + (bytesReceived && startTime ? format(s) + '/s,' : '0 B/s,');
      }
    }
  }
  size({state, bytesReceived, fileSize, totalBytes}) {
    const {format, entry} = this;
    const e = entry.querySelector('[data-id=size]');
    if (state === 'in_progress') {
      e.textContent = format(bytesReceived) + ' of ' + format(totalBytes > 0 ? totalBytes : fileSize);
    }
    else if (state === 'not_started') {
      e.textContent = 'Size: NA';
    }
    else {
      e.textContent = 'Size: ' + format(totalBytes > 0 ? totalBytes : fileSize);
    }
  }
  meta(d) {
    const {entry} = this;
    const link = entry.querySelector('[data-id=link]');
    // Firefox only
    if (isFirefox && d.state === 'interrupted' && d.paused && d.canResume) {
      d.state = 'in_progress';
    }

    if (d.error) {
      link.textContent = d.error;
    }
    else if (d.state === 'transfer') {
      link.textContent = 'Merging Segments. Please wait...';
    }
    Object.assign(entry.dataset, {
      paused: d.paused,
      state: d.state,
      exists: d.exists,
      queue: d.queue,
      threads: 'sections' in d
    });
  }
  name(d) {
    const {entry} = this;
    const name = entry.querySelector('[data-id=name]');
    name.title = name.textContent = d.filename.split(/[\\/]/).pop();
    if (d.m3u8 && d.m3u8.count > 1) {
      name.textContent = `[${d.m3u8.current}/${d.m3u8.count}] ` + name.textContent;
    }
  }
  update(d) {
    this.speed(d);
    this.size(d);
    this.progress(d);
    this.meta(d);
    this.name(d);
  }
  once(d) {
    const {entry} = this;
    const link = entry.querySelector('[data-id=link]');

    link.textContent = d.error || d.finalUrl || d.url;
    link.href = d.finalUrl || d.url;

    Object.assign(entry.dataset, {
      mime: d.mime,
      extension: (d.filename.match(/\.([0-9a-z]+)$/i) || ['', ''])[1].toUpperCase()
    });
  }
  preview(iconURL) {
    const img = this.entry.querySelector('img');
    img.src = iconURL;
  }
}
window.customElements.define('download-item', DownloadItem);
