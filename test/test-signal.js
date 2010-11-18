const equal               = require("assert").equal
    , timeout             = require("./common").timeout
    , shutdown            = require("./common").shutdown
    , createTestStream    = require("./common").createTestStream

var stream;
var payload;
var count = 0;

timeout(2000);

stream = createTestStream("rw+e");
stream.on("connect", function() {
  stream.sendSignal("ping");
});
stream.on("signal", function(data, type) {
  equal(type, 10);
  equal(data, "pong");
  stream.end();
});
stream.on("close", function() {
  shutdown();
});
