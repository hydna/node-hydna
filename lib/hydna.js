//
//        Copyright 2010 Hydna AB. All rights reserved.
//
//  Redistribution and use in source and binary forms, with or without
//  modification, are permitted provided that the following conditions
//  are met:
//
//    1. Redistributions of source code must retain the above copyright
//       notice, this list of conditions and the following disclaimer.
//
//    2. Redistributions in binary form must reproduce the above copyright
//       notice, this list of conditions and the following disclaimer in the
//       documentation and/or other materials provided with the distribution.
//
//  THIS SOFTWARE IS PROVIDED BY HYDNA AB ``AS IS'' AND ANY EXPRESS OR IMPLIED
//  WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
//  MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO
//  EVENT SHALL HYDNA AB OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT,
//  INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT
//  NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF
//  USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
//  ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR
//  TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE
//  USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
//
//  The views and conclusions contained in the software and documentation are
//  those of the authors and should not be interpreted as representing
//  official policies, either expressed or implied, of Hydna AB.
//

var Buffer                = require("buffer").Buffer;
var EventEmitter          = require("events").EventEmitter;
var inherits              = require("util").inherits;
var parseUrl              = require("url").parse;

var VERSION               = exports.VERSION   = "1.0rc";

// Handshake related constants
var HANDSHAKE_HEADER      = "\x44\x4E\x41\x31";
var HANDSHAKE_SIZE        = HANDSHAKE_HEADER.length + 1;
var HANDSHAKE_CODE_OFF    = 0x04;

// Stream modes
var READ                  = 0x01;
var WRITE                 = 0x02;
var READWRITE             = 0x03;
var EMIT                  = 0x04;

// Packet related sizes
var MAX_PAYLOAD_SIZE      = 10240;

var SUCCESS               = 0;

var DEFAULT_PORT          = 7010;

// Handshake flags
var HANDSHAKE_UNKNOWN     = 0x01;
var HANDSHAKE_SERVER_BUSY = 0x02;
var HANDSHAKE_BADFORMAT   = 0x03;
var HANDSHAKE_HOSTNAME    = 0x04;
var HANDSHAKE_PROTOCOL    = 0x05;
var HANDSHAKE_SERVERERROR = 0x06;

// Error classes
var ERR_HANDSHAKE         = 0;
var ERR_OPEN              = 10;
var ERR_SIG               = 20;

var ALL_CHANNELS          = 0;

var VALID_ENCODINGS_RE    = /^(ascii|utf8|base64|json)/i;
var MODE_RE = /^(r|read){0,1}(w|write){0,1}(?:\+){0,1}(e|emit){0,1}$/i;
var ADDR_EXPR_RE = /^(?:([0-9a-f]{1,8})-|([0-9a-f]{1,8})-([0-9a-f]{1,8}))$/i;
var URI_RE = /(?:hydna:){0,1}([\w\-\.]+)(?::(\d+)){0,1}(?:\/(\d+|x[a-fA-F0-9]+){0,1}){0,1}(?:\?(.+)){0,1}/;



/**
 *  ## hydna.createConnection(channel, mode, [token])
 *
 *  Construct a new stream object and opens a stream to the
 *  specified `'channel'`.
 *
 *  When the stream is established the `'connect'` event will be emitted.
 */
exports.createConnection = function(channel, mode, token) {
  var stream = new Stream();
  stream.connect(channel, mode, token);
  return stream;
}

exports.followRedirects = true;

/**
 *  ## hydna.Stream
 *
 *  This object is an abstraction of of a TCP or UNIX socket. hydna.Stream
 *  instance implement a duplex stream interface. They can be created by
 *  the user and used as a client (with connect()) or they can be created
 *  by Node and passed to the user through the 'connection' event
 *  of a server.
 *
 *  hydna.Stream instances are EventEmitters with the following events:
 *
 *  Event: `'connect'`
 *  `function () { }`
 *
 *  Emitted when a stream connection successfully is established. See connect().
 *
 *  Event: `'data'`
 *  `function (data) { }`
 *
 *  Emitted when data is received. The argument data will be a Buffer or String.
 *  Encoding of data is set by stream.setEncoding().
 *
 *  Event: `'drain'`
 *  `function () { }`
 *
 *  Emitted when the write buffer becomes empty. Can be used to
 *  throttle uploads.
 *
 *  Event: `'error'`
 *  `function (exception) { }`
 *
 *  Emitted when an error occurs. The `'close'` event will be called directly
 *  following this event.
 *
 *  Event: `'close'`
 *  `function (had_error) { }`
 *
 *  Emitted once the stream is fully closed. The argument had_error is a
 *  boolean which says if the stream was closed due to an error.
 *
 *  Event: `'signal'`
 *  `function (data) { }`
 *
 *  Emitted when remote server send's a signal.
 */
function Stream() {
  this.id = null;

  this._connecting = false;
  this._opening = false;
  this._closing = false;
  this._connection = null;
  this._request = null;
  this._mode = null;
  this._writeQueue = null;
  this._encoding = null;
  this._mode = null;

  this.readable = false;
  this.writable = false;
  this.emitable = false;
}

