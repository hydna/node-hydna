var hydna = require('../index');
var channel = hydna.createChannel('public.hydna.net/ping-back', 'emit');

channel.on('connect', function (data) {
  this.dispatch('ping');
});

channel.on('signal', function (data) {
  if (typeof data == "string") {
      console.log('Received singal "%s"', data);
  } else {
      console.error("Expected a pong response");
  }
  this.end();
});