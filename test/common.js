var Buffer          = require("buffer").Buffer;
var Channel         = require("../index").Channel;

exports.TEST_HOST     = process.env["TEST_ADDRESS"] || "localhost:7010";
exports.TEST_CH       = exports.TEST_HOST + "/x112233";

var timer = null;

exports.createTestChannel = function(mode, ignoreErrors) {
  var chan = new Channel();
  var url = exports.TEST_CH;

  if (typeof ignoreErrors == "number") {
    url = exports.TEST_HOST + "/" + ignoreErrors;
    ignoreErrors = false;
  }

  chan.connect(url, mode);

  if (ignoreErrors) {
    chan.on("error", function() { });
  }

  return chan;
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