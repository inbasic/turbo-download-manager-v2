'use strict';

(function(exports) {

// Bomb out if the Filesystem API is available natively.
if (exports.requestFileSystem || exports.webkitRequestFileSystem) {
  return;
}

// Bomb out if no indexedDB available
const indexedDB = exports.indexedDB || exports.mozIndexedDB ||
                  exports.msIndexedDB;
if (!indexedDB) {
  return;
}

let IDB_SUPPORTS_BLOB = true;

const Base64ToBlob = function(dataURL) {
  var BASE64_MARKER = ';base64,';
  if (dataURL.indexOf(BASE64_MARKER) == -1) {
    var parts = dataURL.split(',');
    var contentType = parts[0].split(':')[1];
    var raw = decodeURIComponent(parts[1]);

    return new Blob([raw], {type: contentType});
  }

  var parts = dataURL.split(BASE64_MARKER);
  var contentType = parts[0].split(':')[1];
  var raw = window.atob(parts[1]);
  var rawLength = raw.length;

  var uInt8Array = new Uint8Array(rawLength);

  for (var i = 0; i < rawLength; ++i) {
    uInt8Array[i] = raw.charCodeAt(i);
  }

  return new Blob([uInt8Array], {type: contentType});
};

const BlobToBase64 = function(blob, onload) {
  var reader = new FileReader();
  reader.readAsDataURL(blob);
  reader.onloadend = function() {
    onload(reader.result);
  };
};

if (!exports.PERSISTENT) {
  exports.TEMPORARY = 0;
  exports.PERSISTENT = 1;
}

// Prevent errors in browsers that don't support FileError.
// TODO: FF 13+ supports DOM4 Events (DOMError). Use them instead?
if (exports.FileError === undefined) {
  window.FileError = function() {};
  FileError.prototype.prototype = Error.prototype;
}

if (!FileError.INVALID_MODIFICATION_ERR) {
  FileError.INVALID_MODIFICATION_ERR = 9;
  FileError.NOT_FOUND_ERR  = 1;
}

function MyFileError(obj) {
  var code_ = obj.code;
  var name_ = obj.name;

    // Required for FF 11.
  Object.defineProperty(this, 'code', {
    set: function(code) {
      code_ = code;
    },
    get: function() {
      return code_;
    }
  });

  Object.defineProperty(this, 'name', {
    set: function(name) {
      name_ = name;
    },
    get: function() {
      return name_;
    }
  });
}

MyFileError.prototype = FileError.prototype;
MyFileError.prototype.toString = Error.prototype.toString;

const INVALID_MODIFICATION_ERR = new MyFileError({
      code: FileError.INVALID_MODIFICATION_ERR,
      name: 'INVALID_MODIFICATION_ERR'});
const NOT_IMPLEMENTED_ERR = new MyFileError({code: 1000,
                                             name: 'Not implemented'});
const NOT_FOUND_ERR = new MyFileError({code: FileError.NOT_FOUND_ERR,
                                       name: 'Not found'});

let fs_ = null;

// Browsers other than Chrome don't implement persistent vs. temporary storage.
// but default to temporary anyway.
let storageType_ = 'temporary';
const idb_ = {db: null};
const FILE_STORE_ = 'entries';

const DIR_SEPARATOR = '/';
const DIR_OPEN_BOUND = String.fromCharCode(DIR_SEPARATOR.charCodeAt(0) + 1);

// When saving an entry, the fullPath should always lead with a slash and never
// end with one (e.g. a directory). Also, resolve '.' and '..' to an absolute
// one. This method ensures path is legit!
function resolveToFullPath_(cwdFullPath, path) {
  var fullPath = path;

  var relativePath = path[0] != DIR_SEPARATOR;
  if (relativePath) {
    fullPath = cwdFullPath + DIR_SEPARATOR + path;
  }

  // Normalize '.'s,  '..'s and '//'s.
  var parts = fullPath.split(DIR_SEPARATOR);
  var finalParts = [];
  for (var i = 0; i < parts.length; ++i) {
    var part = parts[i];
    if (part === '..') {
      // Go up one level.
      if (!finalParts.length) {
        throw Error('Invalid path');
      }
      finalParts.pop();
    } else if (part === '.') {
      // Skip over the current directory.
    } else if (part !== '') {
      // Eliminate sequences of '/'s as well as possible leading/trailing '/'s.
      finalParts.push(part);
    }
  }

  fullPath = DIR_SEPARATOR + finalParts.join(DIR_SEPARATOR);

  // fullPath is guaranteed to be normalized by construction at this point:
  // '.'s, '..'s, '//'s will never appear in it.

  return fullPath;
}

// // Path can be relative or absolute. If relative, it's taken from the cwd_.
// // If a filesystem URL is passed it, it is simple returned
// function pathToFsURL_(path) {
//   path = resolveToFullPath_(cwdFullPath, path);
//   path = fs_.root.toURL() + path.substring(1);
//   return path;
// };

/**
 * Interface to wrap the native File interface.
 *
 * This interface is necessary for creating zero-length (empty) files,
 * something the Filesystem API allows you to do. Unfortunately, File's
 * constructor cannot be called directly, making it impossible to instantiate
 * an empty File in JS.
 *
 * @param {Object} opts Initial values.
 * @constructor
 */
function MyFile(opts) {
  var blob_ = null;

  this.size = opts.size || 0;
  this.name = opts.name || '';
  this.type = opts.type || '';
  this.lastModifiedDate = opts.lastModifiedDate || null;
  //this.slice = Blob.prototype.slice; // Doesn't work with structured clones.

  // Need some black magic to correct the object's size/name/type based on the
  // blob that is saved.
  Object.defineProperty(this, 'blob_', {
    enumerable: true,
    get: function() {
      return blob_;
    },
    set: function (val) {
      blob_ = val;
      this.size = blob_.size;
      this.name = blob_.name;
      this.type = blob_.type;
      this.lastModifiedDate = blob_.lastModifiedDate;
    }.bind(this)
  });
}
MyFile.prototype.constructor = MyFile;
//MyFile.prototype.slice = Blob.prototype.slice;

/**
 * Interface to writing a Blob/File.
 *
 * Modeled from:
 * dev.w3.org/2009/dap/file-system/file-writer.html#the-filewriter-interface
 *
 * @param {FileEntry} fileEntry The FileEntry associated with this writer.
 * @constructor
 */
function FileWriter(fileEntry) {
  if (!fileEntry) {
    throw Error('Expected fileEntry argument to write.');
  }

  var position_ = 0;
  var blob_ = fileEntry.file_ ? fileEntry.file_.blob_ : null;

  Object.defineProperty(this, 'position', {
    get: function() {
      return position_;
    }
  });

  Object.defineProperty(this, 'length', {
    get: function() {
      return blob_ ? blob_.size : 0;
    }
  });

  this.seek = function(offset) {
    position_ = offset;

    if (position_ > this.length) {
      position_ = this.length;
    }
    if (position_ < 0) {
      position_ += this.length;
    }
    if (position_ < 0) {
      position_ = 0;
    }
  };

  this.truncate = function(size) {
    console.log(size, blob_);
    if (blob_) {
      if (size < this.length) {
        blob_ = blob_.slice(0, size);
      } else {
        blob_ = new Blob([blob_, new Uint8Array(size - this.length)],
                         {type: blob_.type});
      }
    } else {
      blob_ = new Blob([]);
    }

    position_ = 0; // truncate from beginning of file.

    this.write(blob_); // calls onwritestart and onwriteend.
  };

  this.write = function(data) {
    if (!data) {
      throw Error('Expected blob argument to write.');
    }

    // Call onwritestart if it was defined.
    if (this.onwritestart) {
      this.onwritestart();
    }

    // TODO: not handling onprogress, onwrite, onabort. Throw an error if
    // they're defined.

    if (blob_) {
      // Calc the head and tail fragments
      var head = blob_.slice(0, position_);
      var tail = blob_.slice(position_ + data.size);

      // Calc the padding
      var padding = position_ - head.size;
      if (padding < 0) {
        padding = 0;
      }

      // Do the "write". In fact, a full overwrite of the Blob.
      // TODO: figure out if data.type should overwrite the exist blob's type.
      blob_ = new Blob([head, new Uint8Array(padding), data, tail],
                       {type: blob_.type});
    } else {
      blob_ = new Blob([data], {type: data.type});
    }

    const writeFile = function(blob) {
      // Blob might be a DataURI depending on browser support.
      fileEntry.file_.blob_ = blob;
      fileEntry.file_.lastModifiedDate = data.lastModifiedDate || new Date();
      idb_.put(fileEntry, function(entry) {
        if (!IDB_SUPPORTS_BLOB) {
          // Set the blob we're writing on this file entry so we can recall it later.
          fileEntry.file_.blob_ = blob_;
          fileEntry.file_.lastModifiedDate = data.lastModifiedDate || null;
        }

        // Add size of data written to writer.position.
        position_ += data.size;

        if (this.onwriteend) {
          this.onwriteend();
        }
      }.bind(this), this.onerror);
    }.bind(this);

    if (IDB_SUPPORTS_BLOB) {
      writeFile(blob_);
    } else {
      BlobToBase64(blob_, writeFile);
    }
  };
}


/**
 * Interface for listing a directory's contents (files and folders).
 *
 * Modeled from:
 * dev.w3.org/2009/dap/file-system/pub/FileSystem/#idl-def-DirectoryReader
 *
 * @constructor
 */
function DirectoryReader(dirEntry) {
  var dirEntry_ = dirEntry;
  var used_ = false;

  this.readEntries = function(successCallback, opt_errorCallback) {
    if (!successCallback) {
      throw Error('Expected successCallback argument.');
    }

    // This is necessary to mimic the way DirectoryReader.readEntries() should
    // normally behavior.  According to spec, readEntries() needs to be called
    // until the length of result array is 0. To handle someone implementing
    // a recursive call to readEntries(), get everything from indexedDB on the
    // first shot. Then (DirectoryReader has been used), return an empty
    // result array.
    if (!used_) {
      idb_.getAllEntries(dirEntry_.fullPath, function(entries) {
        used_= true;
        successCallback(entries);
      }, opt_errorCallback);
    } else {
      successCallback([]);
    }
  };
};

/**
 * Interface supplies information about the state of a file or directory.
 *
 * Modeled from:
 * dev.w3.org/2009/dap/file-system/file-dir-sys.html#idl-def-Metadata
 *
 * @constructor
 */
function Metadata(modificationTime, size) {
  this.modificationTime_ = modificationTime || null;
  this.size_ = size || 0;
}

Metadata.prototype = {
  get modificationTime() {
    return this.modificationTime_;
  },
  get size() {
    return this.size_;
  }
}

/**
 * Interface representing entries in a filesystem, each of which may be a File
 * or DirectoryEntry.
 *
 * Modeled from:
 * dev.w3.org/2009/dap/file-system/pub/FileSystem/#idl-def-Entry
 *
 * @constructor
 */
function Entry() {}

Entry.prototype = {
  name: null,
  fullPath: null,
  filesystem: null,
  copyTo: function() {
    throw NOT_IMPLEMENTED_ERR;
  },
  getMetadata: function(successCallback, opt_errorCallback) {
    if (!successCallback) {
      throw Error('Expected successCallback argument.');
    }

    try {
      if (this.isFile) {
        successCallback(
            new Metadata(this.file_.lastModifiedDate, this.file_.size));
      } else {
        opt_errorCallback(new MyFileError({code: 1001,
            name: 'getMetadata() not implemented for DirectoryEntry'}));
      }
    } catch(e) {
      opt_errorCallback && opt_errorCallback(e);
    }
  },
  getParent: function() {
    throw NOT_IMPLEMENTED_ERR;
  },
  moveTo: function() {
    throw NOT_IMPLEMENTED_ERR;
  },
  remove: function(successCallback, opt_errorCallback) {
    if (!successCallback) {
      throw Error('Expected successCallback argument.');
    }
    // TODO: This doesn't protect against directories that have content in it.
    // Should throw an error instead if the dirEntry is not empty.
    idb_['delete'](this.fullPath, function() {
      successCallback();
    }, opt_errorCallback);
  },
  toURL: function() {
    var origin = location.protocol + '//' + location.host;
    return 'filesystem:' + origin + DIR_SEPARATOR + storageType_.toLowerCase() +
           this.fullPath;
  },
};

/**
 * Interface representing a file in the filesystem.
 *
 * Modeled from:
 * dev.w3.org/2009/dap/file-system/pub/FileSystem/#the-fileentry-interface
 *
 * @param {FileEntry} opt_fileEntry Optional FileEntry to initialize this
 *     object from.
 * @constructor
 * @extends {Entry}
 */
function FileEntry(opt_fileEntry) {
  this.file_ = null;

  Object.defineProperty(this, 'isFile', {
    enumerable: true,
    get: function() {
      return true;
    }
  });
  Object.defineProperty(this, 'isDirectory', {
    enumerable: true,
    get: function() {
      return false;
    }
  });

  // Create this entry from properties from an existing FileEntry.
  if (opt_fileEntry) {
    this.file_ = opt_fileEntry.file_;
    this.name = opt_fileEntry.name;
    this.fullPath = opt_fileEntry.fullPath;
    this.filesystem = opt_fileEntry.filesystem;
    if (typeof(this.file_.blob_) === "string") {
      this.file_.blob_ = Base64ToBlob(this.file_.blob_);
    }
  }
}
FileEntry.prototype = new Entry();
FileEntry.prototype.constructor = FileEntry;
FileEntry.prototype.createWriter = function(callback) {
  // TODO: figure out if there's a way to dispatch onwrite event as we're writing
  // data to IDB. Right now, we're only calling onwritend/onerror
  // FileEntry.write().
  callback(new FileWriter(this));
};
FileEntry.prototype.file = function(successCallback, opt_errorCallback) {
  if (!successCallback) {
    throw Error('Expected successCallback argument.');
  }

  if (this.file_ == null) {
    if (opt_errorCallback) {
      opt_errorCallback(NOT_FOUND_ERR);
    } else {
      throw NOT_FOUND_ERR;
    }
    return;
  }

  // If we're returning a zero-length (empty) file, return the fake file obj.
  // Otherwise, return the native File object that we've stashed.
  var file = this.file_.blob_ == null ? this.file_ : this.file_.blob_;
  file.lastModifiedDate = this.file_.lastModifiedDate;

  // Add Blob.slice() to this wrapped object. Currently won't work :(
  /*if (!val.slice) {
    val.slice = Blob.prototype.slice; // Hack to add back in .slice().
  }*/
  successCallback(file);
};

/**
 * Interface representing a directory in the filesystem.
 *
 * Modeled from:
 * dev.w3.org/2009/dap/file-system/pub/FileSystem/#the-directoryentry-interface
 *
 * @param {DirectoryEntry} opt_folderEntry Optional DirectoryEntry to
 *     initialize this object from.
 * @constructor
 * @extends {Entry}
 */
function DirectoryEntry(opt_folderEntry) {
  Object.defineProperty(this, 'isFile', {
    enumerable: true,
    get: function() {
      return false;
    }
  });
  Object.defineProperty(this, 'isDirectory', {
    enumerable: true,
    get: function() {
      return true;
    }
  });

  // Create this entry from properties from an existing DirectoryEntry.
  if (opt_folderEntry) {
    this.name = opt_folderEntry.name;
    this.fullPath = opt_folderEntry.fullPath;
    this.filesystem = opt_folderEntry.filesystem;
  }
}
DirectoryEntry.prototype = new Entry();
DirectoryEntry.prototype.constructor = DirectoryEntry;
DirectoryEntry.prototype.createReader = function() {
  return new DirectoryReader(this);
};
DirectoryEntry.prototype.getDirectory = function(path, options, successCallback,
                                                 opt_errorCallback) {

  // Create an absolute path if we were handed a relative one.
  path = resolveToFullPath_(this.fullPath, path);

  idb_.get(path, function(folderEntry) {
    if (!options) {
      options = {};
    }

    if (options.create === true && options.exclusive === true && folderEntry) {
      // If create and exclusive are both true, and the path already exists,
      // getDirectory must fail.
      if (opt_errorCallback) {
        opt_errorCallback(INVALID_MODIFICATION_ERR);
        return;
      }
    } else if (options.create === true && !folderEntry) {
      // If create is true, the path doesn't exist, and no other error occurs,
      // getDirectory must create it as a zero-length file and return a corresponding
      // DirectoryEntry.
      var dirEntry = new DirectoryEntry();
      dirEntry.name = path.split(DIR_SEPARATOR).pop(); // Just need filename.
      dirEntry.fullPath = path;
      dirEntry.filesystem = fs_;

      idb_.put(dirEntry, successCallback, opt_errorCallback);
    } else if (options.create === true && folderEntry) {

      if (folderEntry.isDirectory) {
        // IDB won't save methods, so we need re-create the DirectoryEntry.
        successCallback(new DirectoryEntry(folderEntry));
      } else {
        if (opt_errorCallback) {
          opt_errorCallback(INVALID_MODIFICATION_ERR);
          return;
        }
      }
    } else if ((!options.create || options.create === false) && !folderEntry) {
      // Handle root special. It should always exist.
      if (path == DIR_SEPARATOR) {
        folderEntry = new DirectoryEntry();
        folderEntry.name = '';
        folderEntry.fullPath = DIR_SEPARATOR;
        folderEntry.filesystem = fs_;
        successCallback(folderEntry);
        return;
      }

      // If create is not true and the path doesn't exist, getDirectory must fail.
      if (opt_errorCallback) {
        opt_errorCallback(NOT_FOUND_ERR);
        return;
      }
    } else if ((!options.create || options.create === false) && folderEntry &&
               folderEntry.isFile) {
      // If create is not true and the path exists, but is a file, getDirectory
      // must fail.
      if (opt_errorCallback) {
        opt_errorCallback(INVALID_MODIFICATION_ERR);
        return;
      }
    } else {
      // Otherwise, if no other error occurs, getDirectory must return a
      // DirectoryEntry corresponding to path.

      // IDB won't' save methods, so we need re-create DirectoryEntry.
      successCallback(new DirectoryEntry(folderEntry));
    }
  }, opt_errorCallback);
};

DirectoryEntry.prototype.getFile = function(path, options, successCallback,
                                            opt_errorCallback) {

  // Create an absolute path if we were handed a relative one.
  path = resolveToFullPath_(this.fullPath, path);

  idb_.get(path, function(fileEntry) {
    if (!options) {
      options = {};
    }

    if (options.create === true && options.exclusive === true && fileEntry) {
      // If create and exclusive are both true, and the path already exists,
      // getFile must fail.

      if (opt_errorCallback) {
        opt_errorCallback(INVALID_MODIFICATION_ERR);
        return;
      }
    } else if (options.create === true && !fileEntry) {
      // If create is true, the path doesn't exist, and no other error occurs,
      // getFile must create it as a zero-length file and return a corresponding
      // FileEntry.
      var fileEntry = new FileEntry();
      fileEntry.name = path.split(DIR_SEPARATOR).pop(); // Just need filename.
      fileEntry.fullPath = path;
      fileEntry.filesystem = fs_;
      fileEntry.file_ = new MyFile({size: 0, name: fileEntry.name,
                                    lastModifiedDate: new Date()});

      idb_.put(fileEntry, successCallback, opt_errorCallback);

    } else if (options.create === true && fileEntry) {
      if (fileEntry.isFile) {
        // IDB won't save methods, so we need re-create the FileEntry.
        successCallback(new FileEntry(fileEntry));
      } else {
        if (opt_errorCallback) {
          opt_errorCallback(INVALID_MODIFICATION_ERR);
          return;
        }
      }
    } else if ((!options.create || options.create === false) && !fileEntry) {
      // If create is not true and the path doesn't exist, getFile must fail.
      if (opt_errorCallback) {
        opt_errorCallback(NOT_FOUND_ERR);
        return;
      }
    } else if ((!options.create || options.create === false) && fileEntry &&
               fileEntry.isDirectory) {
      // If create is not true and the path exists, but is a directory, getFile
      // must fail.
      if (opt_errorCallback) {
        opt_errorCallback(INVALID_MODIFICATION_ERR);
        return;
      }
    } else {
      // Otherwise, if no other error occurs, getFile must return a FileEntry
      // corresponding to path.

      // IDB won't' save methods, so we need re-create the FileEntry.
      successCallback(new FileEntry(fileEntry));
    }
  }, opt_errorCallback);
};

DirectoryEntry.prototype.removeRecursively = function(successCallback,
                                                      opt_errorCallback) {
  if (!successCallback) {
    throw Error('Expected successCallback argument.');
  }

  this.remove(successCallback, opt_errorCallback);
};

/**
 * Interface representing a filesystem.
 *
 * Modeled from:
 * dev.w3.org/2009/dap/file-system/pub/FileSystem/#idl-def-LocalFileSystem
 *
 * @param {number} type Kind of storage to use, either TEMPORARY or PERSISTENT.
 * @param {number} size Storage space (bytes) the application expects to need.
 * @constructor
 */
function DOMFileSystem(type, size) {
  storageType_ = type == exports.TEMPORARY ? 'Temporary' : 'Persistent';
  this.name = (location.protocol + location.host).replace(/:/g, '_') +
              ':' + storageType_;
  this.root = new DirectoryEntry();
  this.root.fullPath = DIR_SEPARATOR;
  this.root.filesystem = this;
  this.root.name = '';
}

function requestFileSystem(type, size, successCallback, opt_errorCallback) {
  if (type != exports.TEMPORARY && type != exports.PERSISTENT) {
    if (opt_errorCallback) {
      opt_errorCallback(INVALID_MODIFICATION_ERR);
      return;
    }
  }

  fs_ = new DOMFileSystem(type, size);
  idb_.open(fs_.name, function(e) {
    successCallback(fs_);
  }, opt_errorCallback);
}

function resolveLocalFileSystemURL(url, successCallback, opt_errorCallback) {
  var origin = location.protocol + '//' + location.host;
  var base = 'filesystem:' + origin + DIR_SEPARATOR + storageType_.toLowerCase();
  url = url.replace(base, '');
  if (url.substr(-1) === '/') {
    url = url.slice(0, -1);
  }
  if (url) {
    idb_.get(url, function(entry) {
      if (entry) {
        if (entry.isFile) {
          return successCallback(new FileEntry(entry));
        } else if (entry.isDirectory) {
          return successCallback(new DirectoryEntry(entry));
        }
      } else {
        opt_errorCallback && opt_errorCallback(NOT_FOUND_ERR);
      }
    }, opt_errorCallback);
  } else {
    successCallback(fs_.root);
  }
}

// Core logic to handle IDB operations =========================================

idb_.open = function(dbName, successCallback, opt_errorCallback) {
  var self = this;

  // TODO: FF 12.0a1 isn't liking a db name with : in it.
  // var request = indexedDB.open(dbName.replace(':', '_')/*, 1 /*version*/);
  // https://bugzilla.mozilla.org/show_bug.cgi?id=1212985#c15
  var request = indexedDB.open(dbName, {
    version: 1,
    storage: 'persistent'
  });

  request.onerror = opt_errorCallback || onError;

  request.onupgradeneeded = function(e) {
    // First open was called or higher db version was used.

   // console.log('onupgradeneeded: oldVersion:' + e.oldVersion,
   //           'newVersion:' + e.newVersion);

    self.db = e.target.result;
    self.db.onerror = onError;

    if (!self.db.objectStoreNames.contains(FILE_STORE_)) {
      var store = self.db.createObjectStore(FILE_STORE_/*,{keyPath: 'id', autoIncrement: true}*/);
    }
  };

  request.onsuccess = function(e) {
    self.db = e.target.result;
    self.db.onerror = onError;
    successCallback(e);
  };

  request.onblocked = opt_errorCallback || onError;
};

idb_.close = function() {
  this.db.close();
  this.db = null;
};

// TODO: figure out if we should ever call this method. The filesystem API
// doesn't allow you to delete a filesystem once it is 'created'. Users should
// use the public remove/removeRecursively API instead.
idb_.drop = function(successCallback, opt_errorCallback) {
  if (!this.db) {
    return;
  }

  var dbName = this.db.name;

  var request = indexedDB.deleteDatabase(dbName);
  request.onsuccess = function(e) {
    successCallback(e);
  };
  request.onerror = opt_errorCallback || onError;

  idb_.close();
};

idb_.get = function(fullPath, successCallback, opt_errorCallback) {
  if (!this.db) {
    return;
  }

  var tx = this.db.transaction([FILE_STORE_], 'readonly');

  //var request = tx.objectStore(FILE_STORE_).get(fullPath);
  var range = IDBKeyRange.bound(fullPath, fullPath + DIR_OPEN_BOUND,
                                false, true);
  var request = tx.objectStore(FILE_STORE_).get(range);

  tx.onabort = opt_errorCallback || onError;
  tx.oncomplete = function(e) {
    successCallback(request.result);
  };
};

idb_.getAllEntries = function(fullPath, successCallback, opt_errorCallback) {
  if (!this.db) {
    return;
  }

  var results = [];

  //var range = IDBKeyRange.lowerBound(fullPath, true);
  //var range = IDBKeyRange.upperBound(fullPath, true);

  // Treat the root entry special. Querying it returns all entries because
  // they match '/'.
  var range = null;
  if (fullPath != DIR_SEPARATOR) {
    //console.log(fullPath + '/', fullPath + DIR_OPEN_BOUND)
    range = IDBKeyRange.bound(
        fullPath + DIR_SEPARATOR, fullPath + DIR_OPEN_BOUND, false, true);
  }

  var tx = this.db.transaction([FILE_STORE_], 'readonly');
  tx.onabort = opt_errorCallback || onError;
  tx.oncomplete = function(e) {
    // TODO: figure out how to do be range queries instead of filtering result
    // in memory :(
    results = results.filter(function(val) {
      var valPartsLen = val.fullPath.split(DIR_SEPARATOR).length;
      var fullPathPartsLen = fullPath.split(DIR_SEPARATOR).length;

      if (fullPath == DIR_SEPARATOR && valPartsLen < fullPathPartsLen + 1) {
        // Hack to filter out entries in the root folder. This is inefficient
        // because reading the entires of fs.root (e.g. '/') returns ALL
        // results in the database, then filters out the entries not in '/'.
        return val;
      } else if (fullPath != DIR_SEPARATOR &&
                 valPartsLen == fullPathPartsLen + 1) {
        // If this a subfolder and entry is a direct child, include it in
        // the results. Otherwise, it's not an entry of this folder.
        return val;
      }
    });

    successCallback(results);
  };

  var request = tx.objectStore(FILE_STORE_).openCursor(range);

  request.onsuccess = function(e) {
    var cursor = e.target.result;
    if (cursor) {
      var val = cursor.value;

      results.push(val.isFile ? new FileEntry(val) : new DirectoryEntry(val));
      cursor['continue']();
    }
  };
};

idb_['delete'] = function(fullPath, successCallback, opt_errorCallback) {
  if (!this.db) {
    return;
  }

  var tx = this.db.transaction([FILE_STORE_], 'readwrite');
  tx.oncomplete = successCallback;
  tx.onabort = opt_errorCallback || onError;

  //var request = tx.objectStore(FILE_STORE_).delete(fullPath);
  var range = IDBKeyRange.bound(
      fullPath, fullPath + DIR_OPEN_BOUND, false, true);
  var request = tx.objectStore(FILE_STORE_)['delete'](range);
};

idb_.put = function(entry, successCallback, opt_errorCallback) {
  if (!this.db) {
    return;
  }

  var tx = this.db.transaction([FILE_STORE_], 'readwrite');
  tx.onabort = opt_errorCallback || onError;
  tx.oncomplete = function(e) {
    // TODO: Error is thrown if we pass the request event back instead.
    successCallback(entry);
  };

  var request = tx.objectStore(FILE_STORE_).put(entry, entry.fullPath);
};

// Global error handler. Errors bubble from request, to transaction, to db.
function onError(e) {
  switch (e.target.errorCode) {
    case 12:
      console.log('Error - Attempt to open db with a lower version than the ' +
                  'current one.');
      break;
    default:
      console.log('errorCode: ' + e.target.errorCode);
  }

  console.log(e, e.code, e.message);
}

// Clean up.
// TODO: decide if this is the best place for this.
exports.addEventListener('beforeunload', function(e) {
  idb_.db && idb_.db.close();
}, false);

//exports.idb = idb_;
exports.requestFileSystem = requestFileSystem;
exports.resolveLocalFileSystemURL = resolveLocalFileSystemURL;

// Export more stuff (to window) for unit tests to do their thing.
if (exports === window && exports.RUNNING_TESTS) {
  exports['Entry'] = Entry;
  exports['FileEntry'] = FileEntry;
  exports['DirectoryEntry'] = DirectoryEntry;
  exports['resolveToFullPath_'] = resolveToFullPath_;
  exports['Metadata'] = Metadata;
  exports['Base64ToBlob'] = Base64ToBlob;
}

})(self); // Don't use window because we want to run in workers.
'use strict';