exports.Stream = Stream;
inherits(Stream, EventEmitter);

/**
 *  ### Stream.readyState
 *
 *  Either `'closed'`, `'closing'`, `'open'`, `'opening'`,
 *  `'read'`, `'write'`, `'readwrite'` and/or `'+emit'`.
 */
Object.defineProperty(Stream.prototype, 'readyState', {
  get: function () {
    var state;

    if (this._connecting) {
      return "opening";
    } else if (this._closing) {
      return "closing";
    } else if (!this.id) {
      return 'closed';
    } else if (this.readable && this.writable) {
      state = "readwrite";
    } else if (this.readable && !this.writable){
      state = "read";
    } else if (!this.readable && this.writable){
      state = "write";
    }
    if (this.emitable) {
      state += "+emit";
    }

    return state;
  }
});

/**
 *  ### Stream.channel
 *
 *  Returns stream `channel` as a number. Property is `null` if not connected.
 */
Object.defineProperty(Stream.prototype, 'channel', {
  get: function () {
    return this.id && this.id || null;
  }
});

/**
 *  ### Stream.uri
 *
 *  Returns stream `uri` as a string. Property is `null` if not connected.
 */
Object.defineProperty(Stream.prototype, 'uri', {
  get: function () {
    if (!this.id || !this._connection) {
      return null;
    }

    if (!this._uri) {
      this._uri = this._connection.id + "/" + this.id;
      this._uri += this._token.length ? "?" + this._token : "";
    }

    return this._uri;
  }
});

/**
 *  ### Stream.connect(channel, mode='readwrite', [token])
 *
 *  Opens a stream to the specified ´'channel'´.
 *
 *  This function is asynchronous. When the `'connect'` event is emitted
 *  the stream is established. If there is a problem connecting, the
 *  `'connect'` event will not be emitted, the 'error' event will be
 *  emitted with the exception.
 *
 *  Available modes:
 *  * read (r) - Open stream in read mode
 *  * write (w) - Open stream in write mode
 *  * readwrite (rw) - Open stream in read-write mode.
 *  * +emit - Open stream with send-signal support (e.g. "rw+emit").
 *
 *  Example:
 *
 *      var createConncetion = require("hydna").createConncetion;
 *      var stream = createConncetion("demo.hydna.net", "read");
 *      stream.write("Hello World!");
 */
Stream.prototype.connect = function(channel, mode, token) {
  var self = this;
  var packet;
  var tokenb;
  var messagesize;
  var request;
  var uri;
  var id;
  var host;
  var mode;

  if (this._connecting) {
    throw new Error("Already connecting");
  }

  uri = parseURI(channel);
  host = uri.host;
  port = uri.port || DEFAULT_PORT;
  id = parseInt(uri.id) || 1;
  mode = getBinMode(mode);

  if (!host) {
    throw new Error("Missing hostname");
  }

  if (id > 0xFFFFFFFF) {
    throw new Error("Invalid channel expected no between x0 and xFFFFFFFF");
  }

  if (typeof mode !== "number") {
    throw new Error("Invalid mode");
  }

  if (token) {
    if (Buffer.isBuffer(token)) {
      tokenb = token;
    } else {
      tokenb = new Buffer(token, "utf8");
    }
  } else if (uri.token){
    tokenb = new Buffer(decodeURIComponent(uri.token), "utf8");
  }

  this.id = id;
  this._mode = mode;
  this._connecting = true;
  this._token = tokenb ? encodeURIComponent(tokenb.toString("utf8")) : "";

  this.readable = ((this._mode & READ) == READ);
  this.writable = ((this._mode & WRITE) == WRITE);
  this.emitable = ((this._mode & EMIT) == EMIT);

  this._connection = Connection.getConnection(port, host, false);
  this._request = this._connection.open(this, id, mode, tokenb);
}


/**
 *  ### Stream.setEncoding(encoding=null)
 *
 *  Sets the encoding (either `'ascii'`, `'utf8'`, `'base64'`, `'json'`)
 */
Stream.prototype.setEncoding = function(encoding) {
  if (encoding && !VALID_ENCODINGS_RE.test(encoding)) {
    throw new Error("Encoding method not supported");
  }
  this._encoding = encoding;
}

/**
 *  ### Stream.write(data, encoding='ascii', priority=1)
 *
 *  Sends data on the stream. The second paramter specifies the encoding in
 *  the case of a string--it defaults to ASCII because encoding to UTF8 is
 *  rather slow.
 *
 *  Returns ´true´ if the entire data was flushed successfully to the
 *  underlying connection. Returns `false` if all or part of the data was
 *  queued in user memory. ´'drain'´ will be emitted when the buffer is
 *  again free.
 */
