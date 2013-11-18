
'use strict';

var http                      = require('http');
var https                     = require('https');
var util                      = require('util');
var parseUrl                  = require('url').parse;
var events                    = require('events');
var stream                    = require('stream');

var VERSION                   = require('./package.json').version;

var PROTOCOL_VERSION          = 'winksock/1';

var READ                      = 0x01;
var WRITE                     = 0x02;
var EMIT                      = 0x04;

var OP_HEARTBEAT              = 0x0;
var OP_OPEN                   = 0x1;
var OP_DATA                   = 0x2;
var OP_SIGNAL                 = 0x3;
var OP_RESOLVE                = 0x4;

var FLAG_ALLOW                = 0x0;
var FLAG_EMIT                 = 0x0;
var FLAG_END                  = 0x1;
var FLAG_DENY                 = 0x7;
var FLAG_ERROR                = 0x7;


var FLAG_BITMASK              = 0x7;

var OP_BITPOS                 = 3;
var OP_BITMASK                = (0x7 << OP_BITPOS);

var CTYPE_BITPOS              = 6;
var CTYPE_BITMASK             = (0x1 << CTYPE_BITPOS);

var PAYLOAD_TYPE_TEXT         = 0;
var PAYLOAD_TYPE_BINARY       = 1;

var PAYLOAD_MAX_SIZE          = 0xFFFA;

var ALL_CHANNELS              = 0;


exports.PAYLOAD_MAX_SIZE      = PAYLOAD_MAX_SIZE;

exports.send                  = send;
exports.dispatch              = dispatch;

exports.createChannel         = createChannel;

exports.Channel               = Channel;
exports.Connection            = Connection;
exports.OpenError             = OpenError;
exports.SignalError           = SignalError;

exports.origin                = require('os').hostname();
exports.agent                 = 'node-wink-client/' + VERSION;


var connections               = {};


function createChannel(url, mode, opts, C) {
  var connection;
  var channel;
  var urlobj;
  var connurl;
  var path;

  if (typeof opts == 'function') {
    C = opts;
    opts = null;
  }

  urlobj = parseHydnaUrl(url);
  connurl = createConnectionUrl(urlobj);
  path = urlobj.pathname;

  if (!opts || !opts.disableMultiplex) {
    if (Array.isArray(connections[connurl])) {
      for (var i = 0; i < connections[connurl].length; i++) {
        if (path in connections[connurl][i].channels == false) {
          connection = connections[connurl][i];
          break;
        }
      }
    } else if (connections[connurl]) {
      if (path in connections[connurl].channels == false) {
        connection = connections[connurl];
      }
    }
  }

  if (!connection) {
    connection = new Connection(connurl);
    connection.once('close', function() {
      var idx;

      if (Array.isArray(connections[connurl])) {
        idx = connections[connurl].indexOf(connection);
        connections[connurl].splice(idx, 1);
        if (connections[connurl].length == 1) {
          connections[connurl] = connections[connurl][0];
        }
      } else {
        delete connections[connurl];
      }
    });

    if (connurl in connections == false) {
      connections[connurl] = connection;
    } else if (Array.isArray(connections[connurl])) {
      connections[connurl].push(connection);
    } else {
      connections[connurl] = [connections[connurl], connection];
    }
  }

  try {
    channel = connection.createChannel(path, mode, urlobj.query);
  } catch (err) {
    if (connection.refcount == 0) {
      connection.emit('close');
    }
    throw err;
  }

  if (typeof C == 'function') {
    channel.once('connect', C);
  }

  return channel;
};


function send (url, data, prio, C) {
  var headers;

  if (typeof prio == 'function') {
    C = prio;
    prio = 0;
  }

  headers = {
    'agent': exports.agent,
    'X-Priority': String(prio),
    'Content-Type': 'text/plain'
  };

  writeHttpRequest(url, data, headers, C);
}


function dispatch (url, data, C) {
  var headers;

  headers = {
    'agent': exports.agent,
    'X-Emit': 'yes',
    'Content-Type': 'text/plain'
  };

  writeHttpRequest(url, data, headers, C);
}


