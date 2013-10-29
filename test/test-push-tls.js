var assert              = require('assert');
var hydna               = require('../index');

var common              = require('./common');

var host;


common.timeout(5000);

process.nextTick(testSend);

host = 'https://' + common.TEST_HOST;

function testSend() {
  hydna.send(host, 'Testdata', function(err) {
    assert.ifError(err);
    testSendDeny();
  });
}


function testSendDeny() {
  hydna.send(host + '/open-deny', 'Testdata', function(err) {
    assert.ok(err instanceof hydna.OpenError);
    assert.equal(err.message, 'DENIED');
    testEmit();
  });  
}


function testEmit() {
  hydna.dispatch(host, 'Testdata', function(err) {
    assert.ifError(err);
    testEmitDeny();
  });  
}


function testEmitDeny() {
  hydna.dispatch(host + '/open-deny', 'Testdata', function(err) {
    assert.ok(err instanceof hydna.OpenError);
    assert.equal(err.message, 'DENIED');
    common.shutdown();
  });  
}