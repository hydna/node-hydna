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
    , createConnection      = require("net").createConnection
    , inherits              = require("util").inherits
    , puts                  = require("util").puts

const VERSION               = exports.VERSION   = "1.0rc";

// Handshake related constants
const HANDSHAKE_HEADER      = "\x44\x4E\x41\x31\x30"
      HANDSHAKE_SIZE        = HANDSHAKE_HEADER.length + 1
      HANDSHAKE_CODE_OFF    = 0x05;

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
    , ERR_INVALIDDOMAIN     = 0x12;

const NULLADDR              = exports.NULLADDR  = "\x00\x00\x00\x00" + 
                                                  "\x00\x00\x00\x00";

const OPEN_PACKET_TMPL      = "\x00\x00\x00"
                            + "\x00\x00\x00\x00"
                            + "\x00";
                            
const CLOSE_PACKET_TMPL     = "\x00\x08\x00"
                            + "\x00\x00\x00\x00"
                            + "\x20";
                        
    
const VALID_ENCODINGS_RE    = /^(ascii|utf8|base64|json)/i
    , MODE_RE               = new RegExp("^(r|read){0,1}(w|write){0,1}(?:\\+)"
                                       + "{0,1}(s|signal){0,1}$", "i");

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
  this._closed = false;
  this._connection = null;
  this._mode = null;
  this._writeQueue = null;
  this._encoding = null;
  this._addr = null;
  this._fulladdr = null;
  this._mode = null;

  this.readable = false;
  this.writable = false;
  this.emitable = false;
}

exports.Stream = Stream;
inherits(Stream, EventEmitter);

// Placeholders
Stream.prototype.__ondatahandle = null;
Stream.prototype.__onsignalhandle = null;
Stream.prototype.__onendhandle = null;
Stream.prototype.__ondrainhandle = null;
Stream.prototype.__onerrorhandle = null;
Stream.prototype.__onclosehandle = null;

/**
 *  ### Stream.readyState
 *
 *  Either `'closed'`, `'open'`, `'opening'`, `'readOnly'`, or `'writeOnly'`.
 */
