var assert              = require('assert');
var hydna               = require('../index');

var common              = require('./common');

common.timeout(5000);

process.nextTick(testSend);


function testSend() {
  hydna.send(common.TEST_HOST, 'Testdata', function(err) {
    assert.ifError(err);
    testSendDeny();
  });
}


function testSendDeny() {
  hydna.send(common.TEST_HOST + '/open-deny', 'Testdata', function(err) {
    assert.ok(err instanceof hydna.OpenError);
    assert.equal(err.message, 'DENIED');
    testEmit();
  });  
}


function testEmit() {
  hydna.dispatch(common.TEST_HOST, 'Testdata', function(err) {
    assert.ifError(err);
    testEmitDeny();
  });  
}


function testEmitDeny() {
  hydna.dispatch(common.TEST_HOST + '/open-deny', 'Testdata', function(err) {
    assert.ok(err instanceof hydna.OpenError);
    assert.equal(err.message, 'DENIED');
    common.shutdown();
  });  
}