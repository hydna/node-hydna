//
//        Copyright 2011-2013 Hydna AB. All rights reserved.
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

'use strict';

var requestHttp               = require('http').request;
var requestHttps              = require('https').request;
var inherits                  = require('util').inherits;
var parseUrl                  = require('url').parse;
var Stream                    = require('stream').Stream;

var VERSION                   = require('./package.json').version;

var STATUS_CODES              = require('http').STATUS_CODES;

var READ                      = 0x01;
var WRITE                     = 0x02;
var READWRITE                 = 0x03;
var EMIT                      = 0x04;

var OP_HEARTBEAT              = 0x0;
var OP_OPEN                   = 0x1;
var OP_DATA                   = 0x2;
var OP_SIGNAL                 = 0x3;
var OP_RESOLVE                = 0x4;

var FLAG_BITMASK              = 0x7;

var OP_BITPOS                 = 3;
var OP_BITMASK                = (0x7 << OP_BITPOS);

var CTYPE_BITPOS              = 6;
var CTYPE_BITMASK             = (0x1 << CTYPE_BITPOS);

var PAYLOAD_TYPE_TEXT         = 0;
var PAYLOAD_TYPE_BINARY       = 1;

var PAYLOAD_MAX_SIZE          = 0xFFF8;

var ALL_CHANNELS              = 0;


exports.PAYLOAD_MAX_SIZE      = PAYLOAD_MAX_SIZE;

exports.send                  = send;
exports.dispatch              = dispatch;

exports.createChannel         = createChannel;

exports.Channel               = Channel;
exports.Connection            = Connection;

exports.origin                = require('os').hostname();
exports.agent                 = 'node-wink-client/' + VERSION;


function createChannel (url, mode, C) {
  var chan = new Channel();
  chan.connect(url, mode);
  if (typeof C == 'function') {
    chan.once('connect', C);
  }
  return chan;
};


function send (url, data, prio, C) {
  var headers;
  var payload;
  var url;

  if (typeof prio == 'function') {
    C = prio;
    prio = 0;
  }

  url = parseHydnaUrl(url);

  payload = typeof data == 'string' ? new Buffer(data, 'utf8') : data;

  if (Buffer.isBuffer(payload) == false) {
    throw new Error('Expected "data" as String or Buffer');
  }

  if (payload.length > PAYLOAD_MAX_SIZE) {
    throw new Error('Payload overflow');
  }

  headers = {
    'agent': exports.agent,
    'X-Priority': String(prio),
    'Content-Type': 'text/plain',
    'Content-Length': payload.length
  };

  writeHttpRequest(url, payload, headers, C);
}


function dispatch (url, data, C) {
  var headers;
  var payload;
  var url;

  url = parseHydnaUrl(url);

  payload = typeof data == 'string' ? new Buffer(data, 'utf8') : data;

  if (Buffer.isBuffer(payload) == false) {
    throw new Error('Expected "data" as String or Buffer');
  }

  if (payload.length > PAYLOAD_MAX_SIZE) {
    throw new Error('Payload overflow');
  }

  headers = {
    'agent': exports.agent,
    'X-Emit': 'yes',
    'Content-Type': 'text/plain',
    'Content-Length': payload.length
  };

  writeHttpRequest(url, payload, headers, C);
}


function writeHttpRequest (url, payload, headers, C) {
  var options;
  var request;
  var req;

  request = url.protocol == 'http:' ? requestHttp : requestHttps;

  options = {
    hostname: url.hostname,
    port: url.port || 80,
    path: url.pathname,
    method: 'POST',
    headers: headers
  };

  req = request(options, function (res) {
    var data;

    if (typeof C !== 'function') {
      return;
    }

    if (res.statusCode == 200) {
      return C();
    }

    res.setEncoding('utf8');

    res.on('data', function (chunk) {
      data += chunk;
    });

    res.on('close', function () {
      var err;
      err = new Error(data || 'HTTP_' + res.statusCode);
      return C(err);
    });
  });

  req.on('error', function (err) {
    return C && C(err);
  });

  req.write(payload);
  req.end();
}


