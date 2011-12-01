var doesNotThrow        = require("assert").doesNotThrow;
var throws              = require("assert").throws;
var timeout             = require("./common").timeout;
var shutdown            = require("./common").shutdown;
var createTestChannel   = require("./common").createTestChannel;

throws(function() {
  createTestChannel("readwrite-signal");
});

throws(function() {
  createTestChannel("not valid");
});

doesNotThrow(function() {
  createTestChannel(null).destroy();
  createTestChannel("r").destroy();
  createTestChannel("r+e").destroy();
  createTestChannel("r+emit").destroy();
  createTestChannel("read").destroy();
  createTestChannel("read+e").destroy();
  createTestChannel("read+emit").destroy();
  createTestChannel("w").destroy();
  createTestChannel("w+e").destroy();
  createTestChannel("w+emit").destroy();
  createTestChannel("write").destroy();
  createTestChannel("write+e").destroy();
  createTestChannel("write+emit").destroy();
  createTestChannel("rw").destroy();
  createTestChannel("rw+e").destroy();
  createTestChannel("rw+emit").destroy();
  createTestChannel("readwrite").destroy();
  createTestChannel("readwrite+e").destroy();
  createTestChannel("readwrite+emit").destroy();
});