Object.defineProperty(Stream.prototype, 'readyState', {
  get: function () {
    if (this._connecting) {
      return 'opening';
    } else if (this.readable && this.writable) {
      return 'open';
    } else if (this.readable && !this.writable){
      return 'readOnly';
    } else if (!this.readable && this.writable){
      return 'writeOnly';
    } else {
      return 'closed';
    }
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

  if (this._connecting) {
    throw new Error("Already connecting");
  }
  
  connectStream(this, info);
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
  
  if (this._closed) {
    throw new Error("Stream is closed");
  }
  
  if (!addr) {
    throw new Error("Connect to Hydna first");
  }
  
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
 *  ### Stream.sendSignal(data, encoding='utf8', type=0)
 *
 *  Sends data on the stream. The second paramter specifies the encoding in
 *  the case of a string--it defaults to UTF8 encoding.
 *
 *  Returns ´true´ if the entire data was flushed successfully to the 
 *  underlying connection. Returns `false` if all or part of the data was 
 *  queued in user memory. ´'drain'´ will be emitted when the buffer is 
 *  again free.
 */ 
Stream.prototype.sendSignal = function(data) {
  var encoding = (typeof arguments[1] == "string" && arguments[1]);
  var flag = (encoding && arguments[2]) || arguments[1] || 0;
  var addr = this._addr;
  var packet;
  var payload;
  var messagesize;
  
  if (this._closed) {
    throw new Error("Stream is closed");
  }
  
  if (!addr) {
    throw new Error("Connect to Hydna first");
  }
  
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
  
  if (this._closed) {
    throw new Error("Stream is closed");
  }
  
  if (this._connection && data) {
    this.write(data, encoding);
  }
  
  closeStream(this);
}

// Get or create connection for specified domain addr
function allocConnection(info, callback) {
  var zone = info.zone;
  var connection = connectionpool[zone];

  if (connection) {

    if (connection._handshake) {
      connection._streams++;
      callback(null, connection);
    } else {
      handshakeWaithandle(connection, callback);
    }
    
    return;
  } 
    
  connection = disposedconncetions[zone];
    
  if (connection) {
    disposedconncetions[zone] = undefined;
    connectionpool[zone] = connection;
    connection.setTimeout(0);
    connection._streams++;
    callback(null, connection);
    return;
  }

  connection = createConnection(info.port, info.hostname);
  connection._zone = zone;
  connection._streams = 0;
  connection.setNoDelay();
  connection.setKeepAlive(true);
  
  connectionpool[zone] = connection;
  
  connection.on("error", function() {});
  connection.on("close", function(hadError) {

    if (connectionpool[zone] == this) {
      connectionpool[zone] = undefined;
    }

    if (disposedconncetions[zone] == this) {
      disposedconncetions[zone] = undefined;
    }
    
  });
  processHandshake(info, connection);
  handshakeWaithandle(connection, callback);
}

// De-allocate a connection
function deallocConnection(connection) {
  var zone = connection._zone;
  
  if (connection.readyState == "closed") {
    return;
  }
  
  connection._streams--;

  if (connection._streams == 0) {
    connection.setTimeout(5000);
    connection.once("timeout", function() {
      disposedconncetions[zone] = undefined;
      this.end();
    });
    disposedconncetions[zone] = connection;
    connectionpool[zone] = undefined;
  }
}

// Wait for handshake 
function handshakeWaithandle(connection, callback) {
  
  function onhandshake() {
    connection.removeListener("handshake", onhandshake);
    connection.removeListener("onerror", onerror);
    connection.removeListener("onclose", onclose);
    connection._streams++;
    callback(null, connection);
  }
  
  function onerror(exception) {
    callback(exception);
  }
  
  function onclose(hadError) {
    if (!hadError) {
      callback(new Error("Dropped by server"));
    }
  }
  
  connection.on("handshake", onhandshake);
  connection.on("onerror", onerror);
  connection.on("onclose", onclose);
}

// Sends a handshake packet to remote host, and waits for a 
// handshake response.
function processHandshake(info, connection) {
  var cache = "";
  
  function ondata(data) {
    cache += data.toString("binary");
    if (cache.length < HANDSHAKE_SIZE) {
      return;
    } else if (cache.length > HANDSHAKE_SIZE) {
      this.removeListener("data", ondata);
      this.destroy(new Error("Bad handshake response packet."));
    } else {
      this.removeListener("data", ondata);
      if (!data[HANDSHAKE_CODE_OFF] == 0) {
        this.destroy(getErrMessage(data[HANDSHAKE_CODE_OFF]));
      } else {
        connection._handshake = true;
        initConnection(connection);
        this.emit("handshake");
      }
    }
  }
  
  connection.on("connect", function() {
    var packet = new Buffer(HANDSHAKE_HEADER.length + 4);
    packet.write(HANDSHAKE_HEADER, "ascii");
    writeInt32(info.zone, packet, HANDSHAKE_CODE_OFF);
    this.write(packet);
    this.on("data", ondata);
  });
}

function initConnection(connection) {
  var readbuffer;
  var readpos = 0;
  
  connection.on("data", function(data) {
    var addr;
    var respaddr;
    var flag;
    var payload;
    var eventname;
    var bufferlength;
    var packetlength;
    
    if (readbuffer) {
      readbuffer = combindBuffers(readbuffer, data, readpos);
    } else {
      readbuffer = data;
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
          if (!payload || !payload.length || payload.length != 4) {
            this.destroy(new Error("Bad open resp"));
            return;
          }
          
          respaddr = (payload[0] * 256 * 256 * 256) +
                     (payload[1] * 256 * 256) +
                     (payload[2] * 256)  + 
                     (payload[3]);
          
          this.emit("openresp", addr, flag, respaddr);
          break;

        case DATA:
          eventname = "_data" + addr;
          if (this._events && this._events[eventname]) {
            this.emit(eventname, payload);
          }
          break;

        case SIGNAL:
          eventname = "_signal" + addr;
          if (this._events && this._events[eventname]) {
            this.emit(eventname, payload, flag);
          }
          break;
                  
        case END:
          if (addr == 0) {
            this.destroy(new Error(getErrMessage(flag)));
          } else {
            eventname = "_end" + addr;
            if (this._events && this._events[eventname]) {
              this.emit(eventname, flag, payload);
            }
          }
          break;
          
        default:
          this.destroy(new Error("Bad server op"));
          return;
      }

      readpos += packetlength;
    }
    
    if (bufferlength - readpos == 0) {
      readbuffer = null;
    }
  });
}

// Initialize stream
function initStream(self, connection, addr) {
  var queue = self._writeQueue;
  var flushed = false;
  var packet;
  var oldaddr;
  
  if (self._closed) {
    return;
  }
  
  self.__ondatahandle = function(data) {
    var encoding = self._encoding;
    var graph;
    
    if (encoding) {
      if (encoding == "json") {
        try {
          graph = JSON.parse(data.toString("utf8"));
        } catch (exception) {
          closeStream(self, exception);
          return;
        }
        self.emit("data", graph);
      } else {
        self.emit("data", data.toString(encoding));
      }
    } else {
      self.emit("data", data);
    }    
  }
  
  self.__ondrainhandle = function() {
    self.emit("drain");
  }

  self.__onsignalhandle = function(data, type) {
    self.emit("signal", data, type);
  }

  self.__onendhandle = function(code, data) {
    var exception;
    if (code) {
      new Error(getErrMessage(code, data.toString("utf8")));
      
    }
    closeStream(self, exception, true);
  }
  
  self.__onerrorhandle = function(exception) {
    closeStream(self, exception);
  }
  
  self.__onclosehandle = function(hadError) {
    !hadError && closeStream(self, new Error("Unknown Internal Error"));
  }
  
  connection.on("_data" + addr, self.__ondatahandle);
  connection.on("_signal" + addr, self.__onsignalhandle);
  connection.on("_end" + addr, self.__onendhandle);
  connection.on("drain", self.__ondrainhandle);
  connection.on("error", self.__onerrorhandle);
  connection.on("close", self.__onclosehandle);

  self._connecting = false;
  
  self.readable = ((self._mode & READ) == READ);
  self.writable = ((self._mode & WRITE) == WRITE);
  self.emitable = ((self._mode & EMIT) == EMIT);
  
  self._writeQueue = null;
  self._connection = connection;
  
  if (queue && queue.length) {
    for (var i = 0, l = queue.length; i < l; i++) {
      packet = queue[i];
      if (addr != self._addr) {
        writeInt32(addr, packet, ADDR_OFFSET);
      }
      flushed = writeStream(self, packet);
    }
  }

  self._addr = addr;
  self._fulladdr = connection._addr + addr;
  
  self.emit("connect");
  
  if (flushed) {
    self.emit("drain");
  }
}

// Connect stream with connection
function connectStream(self, info) {
  
  self._mode = info.binmode;
  self._addr = info.stream;
  self._connecting = true;
  
  allocConnection(info, function(err, connection) {

    if (err) {
      closeStream(self, err);
      return;
    }
    
    if (self._closed) {
      return;
    }
    
    processOpen(connection, info, function(err, respaddr) {
      
      if (err) {
        closeStream(self, err);
        return;
      }
      
      if (self._closed) {
        return;
      }
      
      initStream(self, connection, respaddr);
    });
  });
}

// Internal write method to write raw packets.
function writeStream(self, packet) {
  var written;
  
  if (self._writeQueue) {
    self._writeQueue.push(packet);
    return false;
  }
  if (self._connecting) {
    self._writeQueue = [packet];
    return false;
  } else if (self._connection.fd && self._connection.writable) {
    return self._connection.write(packet);
  } else {
    closeStream(self, new Error("Stream is not writable"));
    return flase;
  }
}


// Internal close method to finalize stream.
function closeStream(self, exception, ended) {
  var connection = self._connection;
  var addr = self._addr;
  var packet;

  if (self._closed) {
    return;
  }
  
  if (connection) {
    connection.removeListener("_data" + addr, self.__ondatahandle);
    connection.removeListener("_signal" + addr, self.__ondatahandle);
    connection.removeListener("_end" + addr, self.__onendhandle);
    connection.removeListener("error", self.__onerrorhandle);
    connection.removeListener("close", self.__onclosehandle);
    
    if (!exception && connection.writable && !ended) {
      packet = new Buffer(CLOSE_PACKET_TMPL, "binary");
      writeInt32(addr, packet, ADDR_OFFSET);
      writeStream(self, packet);
    }
    
    deallocConnection(connection);
    self._connection = null;
  }


  // pendingends[self._fulladdr] = true;

  self._closed = true;
  self._connecting = false;
  self._writeQueue = undefined;
  self._addr = undefined;

  self.readable = false;
  self.writable = false;
  self.emitable = false;
  
  exception && self.emit("error", exception);

  self.emit("close", exception !== undefined);
}

// Combinds two buffers into a new buffer
function combindBuffers(bufferA, bufferB, offset) {
  var lengthA = bufferA.length - offset;
  var newbuffer = new Buffer(lengthA + bufferB.length);
  bufferA.copy(newbuffer, 0, offset);
  bufferB.copy(newbuffer, lengthA, 0);
  return newbuffer;
}

// Sends a open request to remote host, and waits for a open response.
function processOpen(connection, info, callback) {
  var packet;
  var tokenl;
  var messagesize;
  
  function post() {
    messagesize = OPEN_PACKET_TMPL.length + info.token.length;

    packet = new Buffer(messagesize);
    packet[LENGTH_OFFSET    ] = Math.floor(messagesize / 256) & 0xff
    packet[LENGTH_OFFSET + 1] = messagesize % 256
    packet[OP_OFFSET        ] = OPEN << 4 | info.binmode;
    writeInt32(info.stream, packet, ADDR_OFFSET);

    if (info.token.length) {
      info.token.copy(packet, PAYLOAD_OFFSET, 0);
    }

    try {
      connection.write(packet);
    } catch (err) {
      process.nextTick(onclose);
    }
  }
  
  function onopenresp(addr, errcode, respaddr) {

    if (addr != info.stream) {
      return;
    }
    
    connection.removeListener("error", onerror);
    connection.removeListener("openresp", onopenresp);
    connection.removeListener("close", onclose);

    if (errcode) {
      callback(new Error(getErrMessage(errcode)));
    } else {
      callback(null, respaddr);
    }
  }
  
  function onerror(exception) {
    callback(exception);
  }
  
  function onclose(hadError) {
    !hadError && callback(new Error("Connection to server closed"));
  }
  
  function onend() {
    connection.removeListener("end" + info.stream, onend);
    post();
  }
  
  connection.on("openresp", onopenresp);
  connection.on("error", onerror);
  connection.on("close", onclose);
  
  if (pendingends[info.stream]) {
    connection.on("end" + info.stream, onend);
  } else {
    post();
  }
}

// Returns the binary representation of a mode expression. Returns null
// on invalid mode.
function getBinMode(modeExpr) {
  var result = 0;
  var match;

  if (!modeExpr || (typeof modeExpr !== "string") || 
      !(match = modeExpr.match(MODE_RE))) {
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
  
  if (!binmode) {
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