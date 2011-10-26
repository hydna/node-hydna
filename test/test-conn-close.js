var ok                  = require("assert").ok;
var equal               = require("assert").equal;
var throws              = require("assert").throws;
var timeout             = require("./common").timeout;
var shutdown            = require("./common").shutdown;
var createTestChannel    = require("./common").createTestChannel;

timeout(5000);

function partone() {
  var chan;
  var errorraised;
  chan = createTestChannel("rw");
  chan.on("connect", function() {
    this._connection.destroy(new Error("Test Error"));
  });
  chan.on("error", function(exception) {
    equal(exception.message, "Test Error");
    errorraised = true;
  });
  chan.on("close", function() {
    ok(errorraised);
    equal(this._connection, null);
    process.nextTick(parttwo);
  });
}

function parttwo() {
  var chan;
  var errorraised;
  chan = createTestChannel("rw");
  chan.on("connect", function() {
    this._connection.sock.end();
  });
  chan.on("error", function(exception) {
    equal(exception.message, "Connection reseted by server");
    errorraised = true;
  });
  chan.on("close", function() {
    ok(errorraised);
    equal(this._connection, null);
    shutdown();
  });
}

process.nextTick(partone);