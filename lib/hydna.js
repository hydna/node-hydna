/** 
 *        Copyright 2010 Hydna AB. All rights reserved.
 *
 *  Redistribution and use in source and binary forms, with or without 
 *  modification, are permitted provided that the following conditions 
 *  are met:
 *
 *    1. Redistributions of source code must retain the above copyright notice, 
 *       this list of conditions and the following disclaimer.
 *
 *    2. Redistributions in binary form must reproduce the above copyright 
 *       notice, this list of conditions and the following disclaimer in the 
 *       documentation and/or other materials provided with the distribution.
 *
 *  THIS SOFTWARE IS PROVIDED BY HYDNA AB ``AS IS'' AND ANY EXPRESS 
 *  OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED 
 *  WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE 
 *  ARE DISCLAIMED. IN NO EVENT SHALL HYDNA AB OR CONTRIBUTORS BE LIABLE FOR 
 *  ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL 
 *  DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR 
 *  SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) 
 *  HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT 
 *  LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY 
 *  OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF 
 *  SUCH DAMAGE.
 *
 *  The views and conclusions contained in the software and documentation are 
 *  those of the authors and should not be interpreted as representing 
 *  official policies, either expressed or implied, of Hydna AB.
 */
 
const Buffer              = require("buffer").Buffer
    , EventEmitter        = require("events").EventEmitter
    , createConnection    = require("net").createConnection
    , inherits            = require("sys").inherits
    , puts                = require("sys").puts

const VERSION             = exports.VERSION   = "1.0";

const DEFAULT_PORT        = 7120
    , DEFAULT_HOST        = "127.0.0.1";

const HEADER_SIZE         = 20
    , EMIT_MAX_SIZE       = 2048 - HEADER_SIZE;

const PAD_NONE            = exports.PAD_NONE  = 'none'
    , PAD_LEFT            = exports.PAD_LEFT  = 'left'
    , PAD_RIGHT           = exports.PAD_RIGHT = 'right';

const ADDR_SIZE           = 16
    , PART_SIZE           = 8
    , COMP_SIZE           = 2
    , HEX_ADDR_SIZE       = 32
    , HEX_COMP_SIZE       = 4;


// Protocol related constants
const PING                = 0x01

    , OPEN                = 0x02
    , EMIT                = 0x04
    , CLOSE               = 0x05

    , OPENSTAT            = 0x06
    , RTDATA              = 0x07
    , DATA                = 0x08
    , INTERRUPT           = 0x09;


// Channel modes
const READ                = 0x01
    , WRITE               = 0x02
    , READWRITE           = 0x03;

const BIN                 = "binary";

const NULLADDR            = exports.NULLADDR  = "\x00\x00\x00\x00" + 
                                                "\x00\x00\x00\x00" +
                                                "\x00\x00\x00\x00" +
                                                "\x00\x00\x00\x00";

var connections = {};

/**
 *  Open a stream to the Hydna network.
 *
 *  This function always return immediately, whatever or not the openening
 *  request succeded or not. Use event handlers on the return {@link Stream} 
 *  object instead.
 *
 *  @param addr     {String}  the hydna address to open. Can be in either a  
 *                            hexa-decimal format or the binary format.
 *  @param mode     {String}  the mode to open
 *  @param options  {Object}  additional options
 *
 *  @return         {Stream}  the stream wrapper
 *
 *  @example
 *    var hydna = require("hydna");
 *    var puts  = require("sys").puts;
 *
 *    var stream = hydna.open("00000000FFFFFFFF00000000AAAAAAAA", "read");
 *    
 *    stream.addListener("data", function(data) {
 *      puts("Received: " + data.toString());
 *    });
 */
