var Buffer          = require('buffer').Buffer;
var hydna           = require('../index');

exports.TEST_HOST     = process.env['TEST_ADDRESS'] || 'testing.hydna.net';
exports.TEST_CH       = exports.TEST_HOST + '/x112233';

var timer = null;

exports.createTestChannel = function(mode, ignoreErrors) {
  var url = exports.TEST_CH;
  var chan;

  if (typeof ignoreErrors == 'string') {
    url = exports.TEST_HOST + '/' + ignoreErrors;
    ignoreErrors = false;
  }

  chan = hydna.createChannel(url, mode);

  if (ignoreErrors) {
    chan.on('error', function() { });
  }

  return chan;
}

exports.shutdown = function() {
  clearTimeout(timer);
  process.exit();
}

exports.timeout = function(timeout) {
  timer = setTimeout(function() {
    throw new Error('Timeout reached');
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