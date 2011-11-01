var ok                  = require("assert").ok;
var throws              = require("assert").throws;
var doesNotThrow        = require("assert").doesNotThrow;
var equal               = require("assert").equal;
var timeout             = require("./common").timeout;
var shutdown            = require("./common").shutdown;
var createTestChannel   = require("./common").createTestChannel;
var createPayload       = require("./common").createPayload;

var chan;
var payload;

timeout(5000);

payload = createPayload(100);

function partone() {
  chan = createTestChannel("r");
  chan.on("connect", function() {
    ok(this.readable);
    ok(!this.writable);
    equal(this.readyState, "read");
    chan.destroy();
  });
  chan.on("close", function() {
    process.nextTick(parttwo);
  });
  throws(function() {
    chan.write(payload);
  });
}

function parttwo() {
  chan = createTestChannel("w");
  chan.on("connect", function() {
    ok(!this.readable);
    ok(this.writable);
    equal(this.readyState, "write");
  });
  chan.on("drain", function() {
    chan.destroy();
  });
  chan.on("data", function() {
    throw new Error("Should not populate data");
  });
  chan.on("close", function() {
    shutdown();
  });
  chan.write(payload);
}

process.nextTick(partone);