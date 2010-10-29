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


const HANDSHAKE_HEADER      = "\x44\x4E\x41\x31\x30"
      HANDSHAKE_SIZE        = HANDSHAKE_HEADER.length + 1
      HANDSHAKE_CODE_OFF    = 0x05;

// Stream modes
const READ                  = 0x01
    , WRITE                 = 0x02
    , READWRITE             = 0x03;

// Packet related offset's
const LENGTH_OFFSET         = 0x00
    , RESERV_OFFSET         = 0x02
    , ADDR_OFFSET           = 0x03
    , OP_OFFSET             = 0x0B
    , PAYLOAD_OFFSET        = 0x0C;

// Packet related sizes
const HEADER_SIZE           = 0x0C
    , LENGTH_SIZE           = 0x02
    , MAX_PAYLOAD_SIZE      = 10240
    , MAX_PACKET_SIZE       = HEADER_SIZE + MAX_PACKET_SIZE
    , MIN_PACKET_SIZE       = HEADER_SIZE

// Address related sizes
const ADDR_SIZE             = 16
    , PART_SIZE             = 8
    , COMP_SIZE             = 2
    , HEX_ADDR_SIZE         = 32
    , HEX_COMP_SIZE         = 4;
    
// Client opcodes
const OPEN                  = 0x01
    , CLOSE                 = 0x02
    , EMIT                  = 0x03
    , META                  = 0x05;

// Server opcodes
const OPENRESP              = 0x01
    , DATA                  = 0x03
    , SIGNAL                = 0x04
    , METARESP              = 0x05
    , ERROR                 = 0x0f;

const HYDNA_HOST            = "tcp.hydna.net"
    , HYDNA_PORT            = 7010
                          
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
                                                  "\x00\x00\x00\x00" +
                                                  "\x00\x00\x00\x00" +
                                                  "\x00\x00\x00\x00";

const OPEN_PACKET_TMPL      = "\x00\x00\x00"
                            + "\x00\x00\x00\x00\x00\x00\x00\x00"
                            + "\x00";
    
    
const VALID_ENCODINGS_RE    = /^ascii$|^utf8$|^base64$|^json$/;
                          
var connectionpool = {};

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
 *  
 */
function Stream() {
  this._connecting = false;
  this._opening = false;
  this._closing = false;
  this._connection = null;
  this._mode = null;
  this._writeQueue = null;
  this._encoding = null;
  this._binaddr = null;
  this._mode = null;

  this.readable = false;
  this.writable = false;
}

exports.Stream = Stream;
inherits(Stream, EventEmitter);

// Placeholders
Stream.prototype.__ondatahandle = null;
Stream.prototype.__onclosehandle = null;

/**
 *  ### Stream.readyState
 *
 *  Either 'closed', 'open', 'opening', 'readOnly', or 'writeOnly'.
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
 *  Example:
 *  
 *      var Stream = require("hydna").Stream;
 *      var stream = new Stream("00000000000111100000011", "read");
 *      stream.write("Hello World!");
 */
