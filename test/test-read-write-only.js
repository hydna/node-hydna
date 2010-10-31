const ok                  = require("assert").ok
    , throws              = require("assert").throws
    , doesNotThrow        = require("assert").doesNotThrow
    , equal               = require("assert").equal
    , timeout             = require("./common").timeout
    , shutdown            = require("./common").shutdown
    , createTestStream    = require("./common").createTestStream
    , createPayload       = require("./common").createPayload

var stream;
var payload;

timeout(5000);

payload = createPayload(100);

function partone() {
  stream = createTestStream("r");
  stream.on("connect", function() {
    ok(this.readable);
    ok(!this.writable);
    equal(this.readyState, "readOnly");
    stream.end();
  });
  stream.on("close", function() {
    process.nextTick(parttwo);
  });
  throws(function() {
    stream.write(payload);
  });
}

function parttwo() {
  stream = createTestStream("w");
  stream.on("connect", function() {
    ok(!this.readable);
    ok(this.writable);
    equal(this.readyState, "writeOnly");
  });
  stream.on("drain", function() {
    setTimeout(function() {
      stream.end();
    }, 200);
  });
  stream.on("data", function() {
    throw new Error("Should not populate data");
  });
  stream.on("close", function() {
    shutdown();
  });
  stream.write(payload);
}

process.nextTick(partone);