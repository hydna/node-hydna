var ok                  = require("assert").ok;
var equal               = require("assert").equal;
var throws              = require("assert").throws;
var timeout             = require("./common").timeout;
var shutdown            = require("./common").shutdown;
var createTestChannel   = require("./common").createTestChannel;
var chanErrHandler      = require("./common").chanErrHandler;

var chan;

timeout(5000);

chan = createTestChannel("rw");
chan.on("connect", function() {
  ok(this.readable);
  ok(this.writable);
  equal(this.readyState, "readwrite");
  chan.destroy();
});
chan.on("close", function() {
  shutdown();
});
