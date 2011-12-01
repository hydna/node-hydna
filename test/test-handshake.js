var ok                  = require("assert").ok;
var equal               = require("assert").equal;
var throws              = require("assert").throws;

var Channel             = require("../index").Channel;

var timeout             = require("./common").timeout;
var shutdown            = require("./common").shutdown;
var createTestChannel   = require("./common").createTestChannel;
var chanErrHandler      = require("./common").chanErrHandler;
var TEST_HOST           = require("./common").TEST_HOST;

timeout(5000);


function handshakeRedirect() {
  var chan;

  chan = new Channel();
  chan.connect("redirect@" + TEST_HOST + "/5");

  chan.on("connect", function(message) {
    equal(message, "REDIRECTED");
    chan.destroy();
  });
  chan.on("close", function() {
    process.nextTick(handshakeDeny);
  });
}


function handshakeDeny() {
  var chan;

  chan = new Channel();
  chan.connect("deny@" + TEST_HOST + "/5");

  chan.on("connect", function(message) {
    throw new Error("Received connect");
  });
  chan.on("error", function(err) {
    ok(/DENIED_HANDSHAKE/.test(err.message));
    chan.destroy();
  });
  chan.on("close", function() {
    shutdown();
  });
}

process.nextTick(handshakeRedirect);