Stream.prototype.write = function(data) {
  var encoding = (typeof arguments[1] == "string" && arguments[1]);
  var flag = (encoding && arguments[2]) || arguments[2] || 1;
  var id = this.id;
  var packet;
  var payload;

  if (!this.writable) {
    throw new Error("Stream is not writable");
  }

  if (!data) {
    throw new Error("Expected `data`");
  }

  if (Buffer.isBuffer(data)) {
    payload = data;
  } else {
    if (encoding && !VALID_ENCODINGS_RE.test(encoding)) {
      throw new Error("Encoding method is not supported");
    }
    if (encoding == "json") {
      payload = new Buffer(JSON.stringify(data), "utf8");
    } else {
      payload = new Buffer(data.toString(), encoding);
    }
  }

  if (payload.length > MAX_PAYLOAD_SIZE) {
    throw new Error("Cannot send data, max length reach.");
  }

  packet = new DataPacket(this.id, flag, payload);

  try {
    flushed = this._writeOut(packet);
  } catch (writeException) {
    this.destroy(writeException);
    return false;
  }

  return flushed;
}


/**
 *  ### Stream.dispatch(data, encoding='utf8')
 *
 *  Dispatch a signal on the stream. The second paramter specifies the encoding
 *  in the case of a string--it defaults to UTF8 encoding.
 *
 *  Returns ´true´ if the signal was flushed successfully to the
 *  underlying connection. Returns `false` if the all or part of the signal
 *  was queued in user memory. ´'drain'´ will be emitted when the buffer is
 *  again free.
 */
Stream.prototype.dispatch = function(data, encoding) {
  var packet;
  var payload;
  var flushed;

  if (!this.emitable) {
    throw new Error("Stream is not emitable.");
  }

  if (!data) {
    throw new Error("Expected `data`");
  }

  if (Buffer.isBuffer(data)) {
    payload = data;
  } else {
    if (encoding && !VALID_ENCODINGS_RE.test(encoding)) {
      throw new Error("Encoding method is not supported");
    }
    if (encoding == "json") {
      payload = new Buffer(JSON.stringify(data), "utf8");
    } else {
      payload = new Buffer(data.toString(), encoding);
    }
  }

  if (payload.length > MAX_PAYLOAD_SIZE) {
    throw new Error("Cannot send data, max length reach.");
  }

  packet = new SignalPacket(this.id, SignalPacket.FLAG_EMIT, payload);

  try {
    flushed = this._writeOut(packet);
  } catch (writeException) {
    this.destroy(writeException);
    return false;
  }

  return flushed;
};


/**
 *  ### Stream.end([message])
 *
 *  Closes stream for reading, writing and emiting. The optional `message` is
 *  sent to the endpoint.
 */
Stream.prototype.end = function(message) {
  var packet;
  var payload;

  if (this.destroyed || this._closing) {
    return;
  }

  payload = message ? new Buffer(message, "utf8") : null;
  this._endsig = new SignalPacket(this.id, SignalPacket.FLAG_END, payload);

  this.destroy();
};


Stream.prototype.destroy = function(err) {
  var sig;

  if (this.destroyed || this._closing || !this.id) {
    return;
  }

  if (!this._connection) {
    finalizeDestroyChannel(this);
  }

  this.readable = false;
  this.writable = false;
  this.emitable = false;
  this._closing = true;

  if (this._request && !this._endsig &&
      this._request.cancel()) {
    this._request = null;
    finalizeDestroyChannel(this, err);
    return;
  }

  sig = this._endsig || new SignalPacket(this.id, SignalPacket.FLAG_END);

  if (this._request) {
    // Do not send ENDSIG if _request is present. We need to wait for
    // the OPENSIG before we can close it.

    this._endsig = sig;
  } else {
    // Stream is open and we can therefor send ENDSIG immideitnly. This
    // can fail, if TCP connection is dead. If so, we can
    // destroy stream with good conscience.

    try {
      this._writeOut(sig);
    } catch (err) {
      // ignore
    }
  }
};


function finalizeDestroyChannel(chan, err, message) {
  var id = chan.id;
  var conn;

  if (chan.destroyed) {
    return;
  }

  if ((conn = chan._connection) && chan.id) {
    if (conn.channels[id] == this) {
      delete conn.channels[id] = this;
      conn.chanRefCount--;
      if (conn.chanRefCount == 0 &&
          conn.reqRefCount == 0) {
        conn.setDisposed(true);
      }
    }
  }

  chan.id = null;
  chan.readable = false;
  chan.writable = false;
  chan.emitable = false;
  chan.destroyed = true;
  chan._request = null;
  chan._writequeue = null;
  chan._connection = null;

  err && chan.emit("error", err);

  chan.emit("close", !(!err), message);
};


Stream.prototype.ondata = function(data, start, end) {
  var encoding = this._encoding;
  var message = data.slice(start, end);

  if (encoding) {
    if (encoding == "json") {
      try {
        message = JSON.parse(message.toString("utf8"));
      } catch (exception) {
        this.destroy(exception);
        return;
      }
    } else {
      message = message.toString(encoding);
    }
  }

  if (this._events && this._events["data"]) {
    this.emit("data", message);
  }
};


