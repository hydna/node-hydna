var sys = require("sys");
var hydna = require("../lib/hydna");

var message = "Hello World!";
var streamA = hydna.open("00:00:00:00:aa:bb:cc:dd:00:00:00:00:11:11:22:20", "rw");
var streamB = hydna.open("00:00:00:00:aa:bb:cc:dd:00:00:00:00:11:11:22:21", "rw");
var streamC = hydna.open("00:00:00:00:aa:bb:cc:dd:00:00:00:00:11:11:22:22", "rw");
var streamD = hydna.open("00:00:00:00:aa:bb:cc:dd:00:00:00:00:11:11:22:23", "rw");
var streamE = hydna.open("00:00:00:00:aa:bb:cc:dd:00:00:00:00:11:11:22:24", "rw");
var streamF = hydna.open("00:00:00:00:aa:bb:cc:dd:00:00:00:00:11:11:22:25", "rw");
var streamG = hydna.open("00:00:00:00:aa:bb:cc:dd:00:00:00:00:11:11:22:26", "rw");
var streamH = hydna.open("00:00:00:00:aa:bb:cc:dd:00:00:00:00:11:11:22:27", "rw");
var streamI = hydna.open("00:00:00:00:aa:bb:cc:dd:00:00:00:00:11:11:22:28", "rw");
var streamJ = hydna.open("00:00:00:00:aa:bb:cc:dd:00:00:00:00:11:11:22:29", "rw");

streamA.addListener("connect", function() {
  sys.puts("Sending: ping!");
  // streamB.write(message, "ascii");
});

streamB.addListener("connect", function() {
  sys.puts("Sending form stream B: pong!");
  streamA.write(message, "ascii");
});

streamA.addListener("data", function(data) {
  sys.puts("Stream A Received: " + data);
});

streamB.addListener("data", function(data) {
  sys.puts("Stream B Received: " + data);
});
