var equal               = require("assert").equal;
var timeout             = require("./common").timeout;
var shutdown            = require("./common").shutdown;
var createTestChannel    = require("./common").createTestChannel;

var chan;
var payload;
var count = 0;

timeout(5000);

chan = createTestChannel("rw+e");
chan.setEncoding("utf8");
chan.on("connect", function() {
  chan.dispatch("ping");
});
chan.on("signal", function(data) {
  equal(data, "pong");
  chan.destroy();
});
chan.on("close", function() {
  shutdown();
});