Stream.prototype.onsignal = function(data, start, end) {
  var message = null;

  if (end - start) {
    message = data.toString("utf8", start, end);
  }

  if (this._events && this._events["signal"]) {
    this.emit("signal", message);
  }
};


// Internal write method to write raw packets.
Stream.prototype._writeOut = function(packet) {
  var written;

  if (this._writeQueue) {
    this._writeQueue.push(packet);
    return false;
  }

  if (this._connecting) {
    this._writeQueue = [packet];
    return false;
  } else if (this._connection) {
    return this._connection.write(packet);
  } else {
    this.destroy(new Error("Stream is not writable"));
    return false;
  }
};


Stream.prototype._open = function(newid) {
  var flushed = false;
  var queue = this._writeQueue;
  var id = this.id;
  var packet;

  this.id = newid;
  this._connecting = false;
  this._writeQueue = null;
  this._request = null;

  this._connection.channels[this.id] = this;
  this._connection.chanRefCount++;

  if (queue && queue.length) {
    for (var i = 0, l = queue.length; i < l; i++) {
      packet = queue[i];
      packet.id = newid;
      try {
        flushed = this._writeOut(packet);
      } catch(writeException) {
        this.destroy(writeException);
        return;
      }
    }
  }

  if (this._closing) {
    if ((packet = self._endsig)) {
      self._endsig = null;
      packet.id = newid;
      try {
        this._writeOut(packet);
      } catch (err) {
        // Ignore
      }
      return;
    }
  }

  stream.emit("connect");

  if (flushed) {
    stream.emit("drain");
  }
};



// Represents a server connection.
function Connection(id) {
  this.id = id;
  this.chanRefCount = 0;
  this.reqRefCount = 0;
  this.channels = {};
  this.requests = {};
  this._streamRefCount = 0;
  this._connecting = false;
  this._handshaked = false;
  this.sock = null;

  Connection.all[id] = this;
}


Connection.all = {};
Connection.disposed = {};


Connection.getConnection = function(port, host, secure) {
  var id;
  var connection;
  var datacache = "";
  var lastException;

  if (host.length > 256) {
    throw new Error("Hostname exceeded size limit");
  }

  if (secure) {
    id = "hydnas:" + host + (port && ":" + port || "");
  } else {
    id = "hydna:" + host + (port && ":" + port || "");
  }

  if ((connection = Connection.all[id])) {
    return connection;
  }

  if ((connection = Connection.disposed[id])) {
    conncetion.setDisposed(false);
    return connection;
  }

  connection = new Connection(id);

  // // Sends a handshake packet to remote host.
  // connection.on("connect", function() {
  //   var packet = new Buffer(HANDSHAKE_HEADER.length + host.length + 1);
  //   packet.write(HANDSHAKE_HEADER, "ascii");
  //   packet[HANDSHAKE_CODE_OFF] = host.length;
  //   packet.write(host, HANDSHAKE_CODE_OFF + 1, "ascii");
  //   this.write(packet);
  // });
  // 
  // // Waits for a handshake response.
  // connection.ondata = function(data, start, end) {
  //   var pending = this._pendingOpenRequests;
  //   var keys;
  // 
  //   datacache += data.toString("binary", start, end);
  // 
  //   if (datacache.length < HANDSHAKE_HEADER.length + 1) {
  //     return;
  //   } else if (datacache.length > HANDSHAKE_SIZE) {
  //     this.destroy(new Error("Bad handshake response packet."));
  //   } else {
  //     var code = datacache.charCodeAt(HANDSHAKE_CODE_OFF);
  //     if (code != SUCCESS) {
  //         this.destroy(new StreamError(ERR_HANDSHAKE, code));
  //     } else {
  //       this._handshaked = true;
  //       this._connecting = false;
  //       parserImplementation(this);
  // 
  //       try {
  //         for (var key in pending) {
  //           this.write(pending[key].data);
  //           pending[key].sent = true;
  //         }
  //       } catch (writeException) {
  //         this.destroy(writeException);
  //         return;
  //       }
  //     }
  //   }
  // }
  // 

  connection.connect(port, host, secure);

  return connection;
}


Connection.prototype.connect = function(port, host, secure) {
  var self = this;

  getSock(port, host, secure, function(err, sock) {
    var pending = self.pending;

    if (err) {
      return self.destroy(err);
    } 

    sock.setNoDelay(true);
    sock.setKeepAlive(true);

    sock.on("drain", function() {
      var channels = self.channels;
      var chan;

      for (var id in channels) {
        chan = channels[id];
        if (chan._events && chan._events["drain"]) {
          chan.emit("drain");
        }
      }
    });

    sock.on("error", function(err) {
      self.sock = null;
      self.destroy(err);
    });

    sock.on("close", function(hadError) {
      if (hadError == false) {
        self.sock = null;
        self.destroy(new Error("Connection reseted by server"));
      }
    });

    self.sock = sock;

    try {
      for (var id in pending) {
        self.write(pending[id]);
        pending[id].sent = true;
      }
    } catch (writeException) {
      self.destroy(writeException);
    }
  });
};


