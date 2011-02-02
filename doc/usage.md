# Usage

Creating a connection:

    ::: javascript
    var createStream = require('hydna').createStream;
    var stream = createStream('AABBCCDD-AABBAABB', 'rw');

    stream.on('connect', function() {
      // read/write connection is ready to use 
    });

    stream.on('error', function() {
      // an error occured when connecting
    });

A read/write stream is opened and event-listeners for connect and error are
attached to the stream.

Sending Data:

    ::: javascript
    var createStream = require('hydna').createStream;
    var stream = createStream('AABBCCDD-AABBAABB', 'w');

    stream.on('connect', function() {
      var message = "Hello World!";
      stream.write(message, "utf8");
    });

Opens up a stream for writing and, when the connection has been established and
the connect event has been emitted, writes a message.

Receiving data:

    ::: javascript
    var hydna = require('hydna');
    var stream = createStream('AABBCCDD-AABBAABB', 'r');
    
    stream.setEncoding("utf8");
    
    stream.on('data', function(data) {
      console.log(data);
    });

Opens up a stream for reading and, when the data arrives and the data event is
emitted, writes the received data to the console.
