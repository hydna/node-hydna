var hydna = require('../index');

// Open channel in "read" mode. We are just listening for data and signals.
var channel = hydna.createChannel('public.hydna.net', 'read');

// Connect handler, is triggered once that the channel is connected
channel.on('connect', function (data) {
  console.log("Press Ctrl-C to abort the receive loop");

  // The "connect" handler may contain an optional welcome-message sent
  // by remote part. Print message if exists.
  if (typeof data == 'string') {
    console.log("[WELCOME]: " + data);
  }
});

// Data handler, is triggered each time DATA is received on the channel
channel.on('data', function (data) {
  if (typeof data == 'string') {
    console.log('[DATA] ' + data);
  } else {
    console.log('[DATA] <binary>');
  }
});

// Signal handler, is triggered each time a SIGNAL is received on the channel
channel.on('signal', function (data) {
  if (typeof data == 'string') {
    console.log('[SIGNAL] ' + data);
  } else {
    console.log('[SIGNAL] <binary>');
  }
});