function writeHttpRequest (url, data, headers, C) {
  var options;
  var request;
  var httpmod;
  var payload;
  var req;

  payload = typeof data == 'string' ? new Buffer(data, 'utf8') : data;

  if (Buffer.isBuffer(payload) == false) {
    throw new Error('Expected "data" as String or Buffer');
  }

  if (payload.length > PAYLOAD_MAX_SIZE) {
    throw new Error('Payload overflow');
  }

  headers['Content-Length'] = payload.length;

  url = parseHydnaUrl(url);

  httpmod = url.protocol == 'http:' ? http : https;

  options = {
    hostname: url.hostname,
    port: url.port || (httpmod == http ? 80 : 443),
    path: url.pathname,
    method: 'POST',
    headers: headers
  };

  req = httpmod.request(options, function (res) {
    var data = '';

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

    res.on('end', function () {
      var err = new OpenError(data || 'HTTP_' + res.statusCode);
      return C(err);
    });
  });

  req.on('error', function (err) {
    return C && C(err);
  });

  req.write(payload);
  req.end();
}


function Channel(connection, path, mode, token) {
  this.readable = ((mode & READ) == READ);
  this.writable = ((mode & WRITE) == WRITE);
  this.emitable = ((mode & EMIT) == EMIT);

  this._connection = connection;
  this._path = path;
  this._mode = mode;
  this._url = connection.url + path;
  this._token = token;

  this._connecting = true;

  this._ptr = null;
  this._connected = false;
  this._closing = false;
  this._resolved = false;
  this._writeQueue = null;
  this._destroyed = false;
  this._endsig = null;
}


util.inherits(Channel, stream.Stream);


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
    if (!this._url || !this._connection) {
      return null;
    }

    return this._url;
  }
});


Channel.prototype._onopen = function(data) {
  var flushed = false;
  var queue = this._writeQueue;
  var writereq;

  this._writeQueue = null;
  this._connecting = false;
  this._connected = true;
  this._token = null;

  if (queue) {
    for (var i = 0, l = queue.length; i < l; i++) {
      writereq = queue[i];

      flushed = this._writeOut(writereq.op, writereq.flag, writereq.data);
    }
  }

  if (this._closing) {
    this._writeOut(OP_SIGNAL, FLAG_END, this._endsig);
    this._endsig = null;
  }

  this.emit('connect', data);

  if (flushed) {
    this.emit('drain');
  }
};


Channel.prototype._onend = function(data) {
  var self = this;

  this._ptr = null;
  this._token = null;
  this._closing = false;
  this._connected = false;
  this._resolved = false;
  this._mode = null;

  this._connection = null;
  this._endsig = null;
  this._destroyed = true;

  if (data instanceof Error) {
    this.emit('error', data);
    this.emit('close', true);
  } else {
    this.emit('close', false, data);
  }

  this._path = null;
  this._url = null;
};


Channel.prototype.write = function(data, prio) {
  if (!this.writable) {
    throw new Error('Channel is not writable');
  }

  prio = prio || 0;

  if (prio < 0 || prio > 7 || isNaN(prio)) {
    throw new Error('Bad priority, expected Number between 0-7');
  }

  validatePayload(data);

  return this._writeOut(OP_DATA, prio, data);
};


Channel.prototype.dispatch = function(data) {
  if (!this.emitable) {
    throw new Error('Channel is not emitable.');
  }

  validatePayload(data);

  return this._writeOut(OP_SIGNAL, FLAG_EMIT, data);
};


Channel.prototype.end = function(data) {
  this.destroy(data);
};


Channel.prototype.destroy = function(data) {

  if (this._destroyed || this._closing || !this._path) {
    return;
  }

  if (data) {
    validatePayload(data);
  }

  this.readable = false;
  this.writable = false;
  this.emitable = false;
  this._closing = true;

  if (this._connecting) {
    this._endsig = data;
  } else {
    this._writeOut(OP_SIGNAL, FLAG_END, data);
  }
};


// Internal write method to write raw packets.
Channel.prototype._writeOut = function(op, flag, data) {
  var frame;

  if (this._writeQueue) {
    this._writeQueue.push(new WriteReq(op, flag, data));
    return false;
  }

  if (this._connecting) {
    this._writeQueue = [new WriteReq(op, flag, data)];
    return false;
  }

  frame = createFrame(this._ptr, op, flag, data);

  try {
    return this._connection.write(frame);
  } catch (writeError) {
    return false;
  }
};


function WriteReq(op, flag, data) {
  this.op = op;
  this.flag = flag;
  this.data = data;
}


