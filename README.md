Hydna for nodejs
================

The node.js hydna library is a straight-forward implementation of the wink binary protocol. The module has been closely modeled to the native node.js modules and the usage pattern should come naturally to developers using other node.js modules. The module does not have any external dependencies.

Creating a connection:

    var hydna = require("hydna");
    var channel = hydna.createChannel("localhost", "rw");

    channel.on("connect", function() {
      // read/write connection is ready to use 
    });

    channel.on("error", function() {
      // an error occured when connecting
    });

A read/write channel is opened and event-listeners for connect and error are attached to the channel.

Sending Data:

    var hydna = require("hydna");
    var channel = hydna.createChannel("localhost", "w");

    channel.on("connect", function() {
      var message = "Hello World!";
      channel.write(message, "utf8");
    });

Opens up a channel for writing and, when the connection has been established and the connect event has been emitted, writes a message.

Receiving data:

    var hydna = require("hydna");
    var channel = hydna.createChannel("localhost", "r");
    
    channel.setEncoding("utf8");
    
    channel.on("data", function(data) {
      console.log(data);
    });

Opens up a channel for reading and, when the data arrives and the data event is emitted, writes the received data to the console.


## Installation

The easiest way to install this library is via npm:

    $ npm install hydna


## Test 

The test suite requires a running server instance with the behaviors found `test/behaviors` loaded.

The default server address is `localhost:7010`. This can be overridden via the environment variable `TEST_ADDRESS`.

To run the test suite:

    $  TEST_ADDRESS=<server_address_and_port> npm test 


## API Specification

The node.js hydna client library consists of a single module — hydna — that
contains everything that is necessary to communicate over hydna.

### hydna.PAYLOAD_MAX_SIZE

Returns the maximum payload size.

### hydna.followRedirects=true

Indicates if HTTP-redirects should be followed or not.


### hydna.origin=<hostname>
  
Sets the origin identity that should be sent to the server on handshake.


### hydna.agent=node-winsock-client/<version>
  
Sets the agent identity that should be sent to the server on handshake.


### hydna.createChannel(url, mode, [callback])

Opens a Channel to the specified ´'url'´.

This function is asynchronous. When the `'connect'` event is emitted once connected. If there is a problem connecting, the `'connect'` event will not be emitted, the 'error' event will be emitted with the exception.

Available modes:
* read (r) - Open channel in read mode
* write (w) - Open channel in write mode
* readwrite (rw) - Open channel in read-write mode.
* +emit(e) - Open channel with emit-signal support (e.g. "rw+emit").

This example opens a Channel and writes data too it. The same data
is received :

    var hydna = require("hydna");
    var channel = hydna.createChannel("localhost", "w");
    channel.write("Hello World!");


### hydna.Channel

This object is an abstraction of of a TCP or UNIX socket. hydna.Channel  instance implement a duplex stream interface. They can be created by the user and used as a client (with connect()) or they can be created by Node and passed to the user through the 'connection' event of a server.

hydna.Channel instances are EventEmitters with the following events:

Event: `'connect'`
`function (message) { }`

Emitted when a channel connection successfully is established. See connect(). The `'message'` argument may or may not contain an initial message from server.

Event: `'data'`
`function (data) { }`

Emitted when data is received. The argument data will be a Buffer or String.  Encoding of data is set by channel.setEncoding(). 

Event: `'drain'`
`function () { }`

Emitted when the write buffer becomes empty. Can be used to throttle uploads.

Event: `'error'`
`function (exception) { }`

Emitted when an error occurs. The `'close'` event will be called directly  following this event.

Event: `'close'`
`function (had_error) { }`

Emitted once the channel is fully closed. The argument had_error is a boolean which says if the channel was closed due to an error.

Event: `'signal'`
`function (data) { }`

Emitted when remote server send's a signal.

#### Channel.readable

Returns `true` if channel is readable, else false.

#### Channel.writable

Returns `true` if channel is writable, else false.

#### Channel.emitable

Returns `true` if channel is emitable, else false.


#### Channel.readyState

Either `'closed'`, `'closing'`, `'open'`, `'opening'`, 
`'read'`, `'write'`, `'readwrite'` and/or `'+emit'`.


#### Channel.id

Returns channel `id` as a string. Property is `null` if not connected.


#### Channel.setEncoding(encoding=null)

Sets the encoding (either `'ascii'`, `'utf8'`, `'base64'`, `'json'`)


#### Channel.connect(url, mode='readwrite')

See `hydna.createChannel` for more info.


#### Channel.write(data, encoding='ascii', priority=1)

Sends data on the channel. The second parameter specifies the encoding in the case of a string--it defaults to ASCII because encoding to UTF8 is rather slow.

Returns ´true´ if the entire data was flushed successfully to the underlying connection. Returns `false` if all or part of the data was queued in user memory. ´'drain'´ will be emitted when the buffer is again free.


#### Channel.dispatch(message)

Dispatch a signal on the channel.

Returns ´true´ if the signal was flushed successfully to the underlying connection. Returns `false` if the all or part of the signal was queued in user memory. ´'drain'´ will be emitted when the buffer is again free.

Example:

    var hydna = require("hydna");
    var channel = hydna.createChannel("localhost", "read+emit");
    channel.on("signal", function(message) {
      if (message == "pong") {
        console.log("Recevied pong from server");
      }
    });
    channel.dispatch("ping");



#### Channel.end([message])

Closes channel for reading, writing and emitting. The optional `message` is sent to the server.

Example:

    var hydna = require("hydna");
    var channel = hydna.createChannel("localhost", "read");
    channel.end("good bye!");


#### Channel.destroy()

Closes channel for reading, writing and emitting.