function getSock(port, host, secure, C) {
  var STATUS_CODES = require("http").STATUS_CODES;

  function dorequest(port, host, secure) {
    var request = require(secure ? "https" : "http").request;
    var opts;
    var req;
    
    opts = {
      port: port,
      host: host,
      headers: {
        "Connection": "Upgrade",
        "Upgrade": "winksocket"
      }    
    }

    req = request(opts, function(res) {
      var code = res.statusCode;
      
      if (code == 302) {
        if (exports.followRedirects) {
          dorequest()
        } else {
          return C(new Error("Redirected by host, followRedirects=false"));
        }
      }
      return C(new Error(STATUS_CODES[code]));
    });

    req.on("error", function(err) {
      return C(err);
    });

    req.on("upgrade", function(res, sock) {
      return C(null, sock);
    });

    req.end();
  }

  dorequest(port, host, secure);
}


Connection.prototype.open = function(chan, id, mode, token) {
  var self = this;
  var channels = this.channels;
  var request;

  if (channels[id]) {
    process.nextTick(function() {
      chan.destroy(new Error("Channel is already open"));
    });
    return null;
  }

  request = new OpenRequest(this, id, mode, token);

  request.onresponse = function(newid) {
    chan._open(newid);
  };

  request.onclose = function(err) {
    if (err) { finalizeDestroyChannel(chan, err); }
  };

  if (this.sock) {
    process.nextTick(function() {
      request.send();
    });
  }

  return request;
};


Connection.prototype.setDisposed = function(state) {
  var id = this.id;
  var sock = this.sock;
  var self = this;

  if (!this.id) return;

  if (state) {

    if (sock) {
      sock.setTimeout(200);
      sock.once("timeout", function() {
        self.destroy();
      });
    }

    Connection.disposed[id] = connection;
    Connection.all[id] = undefined;

  } else {

    delete Connection.disposed[id];
    Connection.all[id] = connection;

    if (sock) {
      sock.setTimeout(0);
      sock.removeAllListeners("timeout");
    }
  }
};


// Write a `Packet` to the underlying socket.
Connection.prototype.write = function(packet) {
  if (this.sock) {
    this.sock.write(packet.toBuffer());
  }
};


Connection.prototype.processOpen = function(id, flag, data, start, end) {
  var request;

  if (!(request = this.requests[id])) {
    sock.destroy(new Error("Server sent an open response to unknown"));
    return;
  }

  request.processResponse(flag, data, start, end);
};


Connection.prototype.processData = function(id, flag, data, start, end) {
  var channels = this.channels;
  var chan;

  if (id === ALL_CHANNELS) {
    for (var chanid in channels) {
      chan = channels[chanid];
      if (chan.readable) {
        chan.ondata && chan.ondata(data, start, end);
      }
    }
  } else if ((chan = channels[id])) {
    if (chan.readable) {
      chan.ondata && chan.ondata(data, start, end);
    }
  }
};


Connection.prototype.processSignal = function(id, flag, data, start, end) {
  var channels = this.channels;
  var chan;
  var message;

  switch (flag) {

    case SignalPacket.FLAG_EMIT:
      if (id === ALL_CHANNELS) {
        for (var chanid in channels) {
          chan = channels[chanid];
          if (chan.readable == false) {
            chan.onsignal && chan.onsignal(data, start, end);
          }
        }
      } else if ((chan = channels[id])) {
        if (chan.readable == false) {
          chan.onsignal && chan.onsignal(data, start, end);
        }
      }
      break;

    case SignalPacket.FLAG_END:
    case SignalPacket.FLAG_ERR_PROTOCOL:
    case SignalPacket.FLAG_ERR_OPERATION:
    case SignalPacket.FLAG_ERR_LIMIT:
    case SignalPacket.FLAG_ERR_SERVER:
    case SignalPacket.FLAG_ERR_VIOLATION:
    case SignalPacket.FLAG_ERR_OTHER:

      if (end - start) {
        message = data.toString("utf8", start, end);
      }

      if (id === ALL_CHANNELS) {
        if (flag != SignalPacket.FLAG_END) {
          this.destroy(new StreamError(ERR_SIG, flag, message));
        } else {
          this.destroy(null, message);
        }
        return;
      }

      if (!(chan = channels[id])) {
        // Protocol violation. Channel does not exists in client. Ignore
        // for now.

        return;
      }

      if (chan._closing) {
        // User requested to close this channel. This ENDSIG is a
        // response to that request. It is now safe to destroy
        // channel. Note: We are intentionally not sending the message
        // to the function, because stream is closed according
        // to client.

        finalizeDestroyChannel(chan);
      } else {
        // Server closed this channel. We need to respond with a
        // ENDSIG in order to let server now that we received this
        // signal.

        try {
          this.write(new SignalPacket(id, SignalPacket.FLAG_END));
        } catch (writeException) {
          this.destroy(writeException);
        }

        if (flag != SignalPacket.FLAG_END) {
          finalizeDestroyChannel(chan, new StreamError(ERR_SIG, flag, message));
        } else {
          finalizeDestroyChannel(chan, null, message);
        }
      }
      break;

    default:
      this.destroy(new Error("Server sent an unknown SIGFLAG"));
      return;
  }

};