function Channel() {
  this._id = null;
  this._connecting = false;
  this._opening = false;
  this._closing = false;
  this._connection = null;
  this._request = null;
  this._mode = null;
  this._writeQueue = null;
  this._url = null;
  this._path = null;

  this.readable = false;
  this.writable = false;
  this.emitable = false;
}


inherits(Channel, Stream);


Object.defineProperty(Channel.prototype, 'readyState', {
  get: function () {
    var state;

    if (this._connecting) {
      return 'opening';
    } else if (this._closing) {
      return 'closing';
    } else if (!this._path) {
      return 'closed';
    } else if (this.readable && this.writable) {
      state = 'readwrite';
    } else if (this.readable && !this.writable){
      state = 'read';
    } else if (!this.readable && this.writable){
      state = 'write';
    }
    if (this.emitable) {
      state += '+emit';
    }

    return state;
  }
});


Object.defineProperty(Channel.prototype, 'url', {
  get: function () {
    if (!this._path || !this._connection) {
      return null;
    }

    return this._url;
  }
});


Object.defineProperty(Channel.prototype, 'path', {
  get: function () {
    if (!this._path || !this._connection) {
      return null;
    }

    return this._path;
  }
});


Channel.prototype.connect = function(url, mode, opts) {
  var self = this;
  var messagesize;
  var request;
  var path;
  var host;
  var mode;
  var token;

  if (this._connecting) {
    throw new Error('Already connecting');
  }

  url = parseHydnaUrl(url);

  if (typeof mode == "object") {
    opts = mode;
    mode = null;
  }

  mode = getBinMode(mode);

  if (typeof mode !== 'number') {
    throw new Error('Invalid mode');
  }

  token = url.token;
  path = url.pathname;

  opts = opts || {};

  this._mode = mode;
  this._connecting = true;
  this._url = url.href;
  this._path = path;
  this._id = null;

  this.readable = ((this._mode & READ) == READ);
  this.writable = ((this._mode & WRITE) == WRITE);
  this.emitable = ((this._mode & EMIT) == EMIT);

  this._connection = Connection.getConnection(url, opts);
  this._request = this._connection.open(this, path, mode, token);
};


Channel.prototype.write = function(data, prio) {
  var flag = prio || 0;
  var id = this._id;
  var frame;
  var payload;
  var flushed;

  if (!this.writable) {
    throw new Error('Channel is not writable');
  }

  if (flag < 0 || flag > 7 || isNaN(flag)) {
    throw new Error('Bad priority, expected Number between 0-7');
  }

  if (Buffer.isBuffer(data)) {
    if (data.length > PAYLOAD_MAX_SIZE) {
      throw new Error('Payload overflow');
    }
  } else if (typeof data == 'string') {
    if (Buffer.byteLength(data, 'utf8') > PAYLOAD_MAX_SIZE) {
      throw new Error('Payload overflow');
    }
  } else {
    throw new Error('Bad type for data');
  }

  frame = new DataFrame(this._id, flag, data);

  try {
    flushed = this._writeOut(frame);
  } catch (writeException) {
    this.destroy(writeException);
    return false;
  }

  return flushed;
};


Channel.prototype.dispatch = function(data) {
  var frame;
  var payload;
  var flushed;

  if (!this.emitable) {
    throw new Error('Channel is not emitable.');
  }

  if (Buffer.isBuffer(data)) {
    if (data.length > PAYLOAD_MAX_SIZE) {
      throw new Error('Payload overflow');
    }
  } else if (typeof data == 'string') {
    if (Buffer.byteLength(data, 'utf8') > PAYLOAD_MAX_SIZE) {
      throw new Error('Payload overflow');
    }
  } else {
    throw new Error('Bad type for data');
  }

  frame = new SignalFrame(this._id, SignalFrame.FLAG_EMIT, data);

  try {
    flushed = this._writeOut(frame);
  } catch (writeException) {
    this.destroy(writeException);
    return false;
  }

  return flushed;
};


