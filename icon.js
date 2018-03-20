'use strict';

var icon = {};

{
  const canvas = document.createElement('canvas');

  function draw19(value, mag, type) {
    const ctx = canvas.getContext('2d');

    canvas.width = 38 * mag;
    canvas.height = 38 * mag;
    ctx.clearRect(0, 0, 38 * mag, 38 * mag);
    ctx.beginPath();
    ctx.arc(19 * mag, 19 * mag, 17 * mag, 0, 2 * Math.PI);
    ctx.strokeStyle = '#a2a2a2';
    ctx.lineWidth = 4 * mag;
    ctx.stroke();

    if (value) {
      ctx.beginPath();
      ctx.arc(19 * mag, 19 * mag, 17 * mag, 0, 2 * (value / 100) * Math.PI);
      ctx.strokeStyle = '#2883fc';
      ctx.lineWidth = 4 * mag;
      ctx.stroke();
    }
    if (type === 'error') {
      ctx.beginPath();
      ctx.moveTo(28 * mag, 26 * mag);
      ctx.lineTo(19 * mag, 8 * mag);
      ctx.lineTo(10 * mag, 26 * mag);
      ctx.closePath();
      ctx.strokeStyle = '#fff';
      ctx.fillStyle = '#595959';
      ctx.lineWidth = 2 * mag;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(19 * mag, 21 * mag);
      ctx.lineTo(19 * mag, 14 * mag);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(19 * mag, 23 * mag, mag, 0, 2 * Math.PI);
      ctx.fillStyle = '#fff';
      ctx.fill();
    }
    else if (type === 'done') {
      ctx.beginPath();
      ctx.moveTo(19 * mag, 28 * mag);
      ctx.lineTo(12 * mag, 22 * mag);
      ctx.lineTo(15 * mag, 18 * mag);
      ctx.lineTo(18 * mag, 22 * mag);
      ctx.lineTo(25 * mag, 10 * mag);
      ctx.lineTo(28 * mag, 12 * mag);
      ctx.closePath();
      ctx.fillStyle = '#595959';
      ctx.fill();
    }
    else {
      ctx.beginPath();
      ctx.moveTo(16 * mag, 10 * mag);
      ctx.lineTo(22 * mag, 10 * mag);
      ctx.lineTo(22 * mag, 22 * mag);
      ctx.lineTo(26 * mag, 22 * mag);
      ctx.lineTo(19 * mag, 30 * mag);
      ctx.lineTo(12 * mag, 22 * mag);
      ctx.lineTo(16 * mag, 22 * mag);
      ctx.lineTo(16 * mag, 10 * mag);
      ctx.fillStyle = '#595959';
      ctx.fill();
    }

    return ctx.getImageData(0, 0, 19, 19);
  }

  icon.build = (id => (type = 'normal', value) => {
    if (type !== 'normal') {
      window.clearTimeout(id);
      id = window.setTimeout(icon.build, 3000, null, 'normal', 0);
    }
    if (value === 100) {
      return icon.build('done', 0);
    }
    chrome.browserAction.setIcon({
      imageData: {
        19: draw19(value, 0.5, type),
        38: draw19(value, 1, type)
      }
    });
  })();
}