// Represents a server connection.
function Connection(url) {
  events.EventEmitter.call(this);

  this.url = url;
  this.refcount = 0;
  this.channels = {};
  this.routes = {};
  this.socket = null;
  this.connecting = false;
  this.connected = false;
  this.request = null;

  this.keepAliveTimer = null;
  this.lastSentMessage = 0;
}


util.inherits(Connection, events.EventEmitter);


Connection.prototype._onsocket = function(socket) {
  var self = this;
  var channels = this.channels;
  var frame;

  this.request = null;

  socket.setNoDelay(true);

  if (typeof socket.setKeepAlive == 'function') {
    socket.setKeepAlive(true);
  }

  socket.on('drain', function() {
    var routes = self.routes;
    var channel;

    for (var ptr in routes) {
      channel = routes[ptr];
      channel.emit('drain');
    }
  });

  socket.on('error', function(err) {
    self.socket = null;
    self.destroy(err);
  });

  socket.on('close', function(hadError) {
    if (hadError == false) {
      self.socket = null;
      self.destroy(new Error('Connection reset by server'));
    }
  });

  this.socket = socket;
  this.connected = true;

  try {
    for (var path in channels) {
      if (channels[path]._resolved == false) {
        channels[path]._resolved = true;
        frame = createFrame(0, OP_RESOLVE, 0, path);
        this.write(frame);
      }
    }
  } catch (writeError) {
    this.destroy(writeError);
    return;
  }

  process.nextTick(function () {
    socket.resume();
    parserImplementation(self);
    self.startKeepAliveTimer();
  });
};


Connection.prototype.createChannel = function(path, mode, data) {
  var channel;
  var frame;

  if (path in this.channels) {
    throw new Error("Channel already created");
  }

  mode = getBinMode(mode);

  if (typeof mode !== 'number') {
    throw new Error('Invalid mode');
  }

  channel = new Channel(this, path, mode, data);

  this.channels[path] = channel;
  this.refcount++;

  // Do not send request if socket isnt handshaked yet
  if (this.connected) {
    channel._resolved = true;
    frame = createFrame(0, OP_RESOLVE, 0, path);
    try {
      this.write(frame);
    } catch (writeError) {
      this.destroy(writeError);
      return;
    }
  }

  if (this.connecting == false) {
    this.connect();
  }

  return channel;
};


Connection.prototype.destroyChannel = function(channel, data) {

  if (typeof channel._path !== 'string') {
    return;
  }

  delete this.channels[channel._path];

  if (typeof channel._ptr == 'number') {
    delete this.routes[channel._ptr];
  }
  
  channel._onend(data);

  this.refcount--;

  if (this.refcount == 0) {
    this.destroy();
  }
};


Connection.prototype.connect = function() {
  var self = this;
  var requestOptions;
  var request;
  var urlobj;

  if (this.connected || this.connecting) {
    throw new Error('Socket already connecting/connected');
  }

  this.connecting = true;

  urlobj = parseUrl(this.url);

  requestOptions = {
    port: urlobj.port || (urlobj.protocol == 'http:' ? 80 : 443),
    host: urlobj.hostname,
    headers: {
      'Connection': 'Upgrade',
      'Upgrade':    PROTOCOL_VERSION,
    },
    agent: false
  };

  if (exports.agent) {
    requestOptions.headers['User-Agent'] = exports.agent;
  }

  if (exports.origin) {
    requestOptions.headers['Origin'] = exports.origin;
  }

  if (urlobj.protocol == 'http:') {
    request = http.request(requestOptions);
  } else {
    request = https.request(requestOptions);
  }

  request.on('response', function(res) {
    res.on('end', function() {
      self.destroy(new Error('Expected 101 Upgrade'));
    });
  });

  request.on('error', function(err) {
    self.destroy(err);
  });

  request.on('upgrade', function(res, socket) {
    self.connecting = false;
    socket.setTimeout(0);
    socket.removeAllListeners('error');
    socket.removeAllListeners('close');

    if (res.headers['upgrade'] != PROTOCOL_VERSION) {
      self.destroy(new Error('Bad protocol version ' + res.headers['upgrade']));
    } else {
      self._onsocket(socket);
    }
  });
  
  request.end();

  this.request = request;
};


// Write a `Packet` to the underlying socket.
Connection.prototype.write = function(frame) {
  if (this.socket) {
    this.lastSentMessage = Date.now();
    return this.socket.write(frame);
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
      frame = createFrame(0, OP_HEARTBEAT, 0);
      try {
        self.write(frame);
      } catch (writeError) {
        self.destroy(writeError);
      }
    }
  }, 5000);
};


