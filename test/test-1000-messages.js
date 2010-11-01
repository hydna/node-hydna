const throws              = require("assert").throws
    , timeout             = require("./common").timeout
    , shutdown            = require("./common").shutdown
    , createTestStream    = require("./common").createTestStream
    , createPayload       = require("./common").createPayload

var stream;
var payload;
var count = 0;

timeout(2000);

payload = createPayload(512);
stream = createTestStream("rw");
stream.on("connect", function() {
  for(var i = 0; i < 1000; i++) {
    stream.write(payload);
  }
});
stream.on("data", function(data) {
  if (++count == 1000) {
    stream.end();
  }
});
stream.on("close", function() {
  shutdown();
});
