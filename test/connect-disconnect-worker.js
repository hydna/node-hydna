var hydna = require("../lib/hydna");

var stream = hydna.open("00:00:00:00:aa:bb:cc:dd:00:00:00:00:11:11:22:22", "w");
var message = "Hello World!";
var count = 1000;

stream.addListener("connect", function() {
  console.log("connect %s", process.pid);
  
  (function loop() {
    if (count--) {
      stream.write(message, "ascii");
      process.nextTick(loop);
    } else {
      process.exit();
    }
  })();
  
});