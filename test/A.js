var sys = require("sys");
var wink = require("../lib/wink");


var stream = wink.open("AABBCCDDEEFF11", "rw");


stream.addListener("connect", function() {
  stream.write("Hello world!");
});


stream.addListener("data", function(data) {
  sys.puts("Skaggi säger: " + data);
});