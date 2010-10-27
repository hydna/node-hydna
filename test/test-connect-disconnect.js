const spawnWorker   = require("parall/worker").spawnWorker
    , createChannel = require("parall").createChannel
    
    
const NO_OF_CONNECTS = 10000

var count = 0;


(function loop() {
  var id = count++;
  var worker = spawnWorker("./connect-disconnect-worker");
  worker.on("start", function() {
    console.log("worker-start. " + id);
  });
  worker.on("stop", function() {
    console.log("worker-stop. " + id);
    
    if (count++ < NO_OF_CONNECTS) {
      process.nextTick(loop);
    }
  });
})();


