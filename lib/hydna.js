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
 
const Buffer                = require("buffer").Buffer
    , EventEmitter          = require("events").EventEmitter
    , Connection            = require("net").Stream
    , inherits              = require("util").inherits
    , puts                  = require("util").puts

const VERSION               = exports.VERSION   = "1.0rc";

// Handshake related constants
const HANDSHAKE_HEADER      = "\x44\x4E\x41\x31"
      HANDSHAKE_SIZE        = HANDSHAKE_HEADER.length + 1
      HANDSHAKE_CODE_OFF    = 0x04;

// Stream modes
const READ                  = 0x01
    , WRITE                 = 0x02
    , READWRITE             = 0x03
    , EMIT                  = 0x04;

// Packet related offset's
const LENGTH_OFFSET         = 0x00
    , RESERV_OFFSET         = 0x02
    , ADDR_OFFSET           = 0x03
    , OP_OFFSET             = 0x07
    , PAYLOAD_OFFSET        = 0x08;

// Packet related sizes
const HEADER_SIZE           = 0x08
    , LENGTH_SIZE           = 0x02
    , MAX_PAYLOAD_SIZE      = 10240
    , MAX_PACKET_SIZE       = HEADER_SIZE + MAX_PACKET_SIZE
    , MIN_PACKET_SIZE       = HEADER_SIZE

// Address related sizes
const ADDR_SIZE             = 8
    , PART_SIZE             = 4
    , COMP_SIZE             = 2
    , HEX_ADDR_SIZE         = 16
    , HEX_COMP_SIZE         = 4;
    
// Client opcodes
const OPEN                  = 0x01
    , CLOSE                 = 0x02
    , SEND                  = 0x04;

// Server opcodes
const OPENRESP              = 0x01
    , DATA                  = 0x03
    , SIGNAL                = 0x04
    , END                   = 0x0f;
    
    
const SUCCESS               = 0;

const HYDNA_HOST            = "tcp.hydna.net"
    , HYDNA_PORT            = 7010

// Protocol specific error codes                          
const ERR_UNKNOWN           = 0x01
    , ERR_BADFORMAT         = 0x02
    , ERR_MULTIPLEACK       = 0x03
    , ERR_INVALIDOP         = 0x04
    , ERR_OPFLAG            = 0x05
    , ERR_STREAMOPEN        = 0x06
    , ERR_NOTWRITABLE       = 0x07
    , ERR_STREAMNA          = 0x08
    , ERR_OTHER             = 0x0F
    , ERR_SERVERBUSY        = 0x10
    , ERR_BADHANDSHAKE      = 0x11
    , ERR_INVALIDDOMAIN     = 0x12
    , ERR_CUSTOM            = 0x0F;

const OPEN_PACKET_TMPL      = "\x00\x00\x00"
                            + "\x00\x00\x00\x00"
                            + "\x00";
                            
const CLOSE_PACKET_TMPL     = "\x00\x08\x00"
                            + "\x00\x00\x00\x00"
                            + "\x20";
                        
    
const VALID_ENCODINGS_RE    = /^(ascii|utf8|base64|json)/i;
const MODE_RE = /^(r|read){0,1}(w|write){0,1}(?:\+){0,1}(e|emit){0,1}$/i;
const ADDR_EXPR_RE = /^(?:([0-9a-f]{1,8})-|([0-9a-f]{1,8})-([0-9a-f]{1,8}))$/i;

// Global module variables
var connectionpool          = {}
  , disposedconncetions     = {}
  , pendingends             = {}
  
  
/**
 *  ## hydna.createConnection(addr, mode, [token])
 *
 *  Construct a new stream object and opens a stream to the 
 *  specified `'addr'`. 
 *
 *  When the stream is established the `'connect'` event will be emitted.
 */
exports.createConnection = function(addr, mode, token) {
  var stream = new Stream();
  stream.connect(addr, mode, token);
  return stream;
}

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
 *  `function (type, data) { }`
 *
 *  Emitted when remote server send's a signal.
 */ 