Channel.prototype.end = function(data) {

  if (this.destroyed || this._closing) {
    return;
  }

  if (Buffer.isBuffer(data)) {
    if (data.length > PAYLOAD_MAX_SIZE) {
      throw new Error('Payload overflow');
    }
  } else if (typeof data == 'string') {
    if (Buffer.byteLength(data, 'utf8') > PAYLOAD_MAX_SIZE) {
      throw new Error('Payload overflow');
    }
  }

  this._endsig = new SignalFrame(this._id, SignalFrame.FLAG_END, data);

  this.destroy();
};


Channel.prototype.destroy = function(err) {
  var sig;

  if (this.destroyed || this._closing || !this._path) {
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

  sig = this._endsig || new SignalFrame(this._id, SignalFrame.FLAG_END);

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
  var id = chan._id;
  var path = chan._path;
  var conn;

  if (chan.destroyed) {
    return;
  }

  if ((conn = chan._connection)) {
    if (conn.channelsByPath[path] == chan) {
      delete conn.channelsByPath[path];
      conn.chanRefCount--;
      if (conn.chanRefCount == 0 &&
          conn.reqRefCount == 0) {
        conn.setDisposed(true);
      }
    }
    if (conn.channels[id] == chan) {
      delete conn.channels[id];
    }
  }

  chan.readable = false;
  chan.writable = false;
  chan.emitable = false;
  chan.destroyed = true;
  chan._id = null;
  chan._request = null;
  chan._writequeue = null;
  chan._connection = null;

  if (err) {
    if (err instanceof Error) {
      chan.emit('error', err);
    } else {
      if (typeof err == 'string') {
        chan.emit('error', new Error(err));
      } else {
        chan.emit('error', new Error('ERR_UNKNOWN'));
      }
    }
  }

  chan.emit('close', !(!err), message);

  chan._path = null;
};


Channel.prototype.ondata = function(data) {
  if (!this._events || 'data' in this._events == false) {
    return;
  }

  this.emit('data', data);
};


Channel.prototype.onsignal = function(data) {
  if (!this._events || 'signal' in this._events == false) {
    return;
  }

  this.emit('signal', data);
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
    this.destroy(new Error('Channel is not writable'));
    return false;
  }
};


Channel.prototype._open = function(id, data, path) {
  var flushed = false;
  var queue = this._writeQueue;
  var packet;

  this._id = id;
  this._connecting = false;
  this._writeQueue = null;
  this._request = null;

  this._connection.channels[id] = this;
  this._connection.channelsByPath[path] = this;
  this._connection.chanRefCount++;

  if (queue && queue.length) {
    for (var i = 0, l = queue.length; i < l; i++) {
      packet = queue[i];
      packet.id = id;
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
      packet.id = id;
      try {
        this._writeOut(packet);
      } catch (err) {
        // Ignore
      }
      return;
    }
  }

  this.emit('connect', data);

  if (flushed) {
    this.emit('drain');
  }
};



// Represents a server connection.
function Connection (id, opts) {
  this.id = id;
  this.chanRefCount = 0;
  this.reqRefCount = 0;
  this.channelsByPath = {};
  this.channels = {};
  this.requests = {};
  this.sock = null;

  this._multiplex = 'noMultiplex' in opts           ? opts.noMultiplex : true;

  this._agent = 'agent' in opts                     ? opts.agent
                                                    : exports.agent;

  this._origin = 'origin' in opts                   ? opts.origin
                                                    : exports.origin;

  this.keepAliveTimer = null;
  this.lastSentMessage = 0;

  if (this._multiplex) {
    Connection.all[id] = this;
  }
}


Connection.all = {};
Connection.disposed = {};


Connection.getConnection = function (url, opts) {
  var id;
  var connection;

  id = url.protocol + url.host + (url.auth && (':' + url.auth) || '');

  if (!opts.noMultiplex && (connection = Connection.all[id])) {
    return connection;
  } else if (!opts.noMultiplex && (connection = Connection.disposed[id])) {
    connection.setDisposed(false);
    return connection;
  }

  // rewrite url if initial token is present.
  url = parseUrl([
    url.protocol,
    '//',
    url.hostname,
    url.port ? ':' + url.port : '',
    '/',
    url.auth
  ].join(''));

  connection = new Connection(id, opts);
  connection.connect(url);

  return connection;
}


