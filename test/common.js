var crypto                    = require('crypto');
var os                        = require('os');

var hydna                     = require('../index');


exports.TEST_HOST             = process.env['TEST_ADDRESS'] ||
                                'testing.hydna.net';

exports.TEST_CH               = exports.TEST_HOST + '/x112233';


exports.createTestChannel     = createTestChannel;

exports.timeout               = timeout;
exports.shutdown              = shutdown;
exports.createPayload         = createPayload;
exports.compareBuffers        = compareBuffers;
exports.uniqueUrl             = uniqueUrl;
exports.uniquePath            = uniquePath;


var timer = null;


function createTestChannel (mode, ignoreErrors, secure) {
  var url;
  var chan;

  if (typeof ignoreErrors == 'string') {
    url = exports.TEST_HOST + '/' + ignoreErrors;
    ignoreErrors = false;
    if (secure) {
      url = 'https://' + url;
    }
  } else {
    url = uniqueUrl(secure ? 'https:/' : 'http:/', exports.TEST_HOST);
  }

  chan = hydna.createChannel(url, mode);

  if (ignoreErrors) {
    chan.on('error', function() { });
  }

  return chan;
}


function shutdown () {
  clearTimeout(timer);
  process.exit();
}


function timeout (timeout) {
  timer = setTimeout(function() {
    throw new Error('Timeout reached');
  }, timeout);
}


function createPayload (size) {
  var payload = new Buffer(size);
  var index = size;

  while (index--) {
    payload[index] = Math.floor(Math.random() * 256);
  }

  return payload
}


function compareBuffers (bufferA, bufferB) {
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


function uniquePath () {
  var path = [os.hostname(), crypto.pseudoRandomBytes(64).toString('base64')];
  return path.join('/');
}


function uniqueUrl (protocol, host) {
  var url = [protocol, host, uniquePath()];
  return url.join('/');
}