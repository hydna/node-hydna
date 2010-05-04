//
// Interface for working with Wink Remote TCP connections
//
var sys     = require("sys"),
    net     = require("net");
    Buffer  = require("buffer").Buffer;

var EventEmitter  = require("events").EventEmitter;
    
const PAD_NONE = exports.PAD_NONE = 'none';
const PAD_LEFT = exports.PAD_LEFT = 'left';
const PAD_RIGHT = exports.PAD_RIGHT = 'right';

const DEFAULT_PORT = 7010;
const DEFAULT_HOST = "127.0.0.1";

const HEADER_LENGTH = 11;    

// OTHER
const PING      = 0x01;  // Ping

// CLIENT COMMANDS
const OPENL     = 0x02;  // Open Live
const OPENBL    = 0x03;  // Open BackLog
const EMIT      = 0x04;  // Emit to a channel
const CLOSE     = 0x05;  // Close a Channel without closing the actuall socket.

// SERVER EVENTS
const OPENSTAT  = 0x06;  // Open STATUS
const RTDATA    = 0x07;  // Realtime data
const DATA      = 0x08;  // Time-based data
const INTERRUPT = 0x09;  // A channel is interrupted

// Channel modes
const READ      = 0x01;
const WRITE     = 0x02;
const READWRITE = 0x03;

const BIN = "binary";

const NULL_ADDR = "\x00\x00\x00\x00\x00\x00\x00\x00";

var connections = {};

/**
 *  Open a stream
 */
exports.open = function(hexaddr, mode, options) {
  options = options || {};
  mode = mode || "r";
  var addr = exports.binaddr(hexaddr);
  var port = options.port || DEFAULT_PORT;
  var host = options.host || DEFAULT_HOST;
  var live = options.live || true;
  var token = options.token || null;
  var serverid = host + ':' + port;
  var connection = connections[serverid];
  var stream = null;
  
  function sendOpen() {

    if (live) {
      var openPacket = new Buffer(12 + (token ? token.length : 0));
      openPacket[0] = Math.floor(openPacket.length / 256) & 0xff;
      openPacket[1] = openPacket.length % 256;
      openPacket[2] = OPENL;
      openPacket.write(addr, "binary", 3)
      openPacket[11] = mode == "r" ? READ : mode == "w" ? WRITE : READWRITE;

      if (token) {
        openPacket.write(token, "ascii", 12);
      }

      connection.write(openPacket);
    }
  }
  
  if (!connection) {
    connection = createServerConnection(port, host, function() {
      sendOpen();
    });
    
    connections[serverid] = connection;
  } else {
    if (connection.readyState == "opening") {
      connection.addListener("connect", function() {
        sendOpen();
      });
    } else {
      sendOpen();
    }
  }
  
  if (connection.openStreams[addr]) {
    throw new Error("Stream is already opened.");
  }
  
  stream = new Stream(connection, addr, live, mode);
  
  stream.addListener("close", function() {
    connection.openStreams[addr] = undefined;
  })

  connection.openStreams[addr] = stream;
  
  return stream;
}

/**
 *  Converts a binaddr into a hexaddr
 */
