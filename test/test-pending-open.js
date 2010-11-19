const ok                  = require("assert").ok
    , timeout             = require("./common").timeout
    , shutdown            = require("./common").shutdown
    , Stream              = require("../lib/hydna").Stream

const NO_REQUESTS         = 100;
var stream;
var payload;
var count = 0;

timeout(2000);

function onconnect() {
  if (++count == NO_REQUESTS) {
    shutdown();
  }
}

for (var i = 0; i < NO_REQUESTS; i++) {
  stream = new Stream();
  stream.connect("00112233-1", "r");
  stream.on("connect", onconnect);
}