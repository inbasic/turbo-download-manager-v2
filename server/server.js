'use strict';

const http = require('http');
const path = require('path');
// const Throttle = require('throttle');
const finalhandler = require('finalhandler');
const serveStatic = require('serve-static-throttle');
const contentDisposition = require('content-disposition');

function getUserHome() {
  return process.env[(process.platform === 'win32') ? 'USERPROFILE' : 'HOME'];
}

const root = path.join(getUserHome(), 'Desktop');

function setHeaders(res, path) {
  res.setHeader('Content-Disposition', contentDisposition(path));
  res.setHeader('Accept-Ranges', 'bytes');
}

const srv = serveStatic(root, {
  'index': true,
  'setHeaders': setHeaders,
  'throttle': 1 * 1024 * 1024
});

const server = http.createServer(function onRequest(req, res) {
  srv(req, res, finalhandler(req, res));
});

server.listen(7777);
console.log(`Server started...`, root);
