'use strict';

var dom = {};

dom.$ = (name, value = 'value') => {
  const e = document.getElementById(name);

  return {
    on: (name, callback) => e.addEventListener(name, callback),
    get value() {
      return e[value];
    },
    set value(val) {
      e[value] = val;
    }
  };
};
dom.$$ = query => {
  const e = document.querySelector(query);
  return {
    on: (name, callback) => e.addEventListener(name, callback)
  };
};
dom.set = (name, value) => {
  if (typeof name === 'string') {
    document.getElementById(name).value = value;
  }
  else {
    Object.entries(name).forEach(([name, value]) => dom.set(name, value));
  }
};
dom.storage = {
  get: (name, dvalue) => {
    return localStorage.getItem(name) || dvalue;
  },
  set: (name, value) => {
    if (typeof name === 'string') {
      localStorage.setItem(name, value);
    }
    else {
      Object.entries(name).forEach(([name, value]) => dom.storage.set(name, value));
    }
  }
};
