//
//        Copyright 2011 Hydna AB. All rights reserved.
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
var inherits              = require("util").inherits;
var Stream                = require("stream").Stream;

var VERSION               = require("./package.json").version;

var READ                  = 0x01;
var WRITE                 = 0x02;
var READWRITE             = 0x03;
var EMIT                  = 0x04;

// Packet related sizes
var PAYLOAD_MAX_SIZE      = 0xFFFFF8;

var ALL_CHANNELS          = 0;

var VALID_ENCODINGS_RE    = /^(ascii|utf8|base64|json)/i;
var MODE_RE = /^(r|read){0,1}(w|write){0,1}(?:\+){0,1}(e|emit){0,1}$/i;


exports.PAYLOAD_MAX_SIZE = PAYLOAD_MAX_SIZE;

// Follow 302 redirects. Adds a `X-Accept-Redirects: no` to the
// headers of the handshake request.
exports.followRedirects = true;


// Set the origin in handshakes. Set to `null` to disable
exports.origin = require("os").hostname();


// Set the agent header in handshakes. Set to `null` to disable
exports.agent = "node-winsock-client/" + VERSION;


exports.createChannel = function(url, mode, C) {
  var chan = new Channel();
  chan.connect(url, mode);
  if (typeof C == "function") {
    chan.once("connect", C);
  }
  return chan;
};


function Channel() {
  this.id = null;

  this._connecting = false;
  this._opening = false;
  this._closing = false;
  this._connection = null;
  this._request = null;
  this._mode = null;
  this._writeQueue = null;
  this._encoding = null;
  this._url = null;

  this.readable = false;
  this.writable = false;
  this.emitable = false;
}

exports.Channel = Channel;
inherits(Channel, Stream);