Connection.prototype.processOpen = function(ptr, flag, data) {
  var channel;

  if (!(channel = this.routes[ptr])) {
    this.destroy(new Error('Server sent an open response to unknown'));
    return;
  }

  if (flag == FLAG_ALLOW) {
    channel._onopen(data);
  } else {
    this.destroyChannel(channel, new OpenError(data));
  }
};


Connection.prototype.processData = function(ptr, flag, data) {
  var routes = this.routes;
  var channel;
  var clone;

  if (ptr === ALL_CHANNELS) {
    for (var chanptr in routes) {
      channel = routes[chanptr];
      if (channel.readable && channel._connected) {
        clone = new Buffer(data.length);
        data.copy(clone);
        channel.emit('data', clone);
      }
    }
  } else if ((channel = routes[ptr])) {
    if (channel.readable && channel._connected) {
      channel.emit('data', data);
    }
  }
};


Connection.prototype.processSignal = function(ptr, flag, data) {
  var routes = this.routes;
  var frame;
  var clone;
  var channel;

  switch (flag) {

    case FLAG_EMIT:
      if (ptr === ALL_CHANNELS) {
        for (var chanptr in routes) {
          channel = routes[chanptr];
          if (channel._connected) {
            clone = new Buffer(data.length);
            data.copy(clone);
            try {
              channel.emit('signal', clone);
            } catch (emitErr) {
              this.destroyChannel(channel);
            }
          }
        }
      } else if ((channel = routes[ptr])) {
        if (channel._connected) {
          try {
            channel.emit('signal', data);
          } catch (emitErr) {
            this.destroyChannel(channel);
          }
        }
      }
      break;

    case FLAG_END:
    case FLAG_ERROR:
      if (ptr === ALL_CHANNELS) {
        if (flag == FLAG_END) {
          this.destroy(data);
        } else {
          this.destroy(new SignalError(data));
        }
        return;
      }

      if (!(channel = routes[ptr])) {
        // Protocol violation. Channel does not exists in client. Ignore
        // for now.

        return;
      }

      if (channel._closing) {
        // User requested to close this channel. This ENDSIG is a
        // response to that request. It is now safe to destroy
        // channel. Note: We are intentionally not sending the message
        // to the function, because channel is closed according
        // to client.

        this.destroyChannel(channel);
      } else {
        // Server closed this channel. We need to respond with a
        // ENDSIG in order to let server now that we received this
        // signal.

        try {
          frame = createFrame(ptr, OP_SIGNAL, FLAG_END);
          this.write(frame);
        } catch (writeError) {
          this.destroy(writeError);
          return;
        }

        if (flag == FLAG_END) {
          this.destroyChannel(channel, data);
        } else {
          this.destroyChannel(channel, new SignalError(data));
        }
      }
      break;

    default:
      this.destroy(new Error('Server sent an unknown SIGFLAG'));
      return;
  }
};


Connection.prototype.processResolve = function(ptr, flag, data) {
  var channel;
  var frame;
  var path;

  if (!data || data.length == 0) {
    this.destroy(new Error('Server sent a bad resolve response'));
    return;
  }

  if (Buffer.isBuffer(data)) {
    try {
      path = data.toString();
    } catch (err) {
      this.destroy(new Error('Server sent a bad resolve response'));
      return;
    }
  } else {
    path = data;
  }

  if ((channel = this.channels[path])) {

    if (channel._closing) {
      this.destroyChannel(channel);
      return;
    }

    if (flag != FLAG_ALLOW) {
      this.destroyChannel(channel, new Error("ERR_UNABLE_TO_RESOLVE_PATH"));
      return;
    }

    this.routes[ptr] = channel;
    channel._ptr = ptr;

    frame = createFrame(ptr, OP_OPEN, channel._mode, channel._token);

    try {
      this.write(frame);
    } catch (writeError) {
      this.destroy(writeError);
      return;
    }
  }
};


// Destroy connection with optional Error
Connection.prototype.destroy = function(data) {
  var channels = this.channels;
  var channel;

  if (!this.url) {
    return;
  }

  this.url = null;
  this.connecting = false;
  this.connected = false;
  this.channels = {};
  this.routes = {};
  this.refcount = 0;

  for (var path in channels) {
    if ((channel = channels[path])) {
      channel._onend(data);
    }
  }

  if (this.keepAliveTimer) {
    clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = null;
  }

  if (this.socket) {
    this.socket.destroy();
    this.socket = null;
  }

  if (this.request) {
    try {
      this.request.abort();
    } catch (err) {
    } finally {
      this.request = null;
    }
  }

  this.emit('close');
};


