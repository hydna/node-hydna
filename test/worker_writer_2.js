var hydna = require("../lib/hydna");

var stream = hydna.open("00:00:00:00:aa:bb:cc:dd:00:00:00:00:11:11:22:22", "w");
var message = "Hello World!";
var count = 1;

stream.addListener("connect", function() {
  setTimeout(function() {
    console.log("Start writiing");
    while (count--) {
      stream.write(message, "ascii");
    }
  }, 2000);
});