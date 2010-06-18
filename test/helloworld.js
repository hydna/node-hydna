var sys = require("sys");
var hydna = require("../lib/hydna");

var message = "Hello World!";
var stream = hydna.open("aabbccdd11112222", "rw");

stream.addListener("connect", function() {
  sys.puts("Sending: " + message);
  stream.write(message, "ascii");
});

stream.addListener("data", function(data) {
  sys.puts("Received: " + data);
  process.exit(0);
});