Object.defineProperty(Channel.prototype, 'readyState', {
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


Object.defineProperty(Channel.prototype, 'url', {
  get: function () {
    if (!this.id || !this._connection) {
      return null;
    }

    return this._url;
  }
});


Channel.prototype.connect = function(url, mode) {
  var parse;
  var self = this;
  var messagesize;
  var request;
  var uri;
  var id;
  var host;
  var mode;
  var token;

  if (this._connecting) {
    throw new Error("Already connecting");
  }

  if (typeof url !== "string") {
    throw new Error("bad argument, `url`, expected String");
  }

  if (/^http:\/\/|^https:\/\//.test(url) == false) {
    url = "http://" + url;
  }

  url = require("url").parse(url);

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("bad protocol, expected `http` or `https`");
  }

  if (url.pathname && url.pathname.length != 1) {
    if (url.pathname.substr(0, 2) == "/x") {
      id = parseInt("0" + url.pathname.substr(1));
    } else {
      id = parseInt(url.pathname.substr(1));
    }
    if (isNaN(id)) {
      throw new Error("Invalid channel");
    }
  } else {
    id = 1;
  }

  if (id > 0xFFFFFFFF) {
    throw new Error("Invalid channel expected no between x0 and xFFFFFFFF");
  }

  mode = getBinMode(mode);

  if (typeof mode !== "number") {
    throw new Error("Invalid mode");
  }

  if (url.query) {
    token = new Buffer(decodeURIComponent(uri.query), "utf8");
  }

  this.id = id;
  this._mode = mode;
  this._connecting = true;
  this._url = url.href;

  this.readable = ((this._mode & READ) == READ);
  this.writable = ((this._mode & WRITE) == WRITE);
  this.emitable = ((this._mode & EMIT) == EMIT);

  this._connection = Connection.getConnection(url, false);
  this._request = this._connection.open(this, id, mode, token);
};


Channel.prototype.setEncoding = function(encoding) {
  if (encoding && !VALID_ENCODINGS_RE.test(encoding)) {
    throw new Error("Encoding method not supported");
  }
  this._encoding = encoding;
};


Channel.prototype.write = function(data, enc, prio) {
  var encoding = (typeof enc == "string" && enc);
  var flag = ((encoding && prio) || prio || 1) - 1;
  var id = this.id;
  var frame;
  var payload;

  if (!this.writable) {
    throw new Error("Channel is not writable");
  }

  if (flag < 0 || flag > 3 || isNaN(flag)) {
    throw new Error("Bad priority, expected Number between 1-4");
  }

  if (!data) {
    throw new Error("Expected `data`");
  }

  if (Buffer.isBuffer(data)) {
    flag = flag << 1 | 0; // Set datatype to BINARY
    payload = data;
  } else {
    flag = flag << 1 | 1; // Set datatype to UTF8
    if (encoding && !VALID_ENCODINGS_RE.test(encoding)) {
      throw new Error("Encoding method is not supported");
    }
    if (encoding == "json") {
      payload = new Buffer(JSON.stringify(data), "utf8");
    } else {
      payload = new Buffer(data.toString(), encoding);
    }
  }

  if (payload.length > PAYLOAD_MAX_SIZE) {
    throw new Error("Payload overflow");
  }

  frame = new DataFrame(this.id, flag, payload);

  try {
    flushed = this._writeOut(frame);
  } catch (writeException) {
    this.destroy(writeException);
    return false;
  }

  return flushed;
};


Channel.prototype.dispatch = function(message) {
  var frame;
  var payload;
  var flushed;

  if (!this.emitable) {
    throw new Error("Channel is not emitable.");
  }

  if (typeof message !== "undefined" && typeof message !== "string") {
    throw new Error("Expected 'message' as String");
  }

  if (message) {
    payload = new Buffer(message, "utf8");

    if (payload.length > PAYLOAD_MAX_SIZE) {
      throw new Error("Payload overflow");
    }
  }

  frame = new SignalFrame(this.id, SignalFrame.FLAG_EMIT, payload);

  try {
    flushed = this._writeOut(frame);
  } catch (writeException) {
    this.destroy(writeException);
    return false;
  }

  return flushed;
};


Channel.prototype.end = function(message) {
  var payload;

  if (this.destroyed || this._closing) {
    return;
  }

  if (typeof message !== "undefined" && typeof message !== "string") {
    throw new Error("Expected 'message' as String");
  }

  if (message) {
    payload = new Buffer(message, "utf8");

    if (payload.length > PAYLOAD_MAX_SIZE) {
      throw new Error("Payload overflow");
    }
  }

  this._endsig = new SignalFrame(this.id, SignalFrame.FLAG_END, payload);

  this.destroy();
};


Channel.prototype.destroy = function(err) {
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

  sig = this._endsig || new SignalFrame(this.id, SignalFrame.FLAG_END);

  if (this._request) {
    // Do not send ENDSIG if _request is present. We need to wait for
    // the OPENSIG before we can close it.

    this._endsig = sig;
  } else {
    // Channel is open and we can therefor send ENDSIG immideitnly. This
    // can fail, if TCP connection is dead. If so, we can
    // destroy channel with good conscience.

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
    if (conn.channels[id] == chan) {
      delete conn.channels[id];
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


Channel.prototype.ondata = function(data, start, end, flag) {
  var encoding = this._encoding;
  var message = data.slice(start, end);

  if (encoding || (flag & 1 == 1)) {
    if (encoding == "json") {
      try {
        message = JSON.parse(message.toString("utf8"));
      } catch (exception) {
        this.destroy(exception);
        return;
      }
    } else {
      try {
        message = message.toString(encoding);
      } catch (exception) {
        this.destroy(exception);
        return;
      }
    }
  }

  if (this._events && this._events["data"]) {
    this.emit("data", message, (flag >> 1) + 1);
  }
};


Channel.prototype.onsignal = function(data, start, end) {
  var message = null;

  if (end - start) {
    message = data.toString("utf8", start, end);
  }

  if (this._events && this._events["signal"]) {
    this.emit("signal", message);
  }
};


// Internal write method to write raw packets.
Channel.prototype._writeOut = function(packet) {
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
    this.destroy(new Error("Channel is not writable"));
    return false;
  }
};


Channel.prototype._open = function(newid, message) {
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

  this.emit("connect", message);

  if (flushed) {
    this.emit("drain");
  }
};



// Represents a server connection.
function Connection(id) {
  this.id = id;
  this.chanRefCount = 0;
  this.reqRefCount = 0;
  this.channels = {};
  this.requests = {};
  this.sock = null;

  Connection.all[id] = this;
}


Connection.all = {};
Connection.disposed = {};


Connection.getConnection = function(url) {
  var id;
  var connection;
  var datacache = "";
  var lastException;

  id = url.protocol + url.host + (url.auth && (":" + url.auth) || "");

  if ((connection = Connection.all[id])) {
    return connection;
  }

  if ((connection = Connection.disposed[id])) {
    connection.setDisposed(false);
    return connection;
  }

  // rewrite url if initial token is present.
  url = require("url").parse([
    url.protocol,
    "//",
    url.hostname,
    url.port ? ":" + url.port : "",
    "/",
    url.auth
  ].join(""));

  connection = new Connection(id);
  connection.connect(url);

  return connection;
}


Connection.prototype.connect = function(url) {
  var self = this;

  if (this.sock) {
    throw new Error("Socket already connected");
  }

  process.nextTick(function() {
    getSock(url, function(err, sock) {
      var requests = self.requests;

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
      parserImplementation(self)

      if (self.reqRefCount == 0) {
        // All requests was cancelled before we got a
        // handshake from server. Dispose us.
        self.setDisposed(true);
      }

      try {
        for (var id in requests) {
          self.write(requests[id]);
          requests[id].sent = true;
        }
      } catch (writeException) {
        self.destroy(writeException);
      }
    });
  });
};


function getSock(url, C) {
  var parse = require("url").parse;
  var STATUS_CODES = require("http").STATUS_CODES;
  var MAX_REDIRECTS = 5;
  var redirections = 1;

  function dorequest(url) {
    var request;
    var opts;
    var req;
    var port;
    var host;
    var path;

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return C(new Error("Redirect, bad protocol `" + url.protocol + "`"));
    }

    request = require(url.protocol == "http:" ? "http" : "https").request;
    host = url.hostname;
    port = url.port || (url.protocol == "http:" ? 80 : 443);
    path = url.pathname;

    opts = {
      port: port,
      host: host,
      path: path,
      headers: {
        "Connection": "Upgrade",
        "Upgrade":    "winksock/1",
      }
    }

    if (!exports.followRedirects) {
      opts.headers["X-Accept-Redirects"] = "no";
    }

    if (exports.agent) {
      opts.headers["User-Agent"] = exports.agent;
    }

    if (exports.origin) {
      opts.headers["Origin"] = exports.origin;
    }

    req = request(opts, function(res) {
      var msg;

      res.setEncoding("utf8");

      res.on("data", function(chunk) {
        msg = msg ? msg + chunk : chunk;
      });

      res.on("end", function() {
        var code = res.statusCode;
        var url;
        var err;

        switch (code) {
          case 301:
          case 302:
          case 307:
            if (exports.followRedirects) {
              if (redirections++ == MAX_REDIRECTS) {
                return C(new Error("Max HTTP redirections reached"));
              }
              try {
                url = parse(res.headers["location"]);
              } catch (err) {
                return C(err);
              }
              return dorequest(url)
            } else {
              err = new Error("Redirected by host, followRedirects=false");
              return C(err);
            }
            break;
          default:
            if (msg) {
              err = new Error(STATUS_CODES[code] + " (" + msg + ")");
            } else {
              err = new Error(STATUS_CODES[code]);
            }
            break;
        }

        return C(err);
      });
    });

    req.on("error", function(err) {
      return C(err);
    });

    req.on("upgrade", function(res, sock) {
      sock.setTimeout(0);
      sock.removeAllListeners("error");
      sock.removeAllListeners("close");
      sock.resume();

      if (res.headers["upgrade"] != "winksock/1") {
        sock.destroy(new Error("Bad protocol version " + res.headers["upgrade"]));
      }

      return C(null, sock);
    });

    req.end();
  }

  dorequest(url);
}


Connection.prototype.open = function(chan, id, mode, token) {
  var self = this;
  var channels = this.channels;
  var oldchan;
  var request;

  if ((oldchan = channels[id]) && !oldchan._closing) {
    process.nextTick(function() {
      finalizeDestroyChannel(chan, new Error("Channel is already open"));
    });
    return null;
  }

  request = new OpenRequest(this, id, mode, token);

  request.onresponse = function(newid, message) {
    chan._open(newid, message);
  };

  request.onclose = function(err) {
    if (err) { finalizeDestroyChannel(chan, err); }
  };

  if (this.sock && !oldchan) {
    // Do not send request if socket isnt handshaked yet, or
    // if a channel is open and waiting for an ENDSIG.
    request.send();
  }

  return request;
};


Connection.prototype.setDisposed = function(state) {
  var id = this.id;
  var sock = this.sock;
  var self = this;

  if (!this.id || !sock) return;

  if (state) {

    if (sock) {
      sock.setTimeout(200);
      sock.once("timeout", function() {
        self.destroy();
      });
    }

    Connection.disposed[id] = this;
    Connection.all[id] = undefined;

  } else {

    delete Connection.disposed[id];
    Connection.all[id] = this;

    if (sock) {
      sock.setTimeout(0);
      sock.removeAllListeners("timeout");
    }
  }
};


// Write a `Packet` to the underlying socket.
Connection.prototype.write = function(frame) {
  if (this.sock) {
    return this.sock.write(frame.toBuffer());
  } else {
    return false;
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
        chan.ondata && chan.ondata(data, start, end, flag);
      }
    }
  } else if ((chan = channels[id])) {
    if (chan.readable) {
      chan.ondata && chan.ondata(data, start, end, flag);
    }
  }
};


