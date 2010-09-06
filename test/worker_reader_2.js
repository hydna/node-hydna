var hydna = require("../lib/hydna");

var stream = hydna.open("00:00:00:00:aa:bb:cc:dd:00:00:00:00:11:11:22:22", "r");
var count = 0;

stream.on("data", function(data) {
  if (++count == 5) {
    console.log("Received all");
  }
});