exports.hexaddr = function(addr) {
  if (addr == null) {
    return hexaddr(ADDR_NULL);
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
  return result.join(':');
}

/**
 *  Converts a hexaddr into a binaddr
 */
exports.binaddr = function(hex_addr, pad) {
  var hex = hex_addr.replace(/\:/g, '');
  var padding = pad || PAD_NONE;
  
  if ([PAD_LEFT, PAD_RIGHT, PAD_NONE].indexOf(padding) == -1) {
    throw 'Uknown padding method: ' + padding;
  }
  
  if (hex.length > 16) {
    throw 'Key is larger then 16 chars';
  }
  
  if (padding != PAD_NONE) {
    while (hex.length < 16) {
      hex = padding == PAD_LEFT ? '0' + hex : hex + '0';
    }
  }
  
  var buffer = [];
  var comp = null;
  
  while (hex.length && (comp = hex.substr(0, 4))) {
    var intComp = parseInt(comp, 16);
    buffer.push(String.fromCharCode(Math.floor(intComp / 256) & 0xff));
    buffer.push(String.fromCharCode(intComp % 256));
    hex = hex.substr(4);
  }
  
  return buffer.join('');
}

function Stream(conn, addr, live, mode) {
  var self = this;
  
  self.readyState = "opening";
  self.addr = addr;
  self.originalAddr = addr;
  self.readable = (mode.indexOf("r") != -1);
  self.writable = (mode.indexOf("w") != -1);
  self.live = live;
  
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

sys.inherits(Stream, EventEmitter);

/**
 *  Write a message to stream
 */
Stream.prototype.write = function(data, encoding) {

  if (!this.writable) {
    throw new Error("Stream is not writable");
  }
  
  var header = new Buffer(11);
  var length = typeof data === "string" ? Buffer.byteLength(data, encoding) : data.length;
  length += header.length;
  header[0] = Math.floor(length / 256) & 0xff;
  header[1] = length % 256;
  header[2] = EMIT;

  header.write(this.addr, "binary", 3);
  
  this.conn.write(header);
  
  if (typeof data === "string") {
    this.conn.write(data, encoding || "binary");
  } else {
    this.conn.write(data);
  }  
}

Stream.prototype.end = function(data) {
  if (this.readyState == "closed") {
    return;
  }
  
  if (data) {
    this.write(data);
  }

  var header = new Buffer(11);
  header[pos] = Math.floor(header.length / 256) & 0xff;
  header[pos + 1] = header.length % 256;
  header[pos + 2] = CLOSE;

  header.write(this.addr, "binary", pos + 3);
  self.conn.write(data);
  self.emit("close", 0);
}

function createServerConnection(port, host, callback) {
  var connection = net.createConnection(port, host);
  var READ_BUFFER_LENGTH = 4096 * 12;
  var buffer = new Buffer(READ_BUFFER_LENGTH);
  var bufferLen = 0;
  var bufferPos = 0;
  var headerParsed = false;
  var packetLength = 0;
  var packetFlag = 0;
  var packetAddr = null;
  var header = null;

  connection.setTimeout(0);
  connection.setNoDelay(true);
  
  connection.openStreams = {};
  
  connection.addListener("connect", callback);

  connection.addListener("data", function(data) {
    var tempBuffer = null;
    var currentSize = null;
    
    if (bufferLen + data.length > buffer.length) {
      currentSize = bufferLen - bufferPos;
      tempBuffer = new Buffer(currentSize + data.length);

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

        if (bufferPos + HEADER_LENGTH > bufferLen) {
          return;
        }
        
        packetLength = (buffer[bufferPos] * 256) + 
                            buffer[bufferPos + 1];
        packetFlag = buffer[bufferPos + 2];
      }

      if (bufferPos + packetLength > bufferLen) {
        return;
      }
      
      var packetAddr = buffer.toString(BIN, bufferPos + 3, bufferPos + 11);
      
      switch (packetFlag) {
        
        case OPENSTAT:
        
          if (connection.openStreams[packetAddr]) {
            var stream = connection.openStreams[packetAddr];
            
            var code = buffer[bufferPos + 11];
            var responseAddr = buffer.toString(BIN, bufferPos + 12, bufferPos + 20);

            switch (code) {

              case 1:
                stream.emit("connect", code, packetAddr);
                break;
                
              case 2:
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
          
        case RTDATA:
          if (connection.openStreams[packetAddr]) {
            var packetSlice = buffer.slice(bufferPos + 11, bufferPos + packetLength);
            connection.openStreams[packetAddr].emit("data", packetSlice);
          }
          break;
      }

      bufferPos += packetLength;
      header = null;
    }
  });
 
  return connection;
}