var File = function() {
  this.fileEntry = null;
  this.writers = [];
  this.requestFileSystem = (type, size, callback, error) => (window.requestFileSystem ||
    window.webkitRequestFileSystem || window.mozRequestFileSystem)(type, size, callback, e => {
      console.error(e);
      error(new Error('fatal: ' + e.message));
    });
};
File.prototype.log = function(...args) {
  console.log('FILE', ...args);
};
File.prototype.writer = function() {
  return new Promise((resolve, reject) => this.fileEntry.createWriter(resolve, reject));
};
File.prototype.open = function({size, truncate = false}) {
  this.log('open', 'size', size, 'truncate', truncate);
  const temporaryStorage = navigator.temporaryStorage ||
    navigator.webkitTemporaryStorage ||
    navigator.mozTemporaryStorage || {
      // unlimitedStorage for Firefox
      requestQuota: (usedBytes, callback) => callback(usedBytes)
    };

  return new Promise((resolve, reject) => {
    temporaryStorage.requestQuota(size, grantedBytes => {
      if (grantedBytes === size) {
        this.requestFileSystem(window.TEMPORARY, size, fs => {
          const name = Math.random().toString(36).substring(7);
          fs.root.getFile(name, {create: true, exclusive: false}, fileEntry => {
            this.fileEntry = fileEntry;
            if (truncate) {
              this.writer().then(fileWriter => {
                fileWriter.onwriteend = resolve;
                fileWriter.onerror = e => reject(e.target.error);
                this.writers.push(fileWriter);
                if (/Firefox/.test(navigator.userAgent)) {
                  fileWriter.write(new Blob([new Uint8Array(size)]));
                }
                else {
                  fileWriter.truncate(size);
                }
              }, reject);
            }
            else {
              resolve();
            }
          }, reject);
        }, reject);
      }
      else {
        reject(new Error(`fatal: requested filesize is "${size}", but granted filesize is "${grantedBytes}"`));
      }
    });
  });
};
File.prototype.write = async function({blob, offset = 0}) {
  this.log('write', offset, offset + blob.size);
  const fileWriter = this.writers.shift() || await this.writer();
  return new Promise((resolve, reject) => {
    fileWriter.onwriteend = resolve;
    fileWriter.onerror = e => reject(e.target.error);
    fileWriter.seek(offset);
    fileWriter.write(blob);
  // reuse the writer if this is not FF;
  }).finally(() => this.writers.push(fileWriter));
};
// in Firefox, simultaneous write are problematic
if (/Firefox/.test(navigator.userAgent)) {
  const write = File.prototype.write;
  File.prototype.write = async function(...args) {
    if (this.busy) {
      this.cache = this.cache || [];
      await new Promise(resolve => this.cache.push(resolve));
    }
    this.busy = true;

    return write.apply(this, args).finally(() => {
      this.busy = false;
      if (this.cache.length) {
        this.cache.shift()();
      }
    });
  };
}
File.prototype.download = function(filename, started = () => {}) {
  // this.log('download', filename);
  return new Promise((resolve, reject) => this.fileEntry.file(file => {
    Object.defineProperty(file, 'type', {
      get() {
        return 'video/mp4';
      }
    });
    const url = URL.createObjectURL(file);

    chrome.downloads.download({
      url,
      filename
    }, id => {
      chrome.downloads.search({
        id
      }, ([d]) => started(d));
      function observe(d) {
        if (d.id === id && d.state) {
          if (d.state.current === 'complete' || d.state.current === 'interrupted') {
            chrome.downloads.onChanged.removeListener(observe);
            URL.revokeObjectURL(url);
            if (d.state.current === 'complete') {
              chrome.downloads.search({id}, ([d]) => {
                if (d) {
                  resolve(d);
                }
                else {
                  reject(Error('fatal: I am not able to find the downloaded file!'));
                }
              });
            }
            else {
              reject(Error('The downloading job got interrupted'));
            }
          }
        }
      }
      chrome.downloads.onChanged.addListener(observe);
    });
  }));
};
File.prototype.remove = function() {
  // this.log('remove');
  return new Promise((resolve, reject) => this.fileEntry.remove(resolve, reject)).then(() => {
    delete this.requestFileSystem;
    // this.log('total number writers', this.writers.length);
    delete this.writers;
    delete this.fileEntry;
  });
};
File.prototype.list = function() {
  // this.log('list');
  return new Promise((resolve, reject) => {
    this.requestFileSystem(window.TEMPORARY, 0, fs => {
      const dirReader = fs.root.createReader();
      dirReader.readEntries(resolve, reject);
    }, reject);
  });
};
'use strict';

