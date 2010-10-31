const throws              = require("assert").throws
    , timeout             = require("./common").timeout
    , shutdown            = require("./common").shutdown
    , createTestStream    = require("./common").createTestStream
    , createPayload       = require("./common").createPayload

var stream;
var payload;

timeout(200);

payload = createPayload(10241);
stream = createTestStream("rw");
stream.on("connect", function() {
  throws(function() {
    stream.write(payload);
  });  
  stream.end();
});
stream.on("close", function() {
  shutdown();
});
