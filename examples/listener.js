var hydna = require('../index');
var channel = hydna.createChannel('public.hydna.net', 'read');

channel.on('connect', function (data) {
  console.log("Press Ctrl-C to abort the receive loop");
  console.log("[WELCOME]: " + data);
});

channel.on('data', function (data) {
  if (typeof data == 'string') {
    console.log('[DATA] ' + data);
  } else {
    console.log('[DATA] <binary>');
  }
});

channel.on('signal', function (data) {
  if (typeof data == 'string') {
    console.log('[SIGNAL] ' + data);
  } else {
    console.log('[SIGNAL] <binary>');
  }
});