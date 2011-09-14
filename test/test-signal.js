const equal               = require("assert").equal
    , timeout             = require("./common").timeout
    , shutdown            = require("./common").shutdown
    , createTestStream    = require("./common").createTestStream

var stream;
var payload;
var count = 0;

timeout(2000);

stream = createTestStream("rw+e");
stream.setEncoding("utf8");
stream.on("connect", function() {
  stream.dispatch("ping");
});
stream.on("signal", function(data) {
  equal(data, "pong");
  stream.destroy();
});
stream.on("close", function() {
  shutdown();
});
