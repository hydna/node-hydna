var sys = require("sys");
var hydna = require("../lib/hydna");

var message = "Hello World!";
var stream = hydna.open("00:00:00:00:aa:bb:cc:dd:00:00:00:00:11:11:22:22", "rw");

stream.addListener("connect", function() {
  sys.puts("Sending: " + message);
  stream.write(message, "ascii");
});

stream.addListener("data", function(data) {
  sys.puts("Received: " + data);
  process.exit(0);
});
