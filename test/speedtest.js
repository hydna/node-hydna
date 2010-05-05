var sys = require("sys");
var wink = require("../lib/wink");

const NO_OF_PACKETS = 100000;
const DATA = "123456789012345";

var stream = wink.open("aabbccdd11112222", "rw");
var bytesRecived = 0;
var packetsRecived = 0;
var startTime = 0;

stream.addListener("connect", function() {
  sys.puts("connected to server, now sending " + 
           NO_OF_PACKETS + 
           " (" + DATA.length + " bytes per packet)"
          );
  
  var count = NO_OF_PACKETS;
  startTime = new Date();
  
  function send() {
    stream.write(DATA, "ascii");
    if (count-- > 0) {
      process.nextTick(send);
    }
  }
  
  process.nextTick(send);
});

stream.addListener("data", function(data) {
  bytesRecived += data.length + 12;
  packetsRecived++;
  
  if (packetsRecived == NO_OF_PACKETS) {
    var bufferAllocs = 0;
    var bufferCopies = 0;

    sys.puts("All packets was recived in " + ((new Date() - startTime) / 1000) );
    process.exit(0);
  }
});
