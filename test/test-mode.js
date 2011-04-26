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
  createTestStream(null).close();
  createTestStream("r").close();
  createTestStream("r+e").close();
  createTestStream("r+emit").close();
  createTestStream("read").close();
  createTestStream("read+e").close();
  createTestStream("read+emit").close();
  createTestStream("w").close();
  createTestStream("w+e").close();
  createTestStream("w+emit").close();
  createTestStream("write").close();
  createTestStream("write+e").close();
  createTestStream("write+emit").close();
  createTestStream("rw").close();
  createTestStream("rw+e").close();
  createTestStream("rw+emit").close();
  createTestStream("readwrite").close();
  createTestStream("readwrite+e").close();
  createTestStream("readwrite+emit").close();
});