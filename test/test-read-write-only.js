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
  });
  stream.on("close", function() {
    process.nextTick(parttwo);
  });
  throws(function() {
    stream.write(payload);
  });
  stream.end();
}

function parttwo() {
  stream = createTestStream("w");
  stream.on("connect", function() {
    ok(!this.readable);
    ok(this.writable);
    equal(this.readyState, "writeOnly");
  });
  stream.on("data", function() {
    throw new Error("Should not populate data");
  })
  doesNotThrow(function() {
    stream.write(payload);
  });
  setTimeout(function() {
    shutdown();
  }, 500);
}

process.nextTick(partone);