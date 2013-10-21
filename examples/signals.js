var hydna = require('../index');

// Open channel in "emit" mode. We are requesting to "emit" signal to the
// underlying behavior-layer.
var channel = hydna.createChannel('public.hydna.net/ping-back', 'emit');

// Connect handler, is triggered once that the channel is connected
channel.on('connect', function (data) {
  
  // Dispatch a signal with message "ping". The underlying behavior-layer
  // will recieve it and can choose to take action
  this.dispatch('ping');
});

// Signal handler, is triggered each time a SIGNAL is received on the channel
channel.on('signal', function (data) {

  // We received a signal on our disptach.
  if (typeof data == "string") {
      console.log('Received singal "%s"', data);
  } else {
      console.error("Expected a pong response");
  }

  // Close the channel, which terminates the underlying
  // receive-loop.
  this.end();
});