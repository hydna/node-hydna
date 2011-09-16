var throws              = require("assert").throws;
var timeout             = require("./common").timeout;
var shutdown            = require("./common").shutdown;
var createTestChannel   = require("./common").createTestChannel;
var createPayload       = require("./common").createPayload;

var chan;
var payload;

timeout(200);

payload = createPayload(10241);
chan = createTestChannel("rw");
chan.on("connect", function() {
  throws(function() {
    chan.write(payload);
  });
  chan.destroy();
});
chan.on("close", function() {
  shutdown();
});
