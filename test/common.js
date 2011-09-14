const Buffer          = require("buffer").Buffer
    , Stream          = require("../index").Stream

exports.TEST_ZONE     = "localhost:7010";
exports.TEST_ADDR     = exports.TEST_ZONE + "/x112233";
// 
var timer = null;

exports.createTestStream = function(mode, ignoreErrors) {
  var stream = new Stream();
  stream.connect(exports.TEST_ADDR, mode);
  if (ignoreErrors) {
    stream.on("error", function() { });
  }
  return stream;
}

exports.shutdown = function() {
  clearTimeout(timer);
  process.exit();
}

exports.timeout = function(timeout) {
  timer = setTimeout(function() {
    throw new Error("Timeout reached");
  }, timeout);
}

exports.streamErrHandler = function(exception) {
  throw exception;
}

exports.createPayload = function(size) {
  var payload = new Buffer(size);
  var index = size;
  
  while (index--) {
    payload[index] = Math.floor(Math.random() * 256);
  }
  
  return payload
}

exports.compareBuffers = function(bufferA, bufferB) {
  var index = bufferA.length;
  
  if (index != bufferB.length) {
    return false;
  }
  
  while (index--) {
    if (bufferA[index] != bufferB[index]) {
      return false;
    }
  }
  
  return true;
}