Connection.prototype.processSignal = function(id, flag, data, start, end) {
  var channels = this.channels;
  var requests = this.requests;
  var chan;
  var message;

  switch (flag) {

    case SignalFrame.FLAG_EMIT:
      if (id === ALL_CHANNELS) {
        for (var chanid in channels) {
          chan = channels[chanid];
          if (chan._closing == false) {
            chan.onsignal && chan.onsignal(data, start, end);
          }
        }
      } else if ((chan = channels[id])) {
        if (chan._closing == false) {
          chan.onsignal && chan.onsignal(data, start, end);
        }
      }
      break;

    case SignalFrame.FLAG_END:
    case SignalFrame.FLAG_ERROR:

      if (end - start) {
        message = data.toString("utf8", start, end);
      }

      if (id === ALL_CHANNELS) {
        if (flag != SignalFrame.FLAG_END) {
          this.destroy(new Error(message || "ERR_UNKNOWN"));
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
        // to the function, because channel is closed according
        // to client.

        finalizeDestroyChannel(chan);

        if (requests[id]) {
          // Send pending open request if exists.
          requests[id].send();
        }

      } else {
        // Server closed this channel. We need to respond with a
        // ENDSIG in order to let server now that we received this
        // signal.

        try {
          this.write(new SignalFrame(id, SignalFrame.FLAG_END));
        } catch (writeException) {
          this.destroy(writeException);
        }

        if (flag != SignalFrame.FLAG_END) {
          finalizeDestroyChannel(chan, new Error(message || "ERR_UNKNOWN"));
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
      request.destroyAndNext(err);
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
  var next;

  this.conn = conn;
  this.id = id;
  this.flag = flag;
  this.data = data;
  this.present = false;
  this.sent = false;
  this.destroyed = false;

  this.prev = null;
  this.next = null;

  if ((next = requests[id])) {
    while (next.next && (next = next.next)) {};
    next.next = this;
  } else {
    requests[id] = this;
  }

  conn.reqRefCount++;
}


// Open Flags
OpenRequest.FLAG_ALLOW = 0x0;
OpenRequest.FLAG_REDIRECT = 0x1;
OpenRequest.FLAG_DENY = 0x7;


OpenRequest.prototype.send = function() {
  var self = this;

  if (this.present) {
    return;
  }

  this.present = true;

  if (this.sent) {
    throw new Error("OpenRequest is already sent");
  }


  process.nextTick(function() {
    self.sent = true;
    try {
      self.conn.write(self);
    } catch (err) {
      self.conn.destroy(err);
    }
  });

};


OpenRequest.prototype.cancel = function() {
  var id = this.id;
  var conn = this.conn;
  var requests = conn.requests;
  var next;


  if (this.sent) {
    // We cannot cancel if request is already sent.

    return false;
  }

  if (requests[id] == this) {
    if (this.next) {
      requests[id] = this.next;
    } else {
      delete requests[id];
    }
  } else if (this.prev) {
    this.prev = this.next;
  }

  this.destroy();

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
OpenRequest.prototype.destroyAndNext = function(err) {
  if (this.next) {
    this.next.destroyAndNext(err);
  }
  this.destroy(err);
}


OpenRequest.prototype.processResponse = function(flag, data, start, end) {
  var conn = this.conn;
  var request;
  var newid;
  var message;
  var len;

  if (this.next) {
    if (flag == OpenRequest.FLAG_ALLOW) {
      this.next.destroyAndNext(new Error("Channel is already open"));
    } else {
      this.next.prev = null;
      conn.requests[this.id] = this.next;
      conn.requests[this.id].send();
    }
  } else {
    delete conn.requests[this.id];
  }

  len = end - start;

  switch (flag) {

    case OpenRequest.FLAG_ALLOW:
      if (len) {
        try {
          message = data.toString("utf8", start, end);
        } catch (err) {
          this.destroy(err);
          return;
        }
      }
      this.onresponse(this.id, message);
      this.destroy();
      break;

    case OpenRequest.FLAG_REDIRECT:

      if (len < 4) {
        conn.destroy(new Error("Bad open resp"));
        return;
      }

      newid = (data[start + 1] << 16 |
               data[start + 2] << 8 |
               data[start + 3]) + (data[start] << 24 >>> 0);

      if (len > 4) {
        try {
          message = data.toString("utf8", start + 4, end);
        } catch (err) {
          this.destroy(err);
          return;
        }
      }

      this.onresponse(newid, message);
      this.destroy();
      break;

    default:
      try {
        message = len ? data.toString("utf8", start, end) : null;
      } catch (err) {}
      this.destroy(new Error(message || "ERR_OPEN_DENIED"));
      break;
  }
};


OpenRequest.prototype.toBuffer = function() {
  var id = this.id;
  var data = this.data;
  var flag = this.flag;
  var buffer;
  var length;

  length = 7 + (data ? data.length : 0);

  buffer = new Buffer(length);
  buffer[0] = length >>> 8;
  buffer[1] = length % 256;
  buffer[2] = id >>> 24;
  buffer[3] = id >>> 16;
  buffer[4] = id >>> 8;
  buffer[5] = id % 256;
  buffer[6] = 0x1 << 3 | flag;

  if (length > 7) {
    data.copy(buffer, 7);
  }

  return buffer;
};


function DataFrame(id, flag, data) {
  this.id = id;
  this.flag = flag;
  this.data = data;
}

DataFrame.prototype.toBuffer = function() {
  var id = this.id;
  var data = this.data;
  var flag = this.flag;
  var buffer;
  var length;

  length = 7 + (data ? data.length : 0);

  buffer = new Buffer(length);
  buffer[0] = length >>> 8;
  buffer[1] = length % 256;
  buffer[2] = id >>> 24;
  buffer[3] = id >>> 16;
  buffer[4] = id >>> 8;
  buffer[5] = id % 256;
  buffer[6] = 0x2 << 3 | flag;

  if (length > 7) {
    data.copy(buffer, 7);
  }

  return buffer;
};


function SignalFrame(id, flag, data) {
  this.id = id;
  this.flag = flag;
  this.data = data;
}

// Signal flags
SignalFrame.FLAG_EMIT = 0x0;
SignalFrame.FLAG_END = 0x1;
SignalFrame.FLAG_ERROR = 0x7;


SignalFrame.prototype.toBuffer = function() {
  var id = this.id;
  var data = this.data;
  var flag = this.flag;
  var buffer;
  var length;

  length = 7 + (data ? data.length : 0);

  buffer = new Buffer(length);
  buffer[0] = length >>> 8;
  buffer[1] = length % 256;
  buffer[2] = id >>> 24;
  buffer[3] = id >>> 16;
  buffer[4] = id >>> 8;
  buffer[5] = id % 256;
  buffer[6] = 0x3 << 3 | flag;

  if (length > 7) {
    data.copy(buffer, 7);
  }

  return buffer;
};


function parserImplementation(conn) {
  var buffer = null;
  var offset = 0;
  var length = 0;

  conn.sock.ondata = function(chunk, start, end) {
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

    while (offset < length && conn.id) {

      if (offset + 2 > length) {
        // We have not received the length yet
        break;
      }

      packetlen = buffer[offset] << 8 | buffer[offset + 1];

      if (packetlen < 0x7) {
        // Size is lower then packet header. Destroy wire
        return conn.destroy(new Error("bad packet size"));
      }

      if (offset + packetlen > length) {
        // We have not received the whole packet yet. Wait for
        // more data.
        break;
      }

      ch = (buffer[offset + 3] << 16 |
            buffer[offset + 4] << 8 |
            buffer[offset + 5]) + (buffer[offset + 2] << 24 >>> 0);

      desc = buffer[offset + 6];
      op = ((desc >> 1) & 0xf) >> 2;
      flag = (desc << 1 & 0xf) >> 1;

      switch (op) {

        case 0x0: // NOOP
          break;

        case 0x1: // OPEN
          conn.processOpen(ch, flag, buffer, offset + 7, offset + packetlen);
          break;

        case 0x2: // DATA
          conn.processData(ch, flag, buffer, offset + 7, offset + packetlen);
          break;

        case 0x3: // SIGNAL
          conn.processSignal(ch, flag, buffer, offset + 7, offset + packetlen);
          break;
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
