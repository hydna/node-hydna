var hydna = require("../lib/hydna");

var count = 0;
var message = "Hello World!";
var stream = hydna.open("00:00:00:00:aa:bb:cc:dd:00:00:00:00:11:11:22:22", "r");
stream.addListener("data", function(data) {
  if (++count == 10) {
    process.exit(0);
  }
  // sys.puts("Received: " + data);
});
