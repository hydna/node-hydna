const puts    = require("sys").puts
    , open    = require("../lib/hydna").open
    , hexaddr = require("../lib/hydna").hexaddr;

const DOMAIN = "00:00:00:00:aa:bb:cc:dd";
const NO_OF_CONNECTIONS = 10000;
const NO_OF_PACKETS = 10;
const DATA = "1234567890123";

var streams = [];

function spawn() {
  var addr = streams.length.toString(16);
  while (addr.length < 16) {
    addr = "0" + addr;
  }
  var stream = open(DOMAIN + addr, "rw");

  stream.addListener("connect", function() {
    puts("Connection  (" + streams.length + ") " + hexaddr(stream.addr) + " is now opened.");
    
    if (streams.length < NO_OF_CONNECTIONS) {
      setTimeout(spawn, 0);
    } else {
      
      streams[0].addListener("data", function(data) {
        puts("Received data on streams[0]: " + data.toString("ascii"));
      });

      sys.puts("Sending hello world to stream[0]");
      streams[0].write("hello world!");
      
      // streams.forEach(function(stream) {
      //   stream.end();
      // })
    }
  });
  
  streams.push(stream);
}

spawn();