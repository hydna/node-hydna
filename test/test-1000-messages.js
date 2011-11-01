var ok                  = require("assert").ok;
var timeout             = require("./common").timeout;
var shutdown            = require("./common").shutdown;
var createTestChannel   = require("./common").createTestChannel;
var createPayload       = require("./common").createPayload;
var compareBuffers      = require("./common").compareBuffers;

var chan;
var payload;
var count = 0;

timeout(5000);

payload = createPayload(512);
chan = createTestChannel("rw");
chan.on("connect", function() {
  for(var i = 0; i < 1000; i++) {
    chan.write(payload);
  }
});
chan.on("data", function(data) {
  ok(compareBuffers(payload, data));
  if (++count == 1000) {
    chan.destroy();
  }
});
chan.on("close", function() {
  shutdown();
});