function Stream() {
  this._connecting = false;
  this._opening = false;
  this._closing = false;
  this._connection = null;
  this._request = null;
  this._mode = null;
  this._writeQueue = null;
  this._encoding = null;
  this._addr = null;
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
    } else if (!this._addr) {
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
 *  ### Stream.addr
 *
 *  Returns stream `addr` as a string. Property is `null` if not connected.
 */
Object.defineProperty(Stream.prototype, 'addr', {
  get: function () {
    if (this._addr == null || !this._connection) {
      return null;
    }
    
    return toHex(this._connection._zone, 8) + "-" + toHex(this._addr, 8);
  }
});

/**
 *  ### Stream.connect(addr, mode='readwrite', [token])
 *
 *  Opens a stream to the specified ´'addr'´.
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
 *  * +signal - Open stream with send-signal support (e.g. "rw+signal").
 *
 *  Example:
 *  
 *      var createConncetion = require("hydna").createConncetion;
 *      var stream = createConncetion("00000011-00000011", "read");
 *      stream.write("Hello World!");
 */
Stream.prototype.connect = function(addr, mode, token) {
  var info = new StreamInfo(addr, mode, token);
  var packet;
  var messagesize;
  var connection;
  var request;

  if (this._connecting) {
    throw new Error("Already connecting");
  }
  
  connection = getConnection(info);
  connection._streamRefCount++;
  
  this._mode = info.binmode;
  this._addr = info.stream;
  this._connecting = true;
  
  this.readable = ((this._mode & READ) == READ);
  this.writable = ((this._mode & WRITE) == WRITE);
  this.emitable = ((this._mode & EMIT) == EMIT);
  
  messagesize = OPEN_PACKET_TMPL.length + info.token.length;
  
  packet = new Buffer(messagesize);
  packet[LENGTH_OFFSET    ] = Math.floor(messagesize / 256) & 0xff
  packet[LENGTH_OFFSET + 1] = messagesize % 256
  packet[OP_OFFSET        ] = OPEN << 4 | info.binmode;
  writeInt32(info.stream, packet, ADDR_OFFSET);

  if (info.token.length) {
    info.token.copy(packet, PAYLOAD_OFFSET, 0);
  }
  
  request = new OpenRequest(this, info, packet);

  this._connection = connection;
  this._request = request;
  
  openStream(request, connection);
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
  var flag = (encoding && arguments[2]) || arguments[1] || 1;
  var addr = this._addr;
  var packet;
  var payload;
  var messagesize;
  
  if (!this.writable) {
    throw new Error("Stream is not writable");
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
  
  messagesize = HEADER_SIZE + payload.length;
  
  packet = new Buffer(messagesize);
  packet[LENGTH_OFFSET    ] = Math.floor(messagesize / 256) & 0xff
  packet[LENGTH_OFFSET + 1] = messagesize % 256
  packet[OP_OFFSET        ] = DATA << 4 | flag;
  writeInt32(addr, packet, ADDR_OFFSET);
  payload.copy(packet, PAYLOAD_OFFSET, 0);
  
  return writeStream(this, packet);
}

/**
 *  ### Stream.dispatch(data, encoding='utf8', type=0)
 *
 *  Dispatch a signal on the stream. The second paramter specifies the encoding 
 *  in the case of a string--it defaults to UTF8 encoding.
 *
 *  Returns ´true´ if the signal was flushed successfully to the 
 *  underlying connection. Returns `false` if the all or part of the signal 
 *  was queued in user memory. ´'drain'´ will be emitted when the buffer is 
 *  again free.
 */ 
Stream.prototype.dispatch = function(data) {
  var encoding = (typeof arguments[1] == "string" && arguments[1]);
  var flag = (encoding && arguments[2]) || arguments[1] || 0;
  var addr = this._addr;
  var packet;
  var payload;
  var messagesize;
  
  if (!this.emitable) {
    throw new Error("Stream is not emitable.");
  }
  
  if (flag < 0 || flag > 15) {
    throw new Error("Invalid 'type'. Expected a Number between 0 and 15");
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
  
  messagesize = HEADER_SIZE + payload.length;
  
  packet = new Buffer(messagesize);
  packet[LENGTH_OFFSET    ] = Math.floor(messagesize / 256) & 0xff
  packet[LENGTH_OFFSET + 1] = messagesize % 256
  packet[OP_OFFSET        ] = SEND << 4 | flag;
  writeInt32(addr, packet, ADDR_OFFSET);
  payload.copy(packet, PAYLOAD_OFFSET, 0);
  
  return writeStream(this, packet);
}

/**
 *  ### Stream.end([data], [encoding])
 *
 *  Closes stream for reading and writing.
 */
Stream.prototype.end = function(data, encoding) {
  var packet;
  
  if (!this._connection || this._closing || this._addr == null) {
    return;
  }

  if (this._request && !data && 
      cancelOpenStream(this._request, this._connection)) {
    this._request = undefined;
    destroyStream(this);
    return;
  } 
  
  if (data) {
    this.write(data, encoding);
  }
  
  packet = new Buffer(CLOSE_PACKET_TMPL, "binary");
  writeInt32(this._addr, packet, ADDR_OFFSET);
  writeStream(this, packet);
  
  if (!this._request) {
    destroyStream(this);
  } else {
    this.readable = false;
    this.writable = false;
    this.emitable = false;
    this._closing = true;
  }
}

// Get a TCP-connection for specified StreamInfo.
function getConnection(info) {
  var zone = info.zone;
  var connection = connectionpool[zone];
  var datacache = "";
  var lastException;

  if (connection) {
    return connection;
  } 
    
  connection = disposedconncetions[zone];
    
  if (connection) {
    disposedconncetions[zone] = undefined;
    connectionpool[zone] = connection;
    connection.setTimeout(0);
    connection.removeAllListeners("timeout");
    return connection;
  }

  connection = new Connection(); 
  connection._zone = zone;
  connection._streamRefCount = 0;
  connection._openStreams = {};
  connection._pendingOpenRequests = {};
  connection._openWaitQueue = {};
  connection._readbuffer = null;
  connection._readpos = 0;
  connection._connecting = false;
  connection._handshaked = false;
  connection.setNoDelay();
  connection.setKeepAlive(true);
  
  connectionpool[zone] = connection;
  
  // Sends a handshake packet to remote host.
  connection.on("connect", function() {
    var packet = new Buffer(HANDSHAKE_HEADER.length + 4);
    packet.write(HANDSHAKE_HEADER, "ascii");
    writeInt32(info.zone, packet, HANDSHAKE_CODE_OFF);
    this.write(packet);
  });
  
  // Waits for a handshake response.
  connection.ondata = function(data, start, end) {
    var pending = this._pendingOpenRequests;
    var keys;
    
    datacache += data.toString("binary", start, end);
    if (datacache.length < HANDSHAKE_SIZE) {
      return;
    } else if (datacache.length > HANDSHAKE_SIZE) {
      this.destroy(new Error("Bad handshake response packet."));
    } else {
      if (data[HANDSHAKE_CODE_OFF] != 0) {
        this.destroy(getErrMessage(data[HANDSHAKE_CODE_OFF]));
      } else {
        this._handshaked = true;
        this._connecting = false;
        this.ondata = packetParser;
        
        try {
          for (var key in pending) {
            this.write(pending[key].data);
            pending[key].sent = true;
          }
        } catch (writeException) {
          this.destroy(writeException);
          return;
        }
      }
    }
  }
  
  connection.on("drain", function() {
    var streams = this._openStreams;
    var keys = Object.keys(streams);
    var index = keys.length;
    var stream;
    
    while (index--) {
      stream = streams[keys[index]];
      if (stream._events && stream._events["drain"]) {
        stream.emit("drain");
      }
    }
  });

  connection.on("error", function(exception) {
    lastException = exception;
  });
  
  connection.on("close", function(hadError) {
    var streams = this._openStreams;
    var pending = this._pendingOpenRequests;
    var queue = this._openWaitQueue;
    var keys = Object.keys(streams);
    var index = keys.length;
    var stream;
    var request;
    
    if (!hadError) {
      lastException = new Error("Connection closed by server");
    }
    
    while (index--) {
      if ((stream = streams[keys[index]])) {
        destroyStream(stream, lastException);
      }
    }

    keys = Object.keys(pending);
    index = keys.length;

    while (index--) {
      if ((request = pending[keys[index]])) {
        destroyStream(request.stream, lastException);
      }
    }

    keys = Object.keys(queue);
    index = keys.length;

    while (index--) {
      queue[keys[index]].forEach(function(request) {
        if (request) {
          destroyStream(request.stream, lastException);
        }
      });
    }

    this._openStreams = undefined;
    this._pendingOpenRequests = undefined;
    this._openWaitQueue = undefined;

    if (connectionpool[zone] == this) {
      connectionpool[zone] = undefined;
    }

    if (disposedconncetions[zone] == this) {
      disposedconncetions[zone] = undefined;
    }

  });
  
  return connection;
}

// OpenRequest constructor.
function OpenRequest(stream, info, data) {
 this.stream = stream;
 this.info = info;
 this.data = data;
 this.sent = false;
}

// Request to open a stream
function openStream(request, connection) {
  var info = request.info;
  var addr = request.info.stream;
  var openstreams = connection._openStreams;
  var pending = connection._pendingOpenRequests;
  var waitqueue = connection._openWaitQueue;

  if (openstreams[addr]) {
    destroyStream(request.stream, new Error("Stream already open"));
    return;
  }

  if (pending[addr]) {

    if (!waitqueue[addr]) {
      waitqueue[addr] = [];
    }
    
    waitqueue[addr].push(request);
    
  } else {
    pending[addr] = request;
    
    if (!connection._handshaked) {
      if (!connection._connecting) {
        connection._connecting = true;
        connection.connect(info.port, info.hostname);
      }
    } else {
      try {
        connection.write(request.data);
        request.sent = true;
      } catch (writeException) {
        connection.destroy(writeException);
      }
    }

  } 
}

// Cancel an ongoing open request, if possible. Returns `true` on 
// success, else `false`
function cancelOpenStream(request, connection) {
  var streamcomp = request.info.stream;
  var waitqueue = connection._openWaitQueue;
  var pending = connection._pendingOpenRequests;
  var queue;
  
  if (request.sent) {
    return false;
  }
  
  queue = waitqueue[streamcomp];
  
  if (pending[streamcomp]) {
    
    if (queue && queue.length)  {
      pending[streamcomp] = queue.pop();
    } else {
      pending[streamcomp] = undefined;
    }
    
    return true;
  }
  
  // Should not happen...
  if (queue == null) {
    return false;
  }
  
  index = queue.indexOf(request);
  
  if (index != -1) {
    queue.splice(index, 1);
    return true;
  }
  
  return false;
  
}

// Packet parser for TCP-Connections.
function packetParser(data, start, end) {
  var readbuffer = this._readbuffer;
  var readpos = this._readpos;
  var streams = this._openStreams;
  var pending = this._pendingOpenRequests;
  var queue = this._openWaitQueue;
  var target;
  var addr;
  var response;
  var flag;
  var payload;
  var eventname;
  var bufferlength;
  var packetlength;
  var exception;
  
  if (readbuffer) {
    readbuffer = combindBuffers(readbuffer, readpos, data, start, end);
  } else {
    readbuffer = data.slice(start, end);
  }
  
  bufferlength = readbuffer.length;
  readpos = 0;

  while (readpos < bufferlength) {

    if (readpos + LENGTH_SIZE > bufferlength) {
      break;
    }

    packetlength = (readbuffer[readpos] * 256) + readbuffer[readpos + 1];
    
    if (readpos + packetlength > bufferlength) {
      break;
    }
    
    addr = (readbuffer[readpos + ADDR_OFFSET] * 256 * 256 * 256) +
           (readbuffer[readpos + ADDR_OFFSET  + 1] * 256 * 256) +
           (readbuffer[readpos + ADDR_OFFSET  + 2] * 256)  + 
           (readbuffer[readpos + ADDR_OFFSET  + 3]);

    flag = (readbuffer[readpos + OP_OFFSET] & 0xf);
    payload = readbuffer.slice(readpos + PAYLOAD_OFFSET, 
                                 readpos + packetlength);

    switch (readbuffer[readpos + OP_OFFSET] >> 4) {

      case OPENRESP:

        if (!(target = pending[addr])) {
          this.destroy(new Error("Server sent an open response to unknown"));
          return;
        }

        if (flag == SUCCESS) {
          
          if (payload.length != 4) {
            this.destroy(new Error("Bad open resp"));
          }
          
          response = (payload[0] * 256 * 256 * 256) +
                     (payload[1] * 256 * 256) +
                     (payload[2] * 256)  + 
                     (payload[3]);

          streams[response] = target.stream;
          
        } else if (flag == ERR_CUSTOM) {
          response = payload.toString("utf8");
        }
        
        if (queue[addr] && queue[addr].length) {
          
          // Destroy all pending requests IF response wasn't a
          // redirected stream.
          if (flag == SUCCESS && response == addr) {
            pending[addr] = undefined;
            queue[addr].forEach(function(request) {
              destroyStream(request.stream, new Error("Stream already open"));
            });
            return;
          }
          
          pending[addr] = queue[addr].pop();
          
          if (!queue[addr].length) {
            queue[addr] = undefined;
          }
          
          try {
            this.write(pending[addr].data);
            pending[addr].sent = true;
          } catch (writeException) {
            this.destroy(writeException);
            return;
          }
          
        } else {
          pending[addr] = undefined;
        }

        handleOpenResponse(target.stream, flag, response);
        
        break;

      case DATA:
        if ((target = streams[addr])) {
          handleData("data", target, payload);
        } 
        break;

      case SIGNAL:
        if ((target = streams[addr])) {
          handleData("signal", target, payload, flag);
        } 
        break;
                
      case END:
        if (flag) {
          exception = new Error(getErrMessage(code, data.toString("utf8")));
        }
        if (addr == 0) {
          this.destroy(exception);
        } else if ((target = streams[addr])) {
          destroyStream(target, exception);
        }
        break;
        
      default:
        this.destroy(new Error("Server sent bad operator " + (readbuffer[readpos + OP_OFFSET] >> 4)));
        return;
    }

    readpos += packetlength;
  }
  
  if (bufferlength - readpos == 0) {
    this._readbuffer = null;
  } else {
    this._readbuffer = readbuffer;
    this._readpos = readpos;
  }
}

// Internal write method to write raw packets.
function writeStream(stream, packet) {
  var written;

  if (stream._writeQueue) {
    stream._writeQueue.push(packet);
    return false;
  }
  if (stream._connecting) {
    stream._writeQueue = [packet];
    return false;
  } else if (stream._connection.fd && stream._connection.writable) {
    return stream._connection.write(packet);
  } else {
    destroyStream(self, new Error("Stream is not writable"));
    return false;
  }
}

// Internal close method to finalize stream.
function destroyStream(stream, exception) {
  var connection = stream._connection;
  var addr = stream._addr;
  var packet;

  if (addr == null) {
    return;
  }
  
  if (connection) {
    
    if (connection._openStreams[addr] == stream) {
      connection._openStreams[addr] = undefined;
    }
    
    if (!(--connection._streamRefCount)) {
      connection.setTimeout(200);
      connection.once("timeout", function() {
        disposedconncetions[connection._zone] = undefined;
        this.end();
      });
      disposedconncetions[connection._zone] = connection;
      connectionpool[connection._zone] = undefined;
    }

    stream._connection = null;
  }
  
  stream._addr = null;
  stream._connecting = false;
  stream._closing = false;
  stream._writeQueue = undefined;

  stream.readable = false;
  stream.writable = false;
  stream.emitable = false;
  
  exception && stream.emit("error", exception);

  stream.emit("close", exception !== undefined);
}

// Handle OPENRESP sent by server
function handleOpenResponse(stream, flag, response) {
  var flushed = false;
  var queue = stream._writeQueue;

  stream._connecting = false;
  stream._writeQueue = null;
  stream._request = null;
  
  if (flag > 0) {
    destroyStream(stream, new Error(getErrMessage(flag, response)));
    return;
  }
  
  if (queue && queue.length) {
    for (var i = 0, l = queue.length; i < l; i++) {
      packet = queue[i];
      if (response != stream._addr) {
        writeInt32(respaddr, packet, ADDR_OFFSET);
      }
      flushed = writeStream(stream, packet);
    }
  }

  stream._addr = response;
  
  if (stream._closing) {
    destroyStream(stream);
  } else {
    stream.emit("connect");
    if (flushed) {
      stream.emit("drain");
    }
  }
}

// Handle DATA sent by server
function handleData(eventname, stream, data, flag) {
  var encoding = stream._encoding;
  var graph = data;

  if (encoding) {
    if (encoding == "json") {
      try {
        graph = JSON.parse(data.toString("utf8"));
      } catch (exception) {
        destroyStream(stream, exception);
        return;
      }
    } else {
      graph = data.toString(encoding);
    }
  }      
  
  if (stream._events && stream._events[eventname]) {
    stream.emit(eventname, graph, flag);
  }
}

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

// StreamInfo class
function StreamInfo(addrexpr, mode, token) {
  var addrm = ADDR_EXPR_RE(addrexpr);
  var binmode = getBinMode(mode);
  var zonecomp;
  var streamcomp;
  var tokenbuffer;

  if (addrm == null) {
    throw new Error("Expected and addr expression");
  }
  
  if (typeof binmode !== "number") {
    throw new Error("Invalid mode");
  }

  if (addrm[1]) {
    zonecomp = parseInt(addrm[1], 16);
  } else {
    zonecomp = parseInt(addrm[2], 16);
    streamcomp = parseInt(addrm[3], 16);
  }
  
  if (token) {
    if (Buffer.isBuffer(token)) {
      tokenbuffer = token;
    } else {
      tokenbuffer = new Buffer(token, "binary");
    }
  } else {
    tokenbuffer = new Buffer(0);
  }
  
  this.hostname = toHex(zonecomp, 8) + "." + HYDNA_HOST;
  this.port = HYDNA_PORT;
  this.zone = zonecomp;
  this.stream = streamcomp;
  this.token = tokenbuffer;
  this.binmode = binmode;
}

// Return openstat error message based on errorcode;
function getErrMessage(errcode, message) {
  switch (errcode) {
    default:
    case ERR_UNKNOWN:       return "Unknown Server Error";
    case ERR_BADFORMAT:     return "Bad message format";
    case ERR_MULTIPLEACK:   return "Multiple ACK request to same addr";
    case ERR_INVALIDOP:     return "Invalid operator";
    case ERR_OPFLAG:        return "Invalid operator flag";
    case ERR_STREAMOPEN:    return "Stream is already open";
    case ERR_NOTWRITABLE:   return "Stream is not writable";
    case ERR_STREAMNA:      return "Stream is not available";
    case ERR_SERVERBUSY:    return "Server is busy";
    case ERR_BADHANDSHAKE:  return "Bad handshake packet";
    case ERR_INVALIDDOMAIN: return "Invalid domain addr";
    case ERR_OTHER:         return message;
  }
}

// Write int32 to buffer
function writeInt32(value, buffer, offset) {
  buffer[offset] = Math.floor(value / Math.pow(256, 3)) & 0xff;
  buffer[offset + 1] = Math.floor(value / Math.pow(256, 2))  & 0xff;
  buffer[offset + 2] = Math.floor(value / 256) & 0xff;
  buffer[offset + 3] = value % 256;
}

// Converts a Number value into a hex-string. The string is padded until
// radix is meet.
function toHex(value, radix) {
  var r = value.toString(16);
  
  while (r.length < (radix || 8)) {
    r = "0" + r;
  }
  
  return r;
}

// Combinds two buffers into a new buffer
function combindBuffers(bufferA, startA, bufferB, startB, endB) {
  var lengthA = bufferA.length - startA;
  var length = lengthA + (endB - startB);
  var newbuffer = new Buffer(length);
  bufferA.copy(newbuffer, 0, startA);
  bufferB.copy(newbuffer, lengthA, startB, endB);
  return newbuffer;
}