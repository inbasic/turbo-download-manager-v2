/**
    Turbo Download Manager - A download manager with the ability to pause and resume downloads

    Copyright (C) 2014-2023 [InBasic](https://webextension.org/listing/turbo-download-manager-v2.html)

    This program is free software: you can redistribute it and/or modify
    it under the terms of the Mozilla Public License as published by
    the Mozilla Foundation, either version 2 of the License, or
    (at your option) any later version.
    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    Mozilla Public License for more details.
    You should have received a copy of the Mozilla Public License
    along with this program.  If not, see {https://www.mozilla.org/en-US/MPL/}.

    GitHub: https://github.com/inbasic/turbo-download-manager-v2/
    Homepage: https://webextension.org/listing/turbo-download-manager-v2.html
*/

const once = async () => {
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  if (rules.length) {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: rules.map(o => o.id),
      addRules: []
    });
  }

  const a = chrome.runtime.getContexts ? await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL('/downloads/index.html')]
  }) : [];
  if (a.length === 0) {
    return chrome.offscreen.createDocument({
      url: '/downloads/index.html',
      reasons: ['IFRAME_SCRIPTING'],
      justification: 'run TDM engine'
    }).catch(() => {});
  }
};

chrome.runtime.onStartup.addListener(once);
chrome.runtime.onInstalled.addListener(once);

chrome.runtime.onConnect.addListener(port => {
  if (port.name === 'file.store') {
    port.onMessage.addListener(request => {
      if (request.method === 'download') {
        chrome.downloads.download({
          url: request.url,
          filename: request.filename || 'unknown'
        }, id => {
          const lastError = chrome.runtime.lastError;
          if (lastError) {
            chrome.downloads.download({
              url: request.url,
              filename: request.filename || 'unknown'
            }, id => {
              const lastError = chrome.runtime.lastError;
              if (lastError) {
                port.postMessage({
                  method: 'error',
                  message: lastError.message
                });
              }
              else {
                port.postMessage({
                  method: 'resolve',
                  id
                });
              }
            });
          }
          else {
            port.postMessage({
              method: 'resolve',
              id
            });
          }
        });
      }
    });
  }
  else if (port.name === 'file.store.watch') {
    port.onMessage.addListener(request => {
      if (request.method === 'download') {
        const next = id => {
          chrome.downloads.search({
            id
          }, ([d]) => port.postMessage({
            method: 'started',
            d
          }));

          function observe(d) {
            if (d.id === id && d.state) {
              if (d.state.current === 'complete' || d.state.current === 'interrupted') {
                chrome.downloads.onChanged.removeListener(observe);
                port.postMessage({
                  method: 'revoke'
                });
                if (d.state.current === 'complete') {
                  chrome.downloads.search({id}, ([d]) => {
                    if (d) {
                      port.postMessage({
                        method: 'resolve',
                        d
                      });
                    }
                    else {
                      port.postMessage({
                        method: 'reject',
                        message: 'I am not able to find the downloaded file!'
                      });
                    }
                  });
                }
                else {
                  port.postMessage({
                    method: 'reject',
                    message: 'The downloading job got interrupted'
                  });
                }
              }
            }
          }
          chrome.downloads.onChanged.addListener(observe);
        };

        chrome.downloads.download({
          url: request.url,
          filename: request.filename || 'unknown'
        }, id => {
          const lastError = chrome.runtime.lastError;
          if (lastError) {
            chrome.downloads.download({
              url: request.url,
              filename: request.filename || 'unknown'
            }, id => {
              const lastError = chrome.runtime.lastError;
              if (lastError) {
                port.postMessage({
                  method: 'error',
                  message: lastError.message
                });
              }
              else {
                next(id);
              }
            });
          }
          else {
            next(id);
          }
        });
      }
    });
  }
});

chrome.runtime.onMessage.addListener((request, sender, response) => {
  if (request.method === 'file.window') {
    chrome.windows.create(request.args);
  }
  else if (request.method === 'downloads.search') {
    chrome.downloads.search({
      id: request.id
    }, response);
    return true;
  }
  else if (request.method === 'downloads.set.referrer') {
    chrome.declarativeNetRequest.getSessionRules().then(rules => {
      for (const id of Array.from({length: 500}, () => Math.floor(Math.random() * 500))) {
        if (rules.some(o => o.id === id) === false) {
          const requestHeaders = [{
            'operation': 'set',
            'header': 'referer',
            'value': request.referrer
          }];
          try {
            requestHeaders.push({
              'operation': 'set',
              'header': 'origin',
              'value': (new URL(request.referrer)).origin
            });
          }
          catch (e) {}

          return chrome.declarativeNetRequest.updateSessionRules({
            removeRuleIds: [],
            addRules: [{
              'id': id,
              'priority': 1,
              'action': {
                'type': 'modifyHeaders',
                requestHeaders
              },
              'condition': {
                'tabIds': [-1],
                'urlFilter': request.href
              }
            }]
          }).then(() => response(id));
        }
      }
    });
    return true;
  }
  else if (request.method === 'downloads.remove.referrer') {
    chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [request.id],
      addRules: []
    });
  }
});
