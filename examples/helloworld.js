var hydna = require('../index');
var channel = hydna.createChannel('public.hydna.net', 'readwrite');

channel.on('connect', function () {
  this.write('Hello world from NodeJS');
});

channel.on('data', function (data) {
  console.log(data);
  this.end();
});