Stream.prototype.connect = function(addr, mode, token) {
  var self = this;
  var info = parseInfo(addr, mode, token);

  if (this._connecting) {
    throw new Error("Already connecting");
  }
  
  retrieveConnection(info, function(err, connection) {
    if (err) {
      self._cleanup(err);
      return;
    }
    
    connection._pendingStreams++;

    processOpen(connection, info, function(err, respaddr) {
      var queue = self._writeQueue;
      var packet;
      
      connection._pendingStreams--;
      
      if (err) {
        self._cleanup(err);
        return;
      }
      
      self._binaddr = respaddr;
      self._connection = connection;
      self._connecting = false;
      self._writeQueue = null;
      
      if (queue && queue.length) {
        for (var i = 0, l = queue.length; i < l; i++) {
          packet = queue[i];
          if (respaddr != info.streamaddr) {
            packet.write(respaddr, ADDR_OFFSET, "binary");
          }
          self._write(packet);
        }
      }

      self._onconnect();
    });
  });
  
  this._mode = info.binmode;
  this._binaddr = info.streamaddr;
  this._connecting = true;
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
  var packet;
  var payload;
  var messagesize;
  
  if (this._closing) {
    throw new Error("Stream is closed (closing)");
  }
  
  if (!this._binaddr) {
    throw new Error("Connect to Hydna first");
  }
  
  if (!this._mode || this._mode == READ) {
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
  packet[OP_OFFSET        ] = EMIT << 4 | flag;
  packet.write(this._binaddr, ADDR_OFFSET, "binary");
  payload.copy(packet, PAYLOAD_OFFSET, 0);
  
  return this._write(packet);
}

/**
 *  ### Stream.end([data], [encoding])
 *
 *  Closes stream for reading and writing.
 */
Stream.prototype.end = function(data, encoding) {
  
  if (this._closing) {
    throw new Error("Stream is already closing");
  }
  
  if (this._connection && data) {
    this.write(data, encoding);
  }
  
  this._cleanup();
}

Stream.prototype._onconnect = function() {
  var self = this;
  var encoding = this._encoding;
  var connection = this._connection;
  
  if (self._closing) {
    if (connection._pendingStreams == 0 && connection._streams == 0) {
      connection.end();
    }
    return;
  }
  
  self.__ondatahandle = function(data) {
    if (encoding) {
      if (encoding == "json") {
        self.emit("data", JSON.parse(data.toString("utf8")));
      } else {
        self.emit("data", data.toString(encoding));
      }
    } else {
      self.emit("data", data);
    }    
  }

  self.__onsignalhandle = function(type, data) {
    self.emit("signal", type, data);
  }
  
  self.__onerrorhandle = function(exception) {
    self._cleanup(exception, true);
  }
  
  self.__onclosehandle = function() {
     self._cleanup(new Error("Unknown Internal Error"), true);
  }
  
  connection.on("_d" + self._binaddr, self.__ondatahandle);
  connection.on("_s" + self._binaddr, self.__onsignalhandle);
  connection.on("error", self.__onerrorhandle);
  connection.on("close", self.__onclosehandle);
  
  connection._streams++;
  
  this.readable = ((this._mode & READ) == READ);
  this.writable = ((this._mode & WRITE) == WRITE);
  
  self.emit("connect");  
}


// Internal close method to finalize stream.
Stream.prototype._cleanup = function(exception, closedByConnection) {
  var connection = this._connection;
  
  if (this._closing) {
    return;
  }
  
  this._closing = true;
  this._connecting = false;
  this._writeQueue = null;

  this.readable = false;
  this.writable = false;

  if (connection) {

    connection.removeListener("_d" + this._binaddr, this.__ondatahandle);
    connection.removeListener("_s" + this._binaddr, this.__ondatahandle);
    connection.removeListener("error", this.__onerrorhandle);
    connection.removeListener("close", this.__onclosehandle);
    
    connection._streams--;
    
    if (!closedByConnection && --connection._streams == 0) {
      connection._disposed = true;
      connection.end();
    }
    
    this._connection = null;
  }
  
  exception && this.emit("error", exception);
  
  this.emit("close");
}

// Internal write method to write raw packets.
Stream.prototype._write = function(packet) {
  var written;
  
  if (this._writeQueue) {
    this._writeQueue.push(packet);
    return false;
  }
  if (this._connecting) {
    this._writeQueue = [packet];
    return false;
  } else {
    try {
      return this._connection.write(packet);
    } catch (err) {
      this._cleanup(err);
      return false;
    }
  }  
}

// Get or create connection for specified domain addr
function retrieveConnection(info, callback) {
  var connection = connectionpool[info.domainaddr];
  console.log("RETRUEVE CONNETION--->");
  console.log("Connection? " + connection);
  if (connection && connection._handshake && !connection._disposed) {
    process.nextTick(function() {
      callback(null, connection);
    });
  } else {
    console.log("ignore direct p");
    function onhandshake() {
      connection.removeListener("error", callback);
      connection._handshake = true;
      initConnection(connection);
      callback(null, connection);
    }
    
    function makeConnection() {
      connection = connectionpool[info.domainaddr];
      if (connection && connection._handshake) {
        callback(null, connection);
      } else if (connection) {
        connection.on("error", callback);
        connection.on("handshake", onhandshake);
      } else {
        console.log("Connect to %s", info.hostname);
        connection = createConnection(info.port, info.hostname);
        connection._streams = 0;
        connection._pendingStreams = 0;
        connection.setNoDelay();
        connection.setKeepAlive(true);
        connectionpool[info.domainaddr] = connection;
        connection.on("close", function() {
          connectionpool[info.domainaddr] = undefined;
        });
        processHandshake(info, connection);        
      }
    }
    
    if (!connection) {
      makeConnection();
    } else if (connection._disposed) {
      console.log("disposed");
      connection.on("close", makeConnection);
    } else {
      console.log("wait for handshake");
      connection.on("error", callback);
      connection.on("handshake", onhandshake);
    }
  }  
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
        this.emit("handshake");
      }
    }
  }
  
  connection.on("connect", function() {
    this.write(HANDSHAKE_HEADER + info.domainaddr);
    this.on("data", ondata);
  });
}

