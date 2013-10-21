var hydna = require('../index');

// Open channel in "read/write" mode. All data sent to channel will
// loop back from the remote connection.
var channel = hydna.createChannel('public.hydna.net', 'readwrite');

// Connect handler, is triggered once that the channel is connected
channel.on('connect', function () {

  // Connection to server is established. Send a "hello world"
  // to public domain.
  this.write('Hello world from NodeJS');
});

// Data handler, is triggered each time DATA is received on the channel
channel.on('data', function (data) {

  // Log data recived on channel.
  console.log(data);

  // Close the channel, which terminates the underlying
  // receive-loop.
  this.end();
});