var Get = function() {
  this.active = true;
  this.id = null;
  this.done = false;
};

Get.prototype.timeout = function(period, msg) {
  window.clearTimeout(this.id);
  return new Promise((resolve, reject) => {
    this.id = window.setTimeout(() => reject(msg), period);
  });
};

Get.prototype.abort = function() {
  window.clearTimeout(this.id);
  this.active = false;
  if (this.reader) {
    this.reader.cancel();
  }
};

Get.prototype.fetch = async function(url, props = {}, progress = () => {}) {
  props.timeout = props.timeout || 30000;

  const response = await Promise.race([
    this._fetch(url, props),
    this.timeout(props.timeout, 'noresponse timeout')
  ]);
  // console.log(response.status);
  if (response.ok === false) {
    return Promise.reject(Error('fatal: ' + response.statusText));
  }
  if (this.active === false) {
    return 'aborted';
  }
  this.reader = response.body.getReader();

  const segment = () => Promise.race([
    (async() => {
      const {done, value} = await this.reader.read();
      if (value && value.byteLength) {
        progress({
          buffer: value
        });
      }

      window.clearTimeout(this.id);
      if (done) {
        this.done = true;
        return true;
      }
      else if (this.active === false) {
        return 'aborted';
      }
      else {
        return segment();
      }
    })(),
    this.timeout(props.timeout, 'nobody timeout')
  ]);

  return segment();
};

