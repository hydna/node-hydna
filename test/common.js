const Buffer          = require("buffer").Buffer
    , Stream          = require("../lib/hydna").Stream
    


exports.TEST_ADDR     = "00112233445566778800112233445566";

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