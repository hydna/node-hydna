var hydna = require("../lib/hydna");

var message = "Hello World!";
var stream = hydna.open("00:00:00:00:aa:bb:cc:dd:00:00:00:00:11:11:22:22", "w");

stream.addListener("connect", function() {
  setInterval(function() {
    stream.write(message, "ascii");
  }, 5)
});