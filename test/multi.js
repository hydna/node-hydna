const spawn = require("parall/worker").spawn;


spawn("./receiver.js", 10, [], function() {
  console.log("start");
  spawn("./sender.js", 10);
});