Connection.prototype.connect = function(url) {
  var self = this;

  if (this.sock) {
    throw new Error('Socket already connected');
  }

  process.nextTick(function() {
    var opts;

    opts = {
      agent             : self._agent,
      origin            : self._agent
    };

    getSock(url, opts, function(err, sock) {
      var requests = self.requests;

      if (err) {
        return self.destroy(err);
      }

      sock.setNoDelay(true);
      sock.setKeepAlive && sock.setKeepAlive(true);

      sock.on('drain', function() {
        var channels = self.channels;
        var chan;

        for (var id in channels) {
          chan = channels[id];
          if (chan._events && chan._events['drain']) {
            chan.emit('drain');
          }
        }
      });

      sock.on('error', function(err) {
        self.sock = null;
        self.destroy(err);
      });

      sock.on('close', function(hadError) {
        if (hadError == false) {
          self.sock = null;
          self.destroy(new Error('Connection reseted by server'));
        }
      });

      self.sock = sock;

      if (self.reqRefCount == 0) {
        // All requests was cancelled before we got a
        // handshake from server. Dispose us.
        self.setDisposed(true);
      }

      try {
        for (var id in requests) {
          self.write(requests[id]);
        }
      } catch (writeException) {
        self.destroy(writeException);
      }

      process.nextTick(function () {
        sock.resume();
        parserImplementation(self);
        self.startKeepAliveTimer();
      });
    });
  });
};


function getSock(url, opts, C) {
  var request;
  var opts;
  var req;
  var port;
  var host;
  var path;

  request = url.protocol == 'http:' ? requestHttp : requestHttps;
  host = url.hostname;
  port = url.port || (url.protocol == 'http:' ? 80 : 443);
  path = url.pathname;

  opts = {
    port: port,
    host: host,
    path: path,
    headers: {
      'Connection': 'Upgrade',
      'Upgrade':    'winksock/1',
    },
    agent: false
  }

  if (opts.agent) {
    opts.headers['User-Agent'] = exports.agent;
  }

  if (opts.origin) {
    opts.headers['Origin'] = exports.origin;
  }

  req = request(opts, function(res) {
    res.on('end', function() {
      return (new Error('Expected upgrade'));
    });
  });

  req.on('error', function(err) {
    return C(err);
  });

  req.on('upgrade', function(res, sock) {
    sock.setTimeout(0);
    sock.removeAllListeners('error');
    sock.removeAllListeners('close');

    if (res.headers['upgrade'] != 'winksock/1') {
      sock.destroy(new Error('Bad protocol version ' + res.headers['upgrade']));
    }

    return C(null, sock);
  });

  req.end();
}


Connection.prototype.open = function(chan, path, mode, token) {
  var self = this;
  var channels = self.channels;
  var channelsByPath = self.channelsByPath;
  var oldchan;
  var request;

  if ((oldchan = channelsByPath[path]) && !oldchan._closing) {
    process.nextTick(function() {
      finalizeDestroyChannel(chan, new Error('Channel is already open'));
    });
    return null;
  }

  request = new OpenRequest(self, path, mode, token);

  request.onresponse = function(id, data, path) {
    chan._open(id, data, path);
  };

  request.onclose = function(err) {
    if (err) { finalizeDestroyChannel(chan, err); }
  };

  if (self.sock && !oldchan) {
    // Do not send request if socket isnt handshaked yet, or
    // if a channel is open and waiting for an ENDSIG.
    request.resolve();
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
      sock.once('timeout', function() {
        self.destroy();
      });
    }

    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }

    if (this._multiplex) {
      Connection.disposed[id] = this;
      Connection.all[id] = undefined;
    }

  } else {

    if (this._multiplex) {
      delete Connection.disposed[id];
      Connection.all[id] = this;
    }

    if (sock) {
      sock.setTimeout(0);
      sock.removeAllListeners('timeout');
    }

    this.startKeepAliveTimer();
  }
};


// Write a `Packet` to the underlying socket.
Connection.prototype.write = function(frame) {
  if (this.sock) {
    this.lastSentMessage = Date.now();
    return this.sock.write(frame.toBuffer());
  } else {
    return false;
  }
};


