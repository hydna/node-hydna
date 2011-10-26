var throws              = require("assert").throws;
var timeout             = require("./common").timeout;
var shutdown            = require("./common").shutdown;
var createTestChannel   = require("./common").createTestChannel;
var createPayload       = require("./common").createPayload;

var PAYLOAD_MAX_SIZE    = require("../index").PAYLOAD_MAX_SIZE;

var chan;
var payload;

timeout(5000);

payload = createPayload(PAYLOAD_MAX_SIZE + 1);
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