function OpenError(data) {
  Error.captureStackTrace(this, this);
  try {
    this.message = data.toString('utf8');
  } catch (encodingError) {
  }
  this.data = data;
}

util.inherits(OpenError, Error);

OpenError.prototype.name = 'Open error';


function SignalError(data) {
  Error.captureStackTrace(this, this);
  try {
    this.message = data.toString('utf8');
  } catch (encodingError) {
  }
  this.data = data;
}

util.inherits(SignalError, Error);
SignalError.prototype.name = 'signal error';


function createFrame(ptr, op, flag, data) {
  var frame;
  var pload;
  var length;
  var ctype;

  ctype = PAYLOAD_TYPE_TEXT;
  length = 5;

  if (typeof data == 'string') {
    pload = new Buffer(data, 'utf8');
    length += pload.length;
  } else if (Buffer.isBuffer(data)) {
    pload = data;
    ctype = PAYLOAD_TYPE_BINARY;
    length += pload.length;
  }

  frame = new Buffer(2 + length);
  frame[0] = (length & 0xff00) >>> 8;
  frame[1] = length & 0x00ff;
  frame[2] = (ptr >>> 24) & 0xff;
  frame[3] = (ptr >>> 16) & 0xff;
  frame[4] = (ptr >>> 8) & 0xff;
  frame[5] = ptr & 0xff;
  frame[6] = (ctype << CTYPE_BITPOS) | (op << OP_BITPOS) | flag;

  if (pload) {
    pload.copy(frame, 7);
  }

  return frame;
}


function validatePayload(data) {
  var length;

  if (typeof data == 'string') {
    length += Buffer.byteLength(data, 'utf8');
  } else if (Buffer.isBuffer(data)) {
    length = data.length;
  } else {
    throw new Error("Unsupported data type");
  }

  if (length > PAYLOAD_MAX_SIZE) {
    throw new Error('Payload overflow');
  }
}


function parserImplementation(conn) {
  var buffer = null;
  var offset = 0;
  var length = 0;

  conn.socket.ondata = function(chunk, start, end) {
    var tmpbuff;
    var packetlen;
    var data;
    var ctype;
    var ptr;
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

    while (offset < length && conn.url) {

      if (offset + 2 > length) {
        // We have not received the length yet
        break;
      }

      packetlen = buffer[offset] << 8 | buffer[offset + 1];

      if (packetlen < 0x5) {
        // Size is lower then packet header. Destroy wire
        return conn.destroy(new Error('bad packet size'));
      }

      if (offset + packetlen > length) {
        // We have not received the whole packet yet. Wait for
        // more data.
        break;
      }

      offset += 2;

      ptr = (buffer[offset + 1] << 16 |
             buffer[offset + 2] << 8 |
             buffer[offset + 3]) + (buffer[offset] << 24 >>> 0);

      desc = buffer[offset + 4];

      ctype = (desc & CTYPE_BITMASK) >> CTYPE_BITPOS;
      op = (desc & OP_BITMASK) >> OP_BITPOS;
      flag = (desc & FLAG_BITMASK);

      if ((offset + packetlen) - (offset + 5)) {
        if (ctype == PAYLOAD_TYPE_TEXT) {
          try {
            data = buffer.toString('utf8', offset + 5, offset + packetlen);
          } catch (err) {
            conn.destroy(err);
            return;
          }
        } else {
          data = buffer.slice(offset + 5, offset + packetlen);
        }
      }

      switch (op) {

        case OP_HEARTBEAT:
          break;

        case OP_OPEN:
          conn.processOpen(ptr, flag, data);
          break;

        case OP_DATA:
          conn.processData(ptr, flag, data);
          break;

        case OP_SIGNAL:
          conn.processSignal(ptr, flag, data);
          break;

        case OP_RESOLVE:
          conn.processResolve(ptr, flag, data);
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


function createConnectionUrl(urlobj) {
  var result;

  result = [urlobj.protocol, '//', urlobj.hostname];

  if (urlobj.port) {
    result.push(':' + urlobj.port);
  }

  return result.join('');
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

  return url;
}
