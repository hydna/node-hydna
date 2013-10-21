var hydna = require('../index');

var messages = ['Hello', 'World'];

// Open two channels in "readwrite" mode.
var channels = [
  hydna.createChannel('public.hydna.net/channel1', 'rw'),
  hydna.createChannel('public.hydna.net/channel2', 'rw')
];

// Loop through both channels and add handlers.
channels.forEach(function (channel) {

  // Connect handler, is triggered on both channels, once connected
  channel.on('connect', function () {
    console.log('Connected to channel "%s"', this.url);

    // Write messages in correct order.
    this.write(messages.shift());
  });

  // Data handler, is triggered on both channels, once DATA is received
  channel.on('data', function (data) {
    console.log('Channel "%s" recieved: %s', this.url, data);

    // Close the channel. The application will terminate once both
    // channels are closed.
    this.end();
  });

});