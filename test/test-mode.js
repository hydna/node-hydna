const doesNotThrow        = require("assert").doesNotThrow
    , throws              = require("assert").throws
    , timeout             = require("./common").timeout
    , shutdown            = require("./common").shutdown
    , createTestStream    = require("./common").createTestStream

timeout(2000);

throws(function() {
  createTestStream("readwrite-signal");
});

throws(function() {
  createTestStream("not valid");
});

doesNotThrow(function() {
  createTestStream(null).end();
  createTestStream("r").end();
  createTestStream("r+e").end();
  createTestStream("r+emit").end();
  createTestStream("read").end();
  createTestStream("read+e").end();
  createTestStream("read+emit").end();
  createTestStream("w").end();
  createTestStream("w+e").end();
  createTestStream("w+emit").end();
  createTestStream("write").end();
  createTestStream("write+e").end();
  createTestStream("write+emit").end();
  createTestStream("rw").end();
  createTestStream("rw+e").end();
  createTestStream("rw+emit").end();
  createTestStream("readwrite").end();
  createTestStream("readwrite+e").end();
  createTestStream("readwrite+emit").end();
});

shutdown();