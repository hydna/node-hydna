const doesNotThrow        = require("assert").doesNotThrow
    , throws              = require("assert").throws
    , timeout             = require("./common").timeout
    , shutdown            = require("./common").shutdown
    , createTestStream    = require("./common").createTestStream

throws(function() {
  createTestStream("readwrite-signal");
});

throws(function() {
  createTestStream("not valid");
});

doesNotThrow(function() {
  console.log("Test 1")
  createTestStream(null).destroy();
  console.log("Test 2")
  createTestStream("r").destroy();
  console.log("Test 3")
  createTestStream("r+e").destroy();
  createTestStream("r+emit").destroy();
  createTestStream("read").destroy();
  createTestStream("read+e").destroy();
  createTestStream("read+emit").destroy();
  createTestStream("w").destroy();
  createTestStream("w+e").destroy();
  createTestStream("w+emit").destroy();
  createTestStream("write").destroy();
  createTestStream("write+e").destroy();
  createTestStream("write+emit").destroy();
  createTestStream("rw").destroy();
  createTestStream("rw+e").destroy();
  createTestStream("rw+emit").destroy();
  createTestStream("readwrite").destroy();
  createTestStream("readwrite+e").destroy();
  createTestStream("readwrite+emit").destroy();
});