exports.open = function(addr, mode, options) {
  options = options || {};
  mode = mode || "r";
  var addr = validateAddr(addr);
  var port = options.port || DEFAULT_PORT;
  var host = options.host || DEFAULT_HOST;
  var token = options.token || null;
  var serverid = host + ':' + port;
  var connection = connections[serverid];
  var stream = null;
  
  function sendopen() {
    var openPacket = new Buffer(HEADER_SIZE + 1 + (token ? token.length : 1));
    openPacket[0] = Math.floor(openPacket.length / 256) & 0xff;
    openPacket[1] = openPacket.length % 256;
    openPacket[2] = OPEN;
    openPacket[3] = 0;
    openPacket.write(addr, "binary", 4)
    openPacket[20] = mode == "r" ? READ : mode == "w" ? WRITE : READWRITE;

    if (token) {
      openPacket.write(token, "ascii", 21);
    } else {
      openPacket[openPacket.length - 1] = 0;
    }
    
    connection.write(openPacket);
  }
  
  if (!connection) {
    connection = createServerConnection(port, host, sendopen);
    connections[serverid] = connection;
  }  else if (connection.readyState == "opening") {
    connection.addListener("connect", sendopen);
  } else {
    sendopen();
  }
  
  if (connection.openStreams[addr]) {
    throw new Error("Stream is already opened.");
  }
  
  stream = new Stream(connection, addr, mode);
  
  stream.addListener("close", function() {
    connection.openStreams[addr] = undefined;
  })

  connection.openStreams[addr] = stream;
  
  return stream;
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
    return hexaddr(NULLADDR);
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
  var padding = pad || PAD_NONE;
  var expLength = expectedLength || HEX_ADDR_SIZE;

  if ([PAD_LEFT, PAD_RIGHT, PAD_NONE].indexOf(padding) == -1) {
    throw 'Uknown padding method: ' + padding;
  }

  if (hex.length > HEX_ADDR_SIZE) {
    // Key is larger then HEX_ADDR_SIZE chars
    return undefined;
  }

  if (padding != PAD_NONE) {
    while (hex.length < HEX_ADDR_SIZE) {
      hex = padding == PAD_LEFT ? '0' + hex : hex + '0';
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

function Stream(conn, addr, mode) {
  var self = this;
  
  self.readyState = "opening";
  self.addr = addr;
  self.originalAddr = addr;
  self.readable = (mode.indexOf("r") != -1);
  self.writable = (mode.indexOf("w") != -1);
  
  self.addListener("connect", function() {
    self.readyState = self.readable && self.writable ? "open" : 
                      self.readable ? "readOnly" : "writeOnly";
    
  });

  self.addListener("end", function(code) {
    self.readyState = "closed";
    self.readable = false;
    self.writable = false;
  });
  
  self.conn = conn;
}

inherits(Stream, EventEmitter);

/**
 *  Write a message to stream
 */
Stream.prototype.write = function(data, encoding) {

  if (!this.readyState == "open" && !this.readyState == "writeOnly") {
    throw new Error("Stream is not open/writable");
  }
  
  var header = new Buffer(HEADER_SIZE);
  var length = typeof data === "string" ? Buffer.byteLength(data, encoding) : data.length;

  length += header.length;
  header[0] = Math.floor(length / 256) & 0xff;
  header[1] = length % 256;
  header[2] = EMIT;
  header[3] = 0;

  header.write(this.addr, "binary", 4);
  
  this.conn.write(header);
  
  if (typeof data === "string") {
    this.conn.write(data, encoding || "binary");
  } else {
    this.conn.write(data);
  }  
}

/**
 *  Closes stream for reading and writing.
 *
 *  @param  {Object}  an optional data packet to emit to stream before sending
 *                    the CLOSE paket.
 */
Stream.prototype.end = function(data) {
  
  if (this.readyState == "closed") {
    return;
  }
  
  if (data) {
    this.write(data);
  }

  var header = new Buffer(HEADER_SIZE);
  header[0] = Math.floor(header.length / 256) & 0xff;
  header[1] = header.length % 256;
  header[2] = CLOSE;
  header[3] = 0;
  header.write(this.addr, "binary", pos + 4);

  self.conn.write(data);
  self.emit("close", 0);
}

function createServerConnection(port, host, callback) {
  var connection = createConnection(port, host);
  var READ_BUFFER_LENGTH = 4096 * 3;
  var buffer = new Buffer(READ_BUFFER_LENGTH);
  var bufferLen = 0;
  var bufferPos = 0;
  var headerParsed = false;
  var packetLength = 0;
  var packetFlag = 0;
  var packetAddr = null;
  var header = null;
  
  // Used for stats
  connection.bufferAllocs = 0;
  connection.bufferCopies = 0;
  connection.bufferMaxSize = 0;

  connection.setTimeout(0);
  connection.setNoDelay(true);
  
  connection.openStreams = {};
  
  connection.addListener("connect", callback);

  connection.addListener("data", function(data) {
    var tempBuffer = null;
    var currentSize = null;
    
    if (bufferLen + data.length > buffer.length) {
      currentSize = bufferLen - bufferPos;
      tempBuffer = new Buffer(Math.max(currentSize + data.length, READ_BUFFER_LENGTH));
      if (bufferPos != bufferLen) {
        buffer.copy(tempBuffer, 0, bufferPos, bufferLen);
        bufferLen = bufferLen - bufferPos;
      } else {
        bufferLen = 0;
      }
      
      bufferPos = 0;
      buffer = tempBuffer;
    }
    
    data.copy(buffer, bufferLen, 0, data.length);
    bufferLen += data.length;
    
    while (bufferPos < bufferLen) {

      if (!headerParsed) {

        if (bufferPos + HEADER_SIZE > bufferLen) {
          return;
        }
        
        packetLength = (buffer[bufferPos] * 256) + 
                            buffer[bufferPos + 1];
        packetFlag = buffer[bufferPos + 2];
        packetReserved = buffer[bufferPos + 3];
        
      }

      if (bufferPos + packetLength > bufferLen) {
        return;
      }
      
      var packetAddr = buffer.toString("binary", bufferPos + 4, bufferPos + HEADER_SIZE);
      
      switch (packetFlag) {
        
        case OPENSTAT:
        
          if (connection.openStreams[packetAddr]) {
            var stream = connection.openStreams[packetAddr];
            var code = buffer[bufferPos + HEADER_SIZE];
            var responseAddr = buffer.toString("binary", bufferPos + HEADER_SIZE + 1, bufferPos + 37);

            switch (code) {

              case 0:
                stream.addr = responseAddr;
                stream.emit("connect", code, responseAddr);
                break;
                
              default:
                stream.emit("error", code);
                break;
            }
          }
          break;
          
        case INTERRUPT:
          // TODO:
          break;
          
        case DATA:
          if (connection.openStreams[packetAddr]) {
            var packetSlice = buffer.slice(bufferPos + HEADER_SIZE, bufferPos + packetLength);

            
            connection.openStreams[packetAddr].emit("data", packetSlice);
          }
          break;
          
        default:
          sys.puts("unkown flag");
          break;
      }

      bufferPos += packetLength;
      header = null;
    }
  });
  
  connection.addListener("end", function() {
  });
 
  return connection;
}


function validateAddr(addr) {
  if (addr.length == ADDR_SIZE) {
    return addr;
  }
  return exports.binaddr(addr);
}