function initConnection(connection) {
  var readbuffer;
  var readpos = 0;
  
  connection.on("data", function(data) {
    var addr;
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
        return;
      }

      packetlength = (readbuffer[readpos] * 256) + readbuffer[readpos + 1];
      
      if (readpos + packetlength > bufferlength) {
        return;
      }

      addr = readbuffer.toString("binary", readpos + ADDR_OFFSET, 
                                           readpos + ADDR_OFFSET + PART_SIZE);
      flag = (readbuffer[readpos + OP_OFFSET] & 0xf);
      payload = readbuffer.slice(readpos + PAYLOAD_OFFSET, 
                                 readpos + packetlength);

      switch (readbuffer[readpos + OP_OFFSET] >> 4) {

        case OPENRESP:
          this.emit("openresp", addr, flag, payload.toString("binary"));
          break;

        case DATA:
          eventname = "_d" + addr;
          if (this._events && this._events[eventname]) {
            this.emit(eventname, payload);
          }
          break;

        case SIGNAL:
          eventname = "_s" + addr;
          if (this._events && this._events[eventname]) {
            this.emit(eventname, flag, payload);
          }
          break;
          
        // TODO
        case METARESP: break;

        case ERROR:
          this.destroy(getErrMessage(readbuffer[readpos + OP_OFFSET] & 0xf));
          break;
      }

      readpos += packetlength;
    }

    if (readbuffer.length - readpos == 0) {
      readbuffer = null;
    }
  });
}

// Combinds two buffers into a new buffer
function combindBuffers(bufferA, bufferB, offset) {
  var newbuffer = new Buffer((bufferA.length - offset) + bufferB.length);
  bufferA.copy(newbuffer, 0, offset);
  bufferB.copy(newbuffer, bufferA.length, 0);
  return newbuffer;
}

// Sends a open request to remote host, and waits for a open response.
function processOpen(connection, info, callback) {
  var packet;
  var tokenl;
  var messagesize;

  function onopenresp(addr, errcode, respaddr) {
    console.log("here:" + addr + " .. " + info.streamaddr);
    if (addr != info.streamaddr) {
      return;
    }
    console.log("here<-")
    
    connection.removeListener("openresp", onopenresp);
    connection.removeListener("close", onclose);

    if (errcode) {
      callback(new Error(getErrMessage(errcode)));
    } else {
      callback(null, respaddr);
    }
  }
  
  function onclose() {
    connection.removeListener("openresp", onopenresp);
    connection.removeListener("close", onclose);

    callback(new Error("Connection to server closed"));
  }
  
  connection.on("openresp", onopenresp);
  connection.on("close", onclose);
  
  messagesize = OPEN_PACKET_TMPL.length + info.token.length;
  
  packet = new Buffer(messagesize);
  packet[LENGTH_OFFSET    ] = Math.floor(messagesize / 256) & 0xff
  packet[LENGTH_OFFSET + 1] = messagesize % 256
  packet[OP_OFFSET        ] = OPEN << 4 | info.binmode;
  packet.write(info.streamaddr, ADDR_OFFSET, "binary");
  
  if (info.token.length) {
    info.token.copy(packet, PAYLOAD_OFFSET, 0);
  }
  
  try {
    connection.write(packet);
  } catch (err) {
    process.nextTick(onclose);
  }
}


