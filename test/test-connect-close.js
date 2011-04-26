const ok                  = require("assert").ok
    , equal               = require("assert").equal
    , throws              = require("assert").throws
    , timeout             = require("./common").timeout
    , shutdown            = require("./common").shutdown
    , createTestStream    = require("./common").createTestStream
    , streamErrHandler    = require("./common").streamErrHandler

var stream;

timeout(1000);

stream = createTestStream("rw");
stream.on("connect", function() {
  ok(this.readable);
  ok(this.writable);
  equal(this.readyState, "readwrite");
  stream.close();
});
stream.on("close", function() {
  shutdown();
});
