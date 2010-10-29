const Stream        = require("../lib/hydna").Stream;


var stream = new Stream();
stream.connect("00112233445566778800112233445566", "rw");
stream.on("connect", function() {
  console.log("connected to hydna");
});
stream.on("error", function(err) {
  console.log("An error occured:"  + err.stack);
});
stream.on("data", function(data) {
  console.log("data: " + data);
});
stream.write("Hello World");