Get.prototype._fetch = (url, props) => fetch(url, props);

(isFirefox => { // Firefox polyfills
  if (isFirefox === false) {
    return;
  }

  Get.prototype._fetch = function(url, props = {}) {
    const req = new XMLHttpRequest();
    const buffers = [];

    req.open('GET', url);
    req.responseType = 'moz-chunked-arraybuffer';
    req.overrideMimeType('text/plain; charset=x-user-defined');

    Object.keys(props.headers || {}).forEach(k => req.setRequestHeader(k, props.headers[k]));

    return new Promise((resolve, reject) => {
      let postResolve = null;
      const push = obj => {
        if (postResolve) {
          postResolve(obj);
          postResolve = null;
        }
        else {
          buffers.push(obj);
        }
      };

      let once = () => {
        resolve({
          ok: req.status >= 200 && req.status < 300,
          get status() {
            return req.status;
          },
          body: {
            getReader: () => ({
              read: () => new Promise(resolve => {
                if (buffers.length) {
                  resolve(buffers.shift());
                }
                else {
                  postResolve = resolve;
                }
              }),
              cancel: () => req.abort()
            })
          }
        });
        once = () => {};
      };

      req.onprogress = () => {
        if (req.response.byteLength) {
          push({
            value: req.response,
            done: false
          });
        }
        once();
      };
      req.onload = () => {
        push({
          value: new ArrayBuffer(0),
          done: true
        });
        once();
      };
      req.ontimeout = () => reject(Error('XMLHttpRequest timeout'));
      req.onerror = () => reject(Error('XMLHttpRequest internal error'));

      req.send();
    });
  };
})(/Firefox/.test(navigator.userAgent));
/* globals File, Get */
'use strict';