Connection.prototype.startKeepAliveTimer = function () {
  var self = this;
  this.keepAliveTimer = setInterval(function () {
    var now = Date.now();
    var frame;

    if (now - self.lastSentMessage >= 15000) {
      frame = new NoopFrame();
      try {
        self.write(frame);
      } catch (err) {
      }
    }
  }, 5000);
};


Connection.prototype.processOpen = function(id, flag, data) {
  var requests = this.requests;
  var keys;
  var request;
  var key;

  keys = Object.keys(requests);

  for (var i = 0; i < keys.length; i++) {
    key = keys[i];
    if (requests[key].id == id) {
      request = requests[key];
      break;
    }
  }

  if (!request) {
    this.destroy(new Error('Server sent an open response to unknown'));
    return;
  }

  request.processResponse(flag, data);
};


Connection.prototype.processData = function(id, flag, data) {
  var channels = this.channels;
  var clone;
  var chan;

  if (id === ALL_CHANNELS) {
    for (var chanid in channels) {
      chan = channels[chanid];
      if (chan.readable) {
        if (chan.ondata) {
          clone = new Buffer(data.length);
          data.copy(clone);
          chan.ondata(clone);
        }
      }
    }
  } else if ((chan = channels[id])) {
    if (chan.readable) {
      if (chan.ondata) {
        chan.ondata(data);
      }
    }
  }
};


