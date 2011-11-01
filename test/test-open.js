var ok                  = require("assert").ok;
var equal               = require("assert").equal;
var throws              = require("assert").throws;
var timeout             = require("./common").timeout;
var shutdown            = require("./common").shutdown;
var createTestChannel   = require("./common").createTestChannel;
var chanErrHandler      = require("./common").chanErrHandler;


timeout(5000);


function openWithMessage() {
  var chan;

  chan = createTestChannel("rw", 2);
  chan.on("connect", function(message) {
    equal(message, "OK");
    ok(this.readable);
    ok(this.writable);
    equal(this.readyState, "readwrite");
    chan.destroy();
  });
  chan.on("close", function() {
    process.nextTick(denyWithMessage);
  });
}


function denyWithMessage() {
  var chan;

  chan = createTestChannel("rw", 3);
  chan.on("connect", function(message) {
    throw new Error("Received connect");
  });
  chan.on("error", function(err) {
    equal(err.message, "NOT_ALLOWED");
    chan.destroy();
  });
  chan.on("close", function() {
    shutdown();
  });
}

process.nextTick(openWithMessage);