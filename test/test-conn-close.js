const ok                  = require("assert").ok
    , equal               = require("assert").equal
    , throws              = require("assert").throws
    , timeout             = require("./common").timeout
    , shutdown            = require("./common").shutdown
    , createTestStream    = require("./common").createTestStream

timeout(1000);

function partone() {
  var stream;
  var errorraised;
  stream = createTestStream("rw");
  stream.on("connect", function() {
    this._connection.destroy(new Error("Test Error"));
  });
  stream.on("error", function(exception) {
    equal(exception.message, "Test Error");
    errorraised = true;
  });
  stream.on("close", function() {
    ok(errorraised);
    equal(this._connection, null);
    process.nextTick(parttwo);
  });
}

function parttwo() {
  var stream;
  var errorraised;
  stream = createTestStream("rw");
  stream.on("connect", function() {
    this._connection.sock.end();
  });
  stream.on("error", function(exception) {
    equal(exception.message, "Connection reseted by server");
    errorraised = true;
  });
  stream.on("close", function() {
    ok(errorraised);
    equal(this._connection, null);
    shutdown();
  });
}

process.nextTick(partone);