Connection.prototype.processSignal = function(id, flag, data) {
  var channels = this.channels;
  var requests = this.requests;
  var clone;
  var chan;


  switch (flag) {

    case SignalFrame.FLAG_EMIT:
      if (id === ALL_CHANNELS) {
        for (var chanid in channels) {
          chan = channels[chanid];
          if (chan._closing == false) {
            if (chan.onsignal) {
              clone = new Buffer(data.length);
              data.copy(clone);
              chan.onsignal(clone);
            }
          }
        }
      } else if ((chan = channels[id])) {
        if (chan._closing == false) {
          if (chan.onsignal) {
            chan.onsignal(data);
          }
        }
      }
      break;

    case SignalFrame.FLAG_END:
    case SignalFrame.FLAG_ERROR:

      if (id === ALL_CHANNELS) {
        if (flag != SignalFrame.FLAG_END) {
          this.destroy(data);
        } else {
          this.destroy(null, data);
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

        if (requests[chan.path]) {
          // Send pending open request if exists.
          requests[chan.path].resolve();
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
          finalizeDestroyChannel(chan, data);
        } else {
          finalizeDestroyChannel(chan, null, data);
        }
      }
      break;

    default:
      this.destroy(new Error('Server sent an unknown SIGFLAG'));
      return;
  }

};


Connection.prototype.processResolve = function (id, flag, data) {
  var requests = this.requests;
  var request;
  var path;

  if (!data || data.length == 0) {
    this.destroy(new Error('Server sent a bad resolve response'));
    return;
  }

  path = data.toString('ascii');

  if ((request = requests[path])) {
    request.processResolve(id, flag, path);
  }
};


// Destroy connection with optional Error
Connection.prototype.destroy = function(err, data) {
  var id = this.id;
  var channels = this.channelsByPath;
  var requests = this.requests;
  var chan;
  var request;
  var queued;

  if (!id) {
    return;
  }

  this.id = null;

  for (var path in channels) {
    if ((chan = channels[path])) {
      finalizeDestroyChannel(chan, err, data);
    }
  }

  for (var reqid in requests) {
    if ((request = requests[reqid])) {
      request.destroyAndNext(err);
    }
  }

  this.channels = {};
  this.channelsByPath = {};
  this.requests = {};
  this.chanRefCount = 0;
  this.reqRefCount = 0;

  if (this._multiplex) {
    delete Connection.all[id];
    delete Connection.disposed[id];
  }

  if (this.keepAliveTimer) {
    clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = null;
  }

  if (this.sock) {
    this.sock.destroy();
    this.sock = null;
  }
};

// OpenRequest constructor.
function OpenRequest(conn, path, flag, data) {
  var requests = conn.requests;
  var next;

  this.id = null;

  this.conn = conn;
  this.path = path;
  this.flag = flag;
  this.data = data;
  this.present = false;
  this.sent = false;
  this.destroyed = false;

  this.prev = null;
  this.next = null;

  if ((next = requests[path])) {
    while (next.next && (next = next.next)) {};
    next.next = this;
  } else {
    requests[path] = this;
  }

  conn.reqRefCount++;
}


// Open Flags
OpenRequest.FLAG_ALLOW = 0x0;
OpenRequest.FLAG_DENY = 0x7;


OpenRequest.prototype.send = function() {
  var self = this;

  if (this.present) {
    return;
  }

  this.present = true;

  if (this.sent) {
    throw new Error('OpenRequest is already sent');
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


OpenRequest.prototype.resolve = function() {
  var self = this;

  if (this.id) {
    this.destroy(new Error('OpenRequest already have an ID'));
    return;
  }

  process.nextTick(function() {
    try {
      self.conn.write(self);
    } catch (err) {
      self.conn.destroy(err);
    }
  });

};


OpenRequest.prototype.cancel = function() {
  var path = this.path;
  var conn = this.conn;
  var requests = conn.requests;
  var next;


  if (this.sent) {
    // We cannot cancel if request is already sent.

    return false;
  }

  if (requests[path] == this) {
    if (this.next) {
      requests[path] = this.next;
    } else {
      delete requests[path];
    }
  } else if (this.prev) {
    this.prev = this.next;
  }

  this.destroy();

  return true;
};


OpenRequest.prototype.destroy = function(err, data) {
  var conn;

  if (!this.destroyed) {
    if ((conn = this.conn) && conn.id) {
      conn.reqRefCount--;
      if (conn.reqRefCount == 0 &&
          conn.chanRefCount == 0) {
        conn.setDisposed(true);
      }
    }
    this.onclose && this.onclose(err, data);
    this.destroyed = true;
  }
};


// Destroy this OpenRequest and all other in chain
OpenRequest.prototype.destroyAndNext = function(err) {
  if (this.next) {
    this.next.destroyAndNext(err);
  }
  this.destroy(err);
};


OpenRequest.prototype.processResolve = function(id, flag, path) {
  if (flag != OpenRequest.FLAG_ALLOW) {
    this.destroy(new Error("ERR_UNABLE_TO_RESOLVE_PATH"));
    return;
  }

  this.id = id;
  this.send();
};


OpenRequest.prototype.processResponse = function(flag, data) {
  var conn = this.conn;
  var request;

  if (this.next) {
    if (flag == OpenRequest.FLAG_ALLOW) {
      this.next.destroyAndNext(new Error('Channel is already open'));
    } else {
      this.next.prev = null;
      conn.requests[this.path] = this.next;
      conn.requests[this.path].resolve();
    }
  } else {
    delete conn.requests[this.path];
  }

  switch (flag) {

    case OpenRequest.FLAG_ALLOW:
      this.onresponse(this.id, data, this.path);
      this.destroy();
      break;

    default:
      this.destroy(data);
      break;
  }
};


OpenRequest.prototype.toBuffer = function() {
  var id;
  var data;
  var flag;
  var buffer;
  var length;
  var ctype;
  var op;


  ctype = PAYLOAD_TYPE_TEXT;
  length = 7;

  if ((id = this.id)) {
    op = OP_OPEN;
    flag = this.flag;
    data = this.data;

    if (typeof data == 'string') {
      data = new Buffer(data, 'utf8');
      length += data.length;
    } else if (Buffer.isBuffer(data)) {
      ctype = PAYLOAD_TYPE_BINARY;
      length += data.length;
    }

  } else {
    id = OP_RESOLVE;
    op = 0x4;
    flag = 0;
    data = new Buffer(this.path, 'ascii');
    length += data.length;
  }

  buffer = new Buffer(length);
  buffer[0] = length >>> 8;
  buffer[1] = length % 256;
  buffer[2] = id >>> 24;
  buffer[3] = id >>> 16;
  buffer[4] = id >>> 8;
  buffer[5] = id % 256;
  buffer[6] = (ctype << CTYPE_BITPOS) | (op << OP_BITPOS) | flag;

  if (length > 7) {
    data.copy(buffer, 7);
  }

  return buffer;
};


function NoopFrame () {
}


NoopFrame.prototype.toBuffer = function() {
  var buffer;
  var length;

  length = 7;

  buffer = new Buffer(length);
  buffer[0] = length >>> 8;
  buffer[1] = length % 256;
  buffer[2] = 0;
  buffer[3] = 0;
  buffer[4] = 0;
  buffer[5] = 0;
  buffer[6] = 0;

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
  var ctype;
  var buffer;
  var length;

  ctype = PAYLOAD_TYPE_TEXT;
  length = 7;

  if (typeof data == 'string') {
    data = new Buffer(data, 'utf8');
    length += data.length;
  } else if (Buffer.isBuffer(data)) {
    ctype = PAYLOAD_TYPE_BINARY;
    length += data.length;
  }

  buffer = new Buffer(length);
  buffer[0] = length >>> 8;
  buffer[1] = length % 256;
  buffer[2] = id >>> 24;
  buffer[3] = id >>> 16;
  buffer[4] = id >>> 8;
  buffer[5] = id % 256;
  buffer[6] = (ctype << CTYPE_BITPOS) | (OP_DATA << OP_BITPOS) | flag;

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
  var ctype;
  var buffer;
  var length;

  ctype = PAYLOAD_TYPE_TEXT;
  length = 7;

  if (typeof data == 'string') {
    data = new Buffer(data, 'utf8');
    length += data.length;
  } else if (Buffer.isBuffer(data)) {
    ctype = PAYLOAD_TYPE_BINARY;
    length += data.length;
  }

  buffer = new Buffer(length);
  buffer[0] = length >>> 8;
  buffer[1] = length % 256;
  buffer[2] = id >>> 24;
  buffer[3] = id >>> 16;
  buffer[4] = id >>> 8;
  buffer[5] = id % 256;
  buffer[6] = (ctype << CTYPE_BITPOS) | (OP_SIGNAL << OP_BITPOS) | flag;

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
    var packetlen;
    var data;
    var ctype;
    var ch;
    var op;
    var flag;
    var desc;

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
        return conn.destroy(new Error('bad packet size'));
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

      ctype = (desc & CTYPE_BITMASK) >> CTYPE_BITPOS;
      op = (desc & OP_BITMASK) >> OP_BITPOS;
      flag = (desc & FLAG_BITMASK);

      if ((offset + packetlen) - (offset + 7)) {
        if (ctype == PAYLOAD_TYPE_TEXT) {
          try {
            data = buffer.toString('utf8', offset + 7, offset + packetlen);
          } catch (err) {
            conn.destroy(err);
            return;
          }
        } else {
          data = buffer.slice(offset + 7, offset + packetlen);
        }
      }


      switch (op) {

        case OP_HEARTBEAT:
          break;

        case OP_OPEN:
          conn.processOpen(ch, flag, data);
          break;

        case OP_DATA:
          conn.processData(ch, flag, data);
          break;

        case OP_SIGNAL:
          conn.processSignal(ch, flag, data);
          break;

        case OP_RESOLVE:
          conn.processResolve(ch, flag, data);
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
  var modere = /^(r|read){0,1}(w|write){0,1}(?:\+){0,1}(e|emit){0,1}$/i;
  var result = 0;
  var match;

  if (!modeExpr) {
    return 0;
  }

  if (typeof modeExpr !== 'string' || !(match = modeExpr.match(modere))) {
    return null;
  }

  match[1] && (result |= READ);
  match[2] && (result |= WRITE);
  match[3] && (result |= EMIT);

  return result;
}


function parseHydnaUrl(url) {
  var channel;

  if (typeof url !== 'string') {
    throw new Error('bad argument, `url`, expected String');
  }

  if (/^http:\/\/|^https:\/\//.test(url) == false) {
    url = 'http://' + url;
  }

  url = parseUrl(url);

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('bad protocol, expected `http` or `https`');
  }

  if (url.query) {
    url.token = url.query;
  }

  return url;
}