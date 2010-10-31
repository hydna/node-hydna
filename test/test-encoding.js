const ok                  = require("assert").ok
    , throws              = require("assert").throws
    , doesNotThrow        = require("assert").doesNotThrow
    , equal               = require("assert").equal
    , deepEqual           = require("assert").deepEqual
    , timeout             = require("./common").timeout
    , shutdown            = require("./common").shutdown
    , createTestStream    = require("./common").createTestStream

var stream;

timeout(5000);

stream = createTestStream("rw");
stream.on("connect", testAscii);
stream.on("close", function() { shutdown() });

throws(function() {
 stream.setEncoding("NA");
});

function testAscii() {
  stream.setEncoding("ascii");
  stream.once("data", function(data) {
    equal(data, "ascii");
    process.nextTick(testUtf8);
  });
  stream.write("ascii", "ascii");
}

function testUtf8() {
  stream.setEncoding("utf8");
  stream.once("data", function(data) {
    equal(data, "åäö");
    process.nextTick(testJson);
  });
  stream.write("åäö", "utf8");  
}

function testJson() {
  var graph = { data: "json" };
  stream.setEncoding("json");
  stream.once("data", function(data) {
    deepEqual(data, graph);
    process.nextTick(testBase64);
  });
  stream.write(graph, "json");
}

function testBase64() {
  stream.setEncoding("base64");
  stream.once("data", function(data) {
    equal(data, "base64");
    stream.end();
  });
  stream.write("base64", "base64");
}