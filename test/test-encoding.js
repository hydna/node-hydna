var ok                  = require("assert").ok;
var throws              = require("assert").throws;
var doesNotThrow        = require("assert").doesNotThrow;
var equal               = require("assert").equal;
var deepEqual           = require("assert").deepEqual;
var timeout             = require("./common").timeout;
var shutdown            = require("./common").shutdown;
var createTestChannel   = require("./common").createTestChannel;

var chan;
var successfullTests = 0;

timeout(5000);

chan = createTestChannel("rw");
chan.on("connect", testAscii);
chan.on("close", function() {
  equal(successfullTests, 4);
  shutdown();
});

throws(function() {
 chan.setEncoding("NA");
});

function testAscii() {
  chan.setEncoding("ascii");
  chan.once("data", function(data) {
    equal(data, "ascii");
    successfullTests++;
    process.nextTick(testUtf8);
  });
  chan.write("ascii", "ascii");
}

function testUtf8() {
  chan.setEncoding("utf8");
  chan.once("data", function(data) {
    equal(data, "åäö");
    successfullTests++;
    process.nextTick(testJson);
  });
  chan.write("åäö", "utf8");
}

function testJson() {
  var graph = { data: "json" };
  chan.setEncoding("json");
  chan.once("data", function(data) {
    deepEqual(data, graph);
    successfullTests++;
    process.nextTick(testBase64);
  });
  chan.write(graph, "json");
}

function testBase64() {
  chan.setEncoding("ascii");
  chan.once("data", function(data) {
    equal(data, "base64");
    successfullTests++;
    chan.destroy();
  });
  chan.write("YmFzZTY0", "base64");
}