var Wget = function({
  filename, url, timeout = 30000, chunkSize = 10 * 1024 * 1024, file, range, headers = {}
}, observer = () => {}) {
  this.filename = filename;
  this.url = url;
  this.timeout = timeout;
  this.chunkSize = chunkSize; // chuck size to trigger a write request
  this.observer = observer;
  this.file = file;
  this.headers = headers;
  this.range = range; // this can be filled on response to observer('headers', {})
};
Wget.prototype.inspect = function() {
  const {url, timeout} = this;
  return new Promise((resolve, reject) => {
    const req = new XMLHttpRequest();
    req.open('HEAD', url);
    req.timeout = timeout;
    req.onload = () => resolve({
      'Content-Length': req.getResponseHeader('Content-Length'),
      'Content-Encoding': req.getResponseHeader('Content-Encoding'),
      'Length-Computable': req.getResponseHeader('Length-Computable'),
      'Content-Type': req.getResponseHeader('Content-Type'),
      'Content-Disposition': req.getResponseHeader('Content-Disposition'),
      'Accept-Ranges': req.getResponseHeader('Accept-Ranges'),
      'Response-URL': req.responseURL
    });
    req.ontimeout = () => reject(Error('fatal: XMLHttpRequest timeout'));
    req.onerror = () => reject(Error('fatal: XMLHttpRequest internal error'));
    req.send();
  });
};
Wget.prototype.guess = function(headers) {
  const disposition = headers['Content-Disposition'];
  let name = '';
  // get name from Content-Disposition
  if (!name && disposition) {
    const tmp = /filename\*=UTF-8''([^;]*)/.exec(disposition);
    if (tmp && tmp.length) {
      name = tmp[1].replace(/["']$/, '').replace(/^["']/, '');
      name = decodeURIComponent(name);
    }
  }
  if (!name && disposition) {
    const tmp = /filename=([^;]*)/.exec(disposition);
    if (tmp && tmp.length) {
      name = tmp[1].replace(/["']$/, '').replace(/^["']/, '');
    }
  }
  // get name from URL
  if (!name) {
    const url = this.url.replace(/\/$/, '');
    const tmp = /(title|filename)=([^&]+)/.exec(url);
    if (tmp && tmp.length) {
      name = tmp[2];
    }
    else {
      name = url.substring(url.lastIndexOf('/') + 1);
    }
    name = decodeURIComponent(name.split('?')[0].split('&')[0]) || 'unknown-name';
    return name;
  }
  // extracting extension from file name
  const se = /\.\w{2,}$/.exec(name);
  if (se && se.length) {
    name = name.replace(se[0], '');
  }
  // removing exceptions
  name = name.replace(/[\\/:*?"<>|"]/g, '-');
  // removing trimming white spaces
  name = name.trim();
  // append extension
  if (se && se.length) {
    return name + se[0];
  }
  return name;
};
Wget.prototype.download = async function() {
  const {url, timeout, observer} = this;
  let {headers, range, file} = this;
  let resolve;
  const next = file => {
    this.get = new Get({file});
    let buffers = [];
    const write = async(mandatory = false) => {
      if (write.busy) {
        return;
      }
      if (buffers.length === 0) {
        if (this.get.done) {
          observer('done');
          resolve();
        }
        return;
      }
      // do not write until enough bytes are fetched
      if (
        mandatory === false && this.get.done === false &&
        buffers.reduce((p, c) => p + c.byteLength, 0) < this.chunkSize
      ) {
        return;
      }

      write.busy = true;

      const blob = new Blob(buffers, {type: 'application/octet-stream'});
      buffers = [];
      await file.write({
        blob,
        offset: write.offset
      });
      observer('disk', blob.size);
      write.offset += blob.size;
      write.busy = false;
      return write();
    };
    write.offset = range ? range.start : 0;
    // set range
    if (range) {
      const {start, end} = range;
      Object.assign(this.headers, {
        Range: `bytes=${start}-${end}`
      });
    }
    // start to download
    return new Promise((r, reject) => {
      resolve = r;
      this.get.fetch(headers['Response-UR'] || url, {
        timeout,
        headers: this.headers
      }, ({buffer}) => {
        buffers.push(buffer);
        observer('network', buffer.byteLength);
        write().catch(reject);
      }).then(() => write(true)).catch(reject);
    });
  };
  if (file) { // this is an imported download
    return next(file);
  }
  else { // this is a new download
    headers = await this.inspect();

    const size = Number(headers['Content-Length']);
    observer('filesize', size);
    if (!size) {
      return Promise.reject(Error('fatal: server does not report size'));
    }
    if (headers['Accept-Ranges'] !== 'bytes') {
      return Promise.reject(Error('fatal: "Accept-Ranges" header is ' + headers['Accept-Ranges']));
    }
    if (headers['Length-Computable'] === 'false') {
      return Promise.reject(Error('fatal: "Length-Computable" header is ' + headers['Length-Computable']));
    }
    // allow to modify headers like "Range" before actually starting to download
    range = range || observer('headers', headers);
    // should I create the file
    file = file || new File();
    this.observer('filename', this.filename || this.guess(headers));
    // open the file and truncate it
    await file.open({
      size,
      truncate: true
    });
    this.observer('file', file);

    return next(file);
  }
};
Wget.prototype.abort = function() {
  if (this.get) {
    this.get.abort();
  }
};
/* globals Wget */
'use strict';

function mwget({
  threads = 2, filename, url, timeout = 30000, headers = {}, id = 0,
  sections = [], fileSize = 0, file, /* debug */ debug = false // to resume
}, props = {
  'segment-min': 50 * 1024,
  'segment-max': 1024 * 1024 * 1024,
  'retry-max': 30,
  'speed-cache': 10
}) {
  let stats = [];
  const info = { // Chrome like download object
    id,
    startTime: (new Date()).toISOString(),
    url,
    finalUrl: url, // will be replaced when resolved
    get filename() {
      return filename || 'unknown';
    },
    mime: 'NA',
    endTime: '',
    get estimatedEndTime() {
      if (info.endTime) {
        return info.endTime;
      }
      const len = stats.length;
      if (len < 2 || fileSize === 0) {
        return 'NA';
      }
      else {
        const dt = stats[len - 1].time - stats[0].time;
        const fetched = stats.map(o => o.value).reduce((p, c) => p += c, 0);

        const rm = (fileSize - info.bytesReceived) / fetched * dt;
        return (new Date(Date.now() + rm)).toISOString();
      }
    },
    state: 'in_progress', // "in_progress", "interrupted", or "complete"
    paused: false,
    get canResume() {
      return info.state === 'in_progress' && info.paused === true;
    },
    get bytesReceived() {
      return sections.map(s => s.fetched).reduce((p, c) => p + c, 0);
    },
    get totalBytes() {
      return fileSize;
    },
    get fileSize() {
      return fileSize;
    },
    get file() {
      return file;
    },
    exists: true,
    sections
  };

  let report = () => {};
  const map = new WeakMap();
  const split = () => {
    let len = Math.floor(fileSize / threads);
    len = Math.max(len, props['segment-min']);
    len = Math.min(len, props['segment-max']);
    len = Math.min(fileSize, len);

    threads = Math.floor(fileSize / len);
    const arr = Array.from(new Array(threads), (x, i) => i);
    arr.map((a, i, l) => sections.push({
      start: a * len,
      end: l.length === i + 1 ? fileSize - 1 : (a + 1) * len - 1,
      wrote: 0,
      fetched: 0
    }));

    sections.forEach(s => s.size = s.end - s.start + 1);
  };
  let first;
  let setup = Boolean(fileSize && sections.length); // do not setup if it is a resume
  let count = 0; // number of retries
  let policy;

  const finalize = (state, error) => {
    try {
      file.remove();
    }
    catch (e) {
      error = error || e;
    }
    if (error) {
      info.error = error;
    }
    info.state = state;
    info.endTime = (new Date()).toISOString();
    report('state', info.state);
  };

  const hold = () => {
    info.paused = true;
    sections.filter(s => s.wrote !== s.size).forEach(s => {
      const wget = map.get(s);
      if (wget) {
        wget.abort();
        map.delete(s);
      }
    });
  };
  const pause = () => {
    hold();
    report('paused');
  };
  const cancel = () => {
    hold();
    finalize('interrupted', 'download is canceled by user');
  };

  const resume = () => {
    info.paused = false;
    count = 0;
    sections.filter(s => s.size !== s.wrote)
      .forEach((s, i) => policy('resume', i, true));
    info.error = '';
    report('resumed');
  };
  const validate = i => {
    const {fetched, size} = sections[i];
    if (fetched !== size) {
      throw Error('fatal: segment size mismatched');
    }
  };
  const observer = (index, key, value) => {
    // console.log(index, key, value);
    if (setup === false && index === 0) {
      if (key === 'headers') {
        info.finalUrl = value['Response-URL'];
        info.mime = value['Content-Type'];
        split();
        map.set(sections[0], first);
        return sections[0]; // set the new range to wget.js
      }
      else if (key === 'filename') {
        filename = value;
        report('filename', value);
      }
      else if (key === 'filesize') {
        fileSize = value;
        report('filesize', value);
      }
      // when file is created, we can start all threads
      else if (key === 'file') {
        file = value;
        report('file', value);
        sections.slice(1).forEach((range, i) => {
          const wget = new Wget(
            {filename, url, timeout, headers, range, file},
            (key, value) => observer(i + 1, key, value)
          );
          map.set(sections[i + 1], wget);
          if (info.paused === false) {
            wget.download().then(() => validate(i + 1)).catch(e => policy(e, i + 1));
          }
        });
        setup = true;
      }
    }
    else if (key === 'disk') {
      sections[index].wrote += value;
      const {wrote, size} = sections[index];
      if (wrote === size) {
        if (info.paused === false && sections.filter(s => s.wrote === s.size).length === sections.length) {
          file.download(filename, d => {
            info.id = d.id;
            filename = d.filename;
            Object.defineProperty(info, 'exists', {
              get() {
                return d.exists;
              }
            });
            report('native', info);
          }).then(() => finalize('complete'));
        }
      }
    }
    else if (key === 'network') {
      sections[index].fetched += value;
      stats.push({
        value: value,
        time: Date.now()
      });
      stats = stats.slice(-1 * props['speed-cache']);
    }
  };
  policy = (e, index, silent = false) => {
    if (info.paused) {
      return;
    }
    if (debug) {
      console.log(e, index, count);
    }
    if (silent !== true) {
      count += 1;
    }

    if (count > props['retry-max']) {
      pause();
    }
    else if (e.message && (e.message.startsWith('fatal:') || e instanceof DOMException)) {
      pause();
      finalize('interrupted', e.message);
    }
    else {
      const wget = new Wget({filename, url, timeout, headers, range: {
        start: sections[index].start + sections[index].wrote,
        end: sections[index].end
      }, file}, (key, value) => observer(index, key, value));
      map.set(sections[index], wget);
      if (info.paused === false) {
        wget.download().catch(e => policy(e, index, wget));
      }
      report('retrying', index);
    }
  };
  // this is a new download
  if (sections.length === 0) {
    first = new Wget({filename, url, timeout, headers}, (key, value) => observer(0, key, value));
    first.download().then(() => validate(0)).catch(e => policy(e, 0));
  }
  // this is a resumed download
  else {
    resume();
  }

  return {
    cancel,
    resume,
    pause,
    object: () => ({ // useful to store for resume
      sections,
      file,
      fileSize,
      filename,
      map
    }),
    info,
    report: c => report = c
  };
}
/* globals mwget */
'use strict';

var downloads = {
  cache: {},
  index: 0,
  listeners: {
    onCreated: [],
    onChanged: []
  }
};

downloads.native = options => {
  // console.log('using native method', options);
  const opts = {
    url: options.url
  };
  if (options.filename) {
    opts.filename = options.filename;
  }
  chrome.downloads.download(opts);
};

downloads.download = (options, callback = () => {}, props) => {
  if (options.threads === 1 && options.allowSingleThread !== true) {
    return downloads.native(options);
  }
  options.id = downloads.index;
  const d = downloads.cache[downloads.index] = mwget(options, props);
  d.useNative = 'useNative' in options ? options.useNative : true; // user native method when there is a fatal error

  const post = obj => {
    Object.assign(obj, {
      id: options.id
    });
    downloads.listeners.onChanged.forEach(c => c(obj));
  };
  d.report((key, value) => {
    // console.log(key, value);
    if (key === 'paused' || key === 'resumed') {
      post({
        paused: {
          current: key === 'paused'
        },
        canResume: {
          current: key === 'paused'
        }
      });
    }
    else if (key === 'filename') {
      post({
        filename: {
          current: value
        }
      });
    }
    else if (key === 'filesize') {
      post({
        fileSize: {
          current: value
        },
        totalBytes: {
          current: value
        }
      });
    }
    else if (key === 'state') {
      post({
        state: {
          current: value
        }
      });
      if (value === 'interrupted' && d.useNative) { // ask Chrome to download when there is an error
        if (options.debug) {
          console.log('Download failed', 'Using the native download manager');
        }
        downloads.native(options);
      }
      if (value === 'interrupted') {
        delete downloads.cache[options.id];
      }
    }
    else if (key === 'native') {
      delete downloads.cache[options.id];
      post({
        native: value
      });
    }
  });
  callback(downloads.index);
  downloads.listeners.onCreated.forEach(c => c(d.info));

  downloads.index += 1;
};
{ // clear storage before starting a new job
  const download = downloads.download;
  downloads.download = async function(...args) {
    try {
      const list = await (new File()).list();
      const used = Object.values(downloads.cache)
        .filter(({info}) => info.file) // file might not yet be created
        .map(({info}) => info.file.fileEntry.name);
      const unused = list.filter(fileEntry => used.indexOf(fileEntry.name) === -1);
      const remove = fileEntry => new Promise(resolve => fileEntry.remove(resolve));

      await Promise.all(unused.map(remove));
    }
    catch (e) {
      console.log(e);
    }

    download.apply(this, args);
  };
}
downloads.search = (query = {}, callback = () => {}) => {
  let items = Object.values(downloads.cache).map(m => m.info);
  if (query.query) {
    items = items.filter(({filename, url, finalUrl}) => {
      return query.query.some(s => url.indexOf(s) !== -1 || finalUrl.indexOf(s) !== -1 || filename.indexOf(s) !== -1);
    });
  }
  if ('paused' in query) {
    items = items.filter(({paused}) => query.paused === paused);
  }
  callback(items);
};
downloads.pause = (id, callback = () => {}) => {
  downloads.cache[id].pause();
  callback();
};
downloads.resume = (id, callback = () => {}) => {
  downloads.cache[id].resume();
  callback();
};
downloads.cancel = (id, callback = () => {}) => {
  downloads.cache[id].useNative = false;
  downloads.cache[id].cancel();
  callback();
};
downloads.onCreated = {
  addListener: c => {
    downloads.listeners.onCreated.push(c);
  }
};
downloads.onChanged = {
  addListener: c => downloads.listeners.onChanged.push(c)
};