// Destroy connection with optional Error
Connection.prototype.destroy = function(err, message) {
  var id = this.id;
  var channels = this.channels;
  var requests = this.requests;
  var chan;
  var request;
  var queued;

  if (!id) {
    return;
  }

  this.id = null;

  for (var chanid in channels) {
    if ((chan = channels[chanid])) {
      finalizeDestroyChannel(chan, err, message);
    }
  }

  for (var reqid in requests) {
    if ((request = requests[reqid])) {
      request.destroyAll(err);
    }
  }

  this.channels = {};
  this.requests = {};
  this.chanRefCount = 0;
  this.reqRefCount = 0;

  delete Connection.all[id];
  delete Connection.disposed[id];

  if (this.sock) {
    this.sock.destroy();
    this.sock = null;
  }
};

// OpenRequest constructor.
function OpenRequest(conn, id, flag, data) {
  var requests = conn.requests;
  var first;

  this.conn = conn;
  this.id = id;
  this.flag = flag;
  this.data = data;
  this.sent = false;
  this.destroyed = false;

  this.first = null;
  this.last = null;
  this.next = null;

  if ((first = requests[id])) {
    this.first = first;
    if (first.last) {
      first.last.next = this;
      first.last = this;
    }
  } else {
    this.first = this;
    requests[id] = this;
  }
}


// Open Flags
OpenRequest.FLAG_SUCCESS = 0x0;
OpenRequest.FLAG_REDIRECT = 0x1;
OpenRequest.FLAG_FAIL_NA = 0x8;
OpenRequest.FLAG_FAIL_MODE = 0x9;
OpenRequest.FLAG_FAIL_PROTOCOL = 0xa;
OpenRequest.FLAG_FAIL_HOST = 0xb;
OpenRequest.FLAG_FAIL_AUTH = 0xc;
OpenRequest.FLAG_FAIL_SERVICE_ERR = 0xd;
OpenRequest.FLAG_FAIL_SERVICE_NA = 0xe;
OpenRequest.FLAG_FAIL_OTHER = 0xf;


OpenRequest.prototype.send = function() {

  if (this.sent) {
    throw new Error("OpenRequest is already sent");
  }

  try {
    this.conn.write(this);
    this.sent = true;
  } catch (err) {
    this.conn.destroy(err);
  }
};


OpenRequest.prototype.cancel = function() {
  var id = this.id;
  var conn = this.conn;
  var requests = conn.requests;
  var parent = this.first;

  if (this.sent) {
    // We cannot cancel if request is already sent.
    return false;
  }

  if (parent == this) {
    if (this.next) {
      requests[id] = this.next;
      this.next.first = this.next;
      this.next.last = this.last;
    }
    return true;
  } else {
    parent = this.first;
    while ((parent = parent.next) && (parent.next != this)) {}

    if (!parent) {
      // Should not happen...
      return false;
    }

    parent.next = this.next;

    if (this.first.last == this) {
      this.first.last = parent;
    }
  }

  return true;
};


OpenRequest.prototype.destroy = function(err, message) {
  var conn;

  if (!this.destroyed) {
    if ((conn = this.conn) && conn.id) {
      conn.reqRefCount--;
      if (conn.reqRefCount == 0 &&
          conn.chanRefCount == 0) {
        conn.setDisposed(true);
      }
    }
    this.onclose && this.onclose(err, message);
    this.destroyed = true;
  }
};


// Destroy this OpenRequest and all other in chain 
OpenRequest.prototype.destroyAll = function(err) {
  if (this.next) {
    this.next.destroyNext(err);
  }
  this.destroy(err);
}


OpenRequest.prototype.processResponse = function(flag, data, start, end) {
  var conn = this.conn;
  var request;
  var err;
  var content;

  if (this.next) {
    if (flag == OpenRequest.FLAG_SUCCESS) {
      this.next.destroyAll(new Error("Channel is already open"));
    } else {
      this.next.last = this.last;
      this.next.first = this.next;
      conn.requests[this.id] = this.next;
      process.nextTick(function() {
        this.next.send();
      });
    }
  } else {
    delete conn.requests[this.id];
  }

  switch (flag) {

    case OpenRequest.FLAG_SUCCESS:
      this.onresponse(this.id);
      this.destroy();
      break;

    case OpenRequest.FLAG_REDIRECT:

      if (end - start != 4) {
        conn.destroy(new Error("Bad open resp"));
        return;
      }

      content = (data[start + 1] << 16 |
                 data[start + 2] << 8 |
                 data[start + 3]) + (data[start] << 24 >>> 0);

      this.onresponse(content);
      this.destroy();
      break;

    default:
      content = (end - start) ? data.toString("utf8", start, end) : null;
      this.destroy(new StreamError(ERR_OPEN, flag, content));
      break;
  }
};


