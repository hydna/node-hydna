var ok                  = require("assert").ok;
var timeout             = require("./common").timeout;
var shutdown            = require("./common").shutdown;
var Channel             = require("../index").Channel;

var TEST_HOST           = require("./common").TEST_HOST

var NO_REQUESTS         = 100;

var chan;
var payload;
var count = 0;

timeout(5000);

function onconnect() {
  if (++count == NO_REQUESTS) {
    shutdown();
  }
}

for (var i = 0; i < NO_REQUESTS; i++) {
  chan = new Channel();
  chan.connect(TEST_HOST + "/1", "r");
  chan.on("connect", onconnect);
}