// Parse address and split it up in multi components.
function parseInfo(addr, mode, token) {
  var binaddr;
  var hostaddr;
  var binmode;
  var tokenbuffer;
  
  switch (mode.toLowerCase()) {
    case "r":
    case "read":
      binmode = READ;
      break;
    case "w":
    case "write":
      binmode = WRITE;
      break;
    default:
      binmode = READWRITE;
      break;
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

  binaddr = exports.binaddr(addr);
  hostaddr = exports.hexaddr(binaddr, "").substr(0, HEX_ADDR_SIZE / 2);
  
  return {
    hostname: hostaddr + "." + HYDNA_HOST,
    port: HYDNA_PORT,
    domainaddr: binaddr.substr(0, PART_SIZE),
    streamaddr: binaddr.substr(PART_SIZE),
    token: tokenbuffer,
    binmode: binmode
  }
}

// Return openstat error message based on errorcode;
function getErrMessage(errcode, message) {
  switch (errcode) {
    case ERR_UNKNOWN:       return "Unknown Error";
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


/**
 *  Converts an Hydna Address from the binary format and into the hexa 
 *  decimal format.
 *
 *  @param {BinAddress} addr The binary formatted address to convert.
 *  @param {String} delimiter The delimiter to use between keypairs. Default
 *                            is ´:´.
 */
exports.hexaddr = function(addr, delimiter) {
  if (addr == null) {
    return exports.hexaddr(NULLADDR);
  }
  var index = addr.length;
  var result = [];
  while (index--) {
    var comp = (addr.charCodeAt(index) + 
                addr.charCodeAt(--index) * 256).toString(16);

    while (comp.length < 4) {
      comp = '0' + comp;
    }

    result.unshift(comp);
  }
  return result.join(delimiter === undefined ? ':' : delimiter);
}

/**
 *  Converts an Hydna Address from the hexa-decimal format and into the binary
 *  format.
 *
 *  @param {HexAddress} addr The hexa-formatted address to convert.
 *  @param {PAD_ENUM} pad The padding routine to use.
 *  @param {Number} expectedLength The expected length of the key. Default
 *                                 value is ´16´.
 */
exports.binaddr = function(hex_addr, pad, expectedLength) {
  if (!hex_addr) return;

  var hex = hex_addr.replace(/\:/g, '');
  var padding = pad || "none";
  var expLength = expectedLength || HEX_ADDR_SIZE;

  if (["left", "right", "none"].indexOf(padding) == -1) {
    throw 'Uknown padding method: ' + padding;
  }

  if (hex.length > HEX_ADDR_SIZE) {
    // Key is larger then HEX_ADDR_SIZE chars
    return undefined;
  }

  if (padding != "none") {
    while (hex.length < HEX_ADDR_SIZE) {
      hex = padding == "left" ? '0' + hex : hex + '0';
    }
  } else if (hex.length < expectedLength) {
    return undefined;
  }

  var buffer = [];
  var comp = null;

  while (hex.length && (comp = hex.substr(0, HEX_COMP_SIZE))) {
    var intComp = parseInt(comp, 16);
    buffer.push(String.fromCharCode(Math.floor(intComp / 256) & 0xff));
    buffer.push(String.fromCharCode(intComp % 256));
    hex = hex.substr(HEX_COMP_SIZE);
  }

  return buffer.join('');
}