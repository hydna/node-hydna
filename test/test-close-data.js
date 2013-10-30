var assert                    = require('assert');
var common                    = require('./common');

var MESSAGE                   = "CLOSE_MESSAGE";
var emitListener;
var closingChannel;

common.timeout(5000);

emitListener = common.createTestChannel('read', '');
closingChannel = common.createTestChannel('read', 'emit-back-on-close');

closingChannel.on('connect', function() {
  this.end(MESSAGE);
});

emitListener.on('signal', function(data) {
  assert.equal(MESSAGE, data);
  this.end();
});

emitListener.on('close', function () {
  common.shutdown();
});