OpenRequest.prototype.toBuffer = function() {
  var id = this.id;
  var data = this.data;
  var flah = this.flag;
  var buffer;
  var length;

  length = 8 + (data ? data.length : 0);

  buffer = new Buffer(length);
  buffer[0] = length >>> 8;
  buffer[1] = length % 256;
  buffer[3] = id >>> 24;
  buffer[4] = id >>> 16;
  buffer[5] = id >>> 8;
  buffer[6] = id % 256;
  buffer[7] = 0x1 << 4 | flag;

  if (length > 8) {
    data.copy(buffer, 8);
  }

  return buffer;
};


function DataPacket(id, flag, data) {
  this.id = id;
  this.flag = flag;
  this.data = data;
}

DataPacket.prototype.toBuffer = function() {
  var id = this.id;
  var data = this.data;
  var flah = this.flag;
  var buffer;
  var length;

  length = 8 + (data ? data.length : 0);

  buffer = new Buffer(length);
  buffer[0] = length >>> 8;
  buffer[1] = length % 256;
  buffer[3] = id >>> 24;
  buffer[4] = id >>> 16;
  buffer[5] = id >>> 8;
  buffer[6] = id % 256;
  buffer[7] = 0x2 << 4 | flag;

  if (length > 8) {
    data.copy(buffer, 8);
  }

  return buffer;
};


function SignalPacket(id, flag, data) {
  this.id = id;
  this.flag = flag;
  this.data = data;
}

// Signal flags
SignalPacket.FLAG_EMIT = 0x0;
SignalPacket.FLAG_END = 0x1;
SignalPacket.FLAG_ERR_PROTOCOL = 0xa;
SignalPacket.FLAG_ERR_OPERATION = 0xb;
SignalPacket.FLAG_ERR_LIMIT = 0xc;
SignalPacket.FLAG_ERR_SERVER = 0xd;
SignalPacket.FLAG_ERR_VIOLATION = 0xe;
SignalPacket.FLAG_ERR_OTHER = 0xf;


SignalPacket.prototype.toBuffer = function() {
  var id = this.id;
  var data = this.data;
  var flah = this.flag;
  var buffer;
  var length;

  length = 8 + (data ? data.length : 0);

  buffer = new Buffer(length);
  buffer[0] = length >>> 8;
  buffer[1] = length % 256;
  buffer[3] = id >>> 24;
  buffer[4] = id >>> 16;
  buffer[5] = id >>> 8;
  buffer[6] = id % 256;
  buffer[7] = 0x3 << 4 | flag;

  if (length > 8) {
    data.copy(buffer, 8);
  }

  return buffer;
};


function parserImplementation(sock) {
  var buffer = null;
  var offset = 0;
  var length = 0;

  sock.ondata = function(chunk, start, end) {
    var tmpbuff;
    var packet;
    var packetlen;
    var ch;
    var op;
    var flag;

    if (buffer) {
      tmpbuff = new Buffer((length - offset) + (end - start));
      buffer.copy(tmpbuff, 0, offset, length);
      chunk.copy(tmpbuff, (length - offset), start, end);
      buffer = tmpbuff;
      length = buffer.length;
      offset = 0;
    } else {
      buffer = chunk;
      offset = start;
      length = end;
    }

    while (offset < length && sock.fd) {

      if (offset + 2 > length) {
        // We have not received the length yet
        break;
      }

      packetlen = buffer[offset] << 8 | buffer[offset + 1];

      if (packetlen < 0x8) {
        // Size is lower then packet header. Destroy wire
        return sock.destroy(new Error("bad packet size"));
      }

      if (offset + packetlen > length) {
        // We have not received the whole packet yet. Wait for
        // more data.
        break;
      }

      ch = (buffer[offset + 4] << 16 |
            buffer[offset + 5] << 8 |
            buffer[offset + 6]) + (buffer[offset + 3] << 24 >>> 0);

      op = buffer[offset + 7] >> 4;
      flag = buffer[offset + 7] & 0xf;

      switch (op) {

        case 0x1: // OPEN
          processOpenPacket(
            sock,
            ch,
            flag,
            buffer,
            offset + 8, 
            offset + packetlen
          );
          break;

        case 0x2: // DATA
          processDataPacket(
            sock,
            ch,
            flag,
            buffer,
            offset + 8, 
            offset + packetlen
          );
          break;

        case 0x3: // SIGNAL
          processSignalPacket(
            sock,
            ch,
            flag,
            buffer,
            offset + 8, 
            offset + packetlen
          );
          break;

        default:
          return sock.destroy(new Error("Server sent bad op"));
      }

      offset += packetlen;
    }

    if (length - offset === 0) {
       buffer = null;
    }
  };
};


