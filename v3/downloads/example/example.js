/* globals downloads */
'use strict';

downloads.onCreated.addListener(d => {
  console.log('new download is created', d);
});
downloads.onChanged.addListener(d => {
  console.log('download status changed', d);
});
downloads.download({
  // url: 'http://127.0.0.1:2000/aaaa'
  url: 'https://github.com/andy-portmen/native-client/releases/download/0.8.8/mac.zip'
}, d => console.log('d', d), {
  'max-segment-size': 10 * 1024 * 1024, // max size for a single downloading segment
  'max-number-of-threads': 5,
  'max-retires': 5,
  'speed-over-seconds': 10,
  'max-simultaneous-writes': 1
});
