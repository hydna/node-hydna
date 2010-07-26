var sys = require("sys");
var hydna = require("../lib/hydna");

const NO_OF_PACKETS = 100000;
const DATA = "175897238097412748127340817238047102837409812374809132708947102398478912748907123094783127409123784097123089470983217480923174809327189047321098478901237493217409312780471239478092137409123748091237480923170489712308947231098478902137408931274890127094732890470912374089123749082317409812374089132748901237408912370948712389047890127408912374890712309847";

var stream = hydna.open("00:00:00:00:aa:bb:cc:dd:00:00:00:00:11:11:22:22", "rw");
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