// Returns the binary representation of a mode expression. Returns null
// on invalid mode.
function getBinMode(modeExpr) {
  var result = 0;
  var match;

  if (!modeExpr) {
    return 0;
  }

  if (typeof modeExpr !== "string" || !(match = modeExpr.match(MODE_RE))) {
    return null;
  }

  match[1] && (result |= READ);
  match[2] && (result |= WRITE);
  match[3] && (result |= EMIT);

  return result;
}

/**
 *  ## StreamError
 *
 *  Represents a stream error
 */
function StreamError(cls, code, message) {
  this.name = "StreamError";
  this.cls = cls;
  this.message = message;

  if (typeof code == "undefined" || code < 0 || code > 0xf) {
    switch (cls) {
      case ERR_HANDSHAKE: this.code = HANDSHAKE_UNKNOWN; break;
      case ERR_OPEN: this.code = OpenRequest.FLAG_FAIL_OTHER; break;
      default: this.code = SignalPacket.FLAG_ERR_OTHER; break;
    }
  } else {
    this.code = code;
  }

  if (!message) {
    switch (cls + code) {
      case ERR_HANDSHAKE + HANDSHAKE_UNKNOWN:
        this.message = "Unknown error";
        break;
      case ERR_HANDSHAKE + HANDSHAKE_SERVER_BUSY:
        this.message = "Server is busy";
        break;
      case ERR_HANDSHAKE + HANDSHAKE_BADFORMAT:
        this.message = "Bad handshake request";
        break;
      case ERR_HANDSHAKE + HANDSHAKE_HOSTNAME:
        this.message = "Invalid hostname";
        break;
      case ERR_HANDSHAKE + HANDSHAKE_PROTOCOL:
        this.message = "Protocol not allowed";
        break;
      case ERR_HANDSHAKE + HANDSHAKE_SERVERERROR:
        this.message = "Server error";
        break;
      case ERR_OPEN + OpenRequest.FLAG_FAIL_NA:
        this.message = "Stream is not available";
        break;
      case ERR_OPEN + OpenRequest.FLAG_FAIL_MODE:
        this.message = "Not allowed to open stream with specified mode";
        break;
      case ERR_OPEN + OpenRequest.FLAG_FAIL_PROTOCOL:
        this.message = "Not allowed to open stream with specified protocol";
        break;
      case ERR_OPEN + OpenRequest.FLAG_FAIL_HOST:
        this.message = "Not allowed to open stream from host";
        break;
      case ERR_OPEN + OpenRequest.FLAG_FAIL_AUTH:
        this.message = "Not allowed to open stream with credentials";
        break;
      case ERR_OPEN + OpenRequest.FLAG_FAIL_SERVICE_NA:
        this.message = "Failed to open stream, service is not available";
        break;
      case ERR_OPEN + OpenRequest.FLAG_FAIL_SERVICE_ERR:
        this.message = "Failed to open stream, service error";
        break;
      case ERR_OPEN + OpenRequest.FLAG_FAIL_OTHER:
        this.message = "Failed to open stream, unknown error";
        break;
      case ERR_SIG + SignalPacket.FLAG_ERR_PROTOCOL:
        this.message = "Protocol error";
        break;
      case ERR_SIG + SignalPacket.FLAG_ERR_OPERATION:
        this.message = "Operational error";
        break;
      case ERR_SIG + SignalPacket.FLAG_ERR_LIMIT:
        this.message = "Limit error";
        break;
      case ERR_SIG + SignalPacket.FLAG_ERR_SERVER:
        this.message = "Server error";
        break;
      case ERR_SIG + SignalPacket.FLAG_ERR_VIOLATION:
        this.message = "Violation error";
        break;
      case ERR_SIG + SignalPacket.FLAG_ERR_OTHER:
        this.message = "Unknown error";
        break;
    }
  }
}

exports.StreamError = StreamError;
inherits(StreamError, Error);

/**
 *  ### StreamError.toString()
 *
 *  Returns a string representation of this StreamError instance.
 */
StreamError.prototype.toString = function() {
  var cls;
  switch (this.cls) {
    case ERR_HANDSHAKE: cls = "HANDSHAKERR"; break;
    case ERR_OPEN: cls = "OPENERR"; break;
    default: cls = "STREAMERR"; break;
  }
  return cls + " 0x" + this.code + ": " + this.message;
}

function combindBuffers(buffera, starta, enda, bufferb, startb, endb) {
  var length = (enda - starta) + (endb - startb);
  var newbuffer = new Buffer(length);
  buffera.copy(newbuffer, 0, starta, enda);
  bufferb.copy(newbuffer, (enda - starta), startb, endb);
  return newbuffer;
}

function parseURI(s) {
    var m = URI_RE.exec(s) || [];
    return { host: m[1]
           , port: m[2]
           , ch: (m[3] && m[3][0] == 'x' ? parseInt('0' + m[3]) : m[3])
           , token: m[4] };
}
