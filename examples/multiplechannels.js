var hydna = require('../index');

var messages = ['Hello', 'World'];

var channels = [
  hydna.createChannel('public.hydna.net/channel1', 'rw'),
  hydna.createChannel('public.hydna.net/channel2', 'rw')
];

channels.forEach(function (channel) {
  channel.on('connect', function () {
    console.log('Connected to channel "%s"', this.url);
    this.write(messages.shift());
  });

  channel.on('data', function (data) {
    console.log('Channel "%s" recieved: %s', this.url, data);
    this.end();
  });
});