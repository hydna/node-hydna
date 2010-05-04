var sys = require("sys");
var wink = require("../lib/wink");

var stream = wink.open("aabbccdd11112222", "rw");

stream.addListener("connect", function() {
  sys.puts("connected to server, now sending data");
  stream.write("hejsan svejsan", "ascii");
});

stream.addListener("data", function(data) {
  sys.puts("recived data: " + data.toString());
});
