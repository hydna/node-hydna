# API Specification

The node.js hydna client library consists of a single module — hydna — that
contains everything that is necessary to communicate over hydna.

## hydna.Stream

This object is an abstraction of of a TCP or UNIX socket. hydna.Stream 
instance implement a duplex stream interface. They can be created by 
the user and used as a client (with connect()) or they can be created 
by Node and passed to the user through the 'connection' event 
of a server.

hydna.Stream instances are EventEmitters with the following events:

Event: `'connect'`
`function () { }`

Emitted when a stream connection successfully is established. See connect().

Event: `'data'`
`function (data) { }`

Emitted when data is received. The argument data will be a Buffer or String. 
Encoding of data is set by stream.setEncoding(). 

Event: `'drain'`
`function () { }`

Emitted when the write buffer becomes empty. Can be used to 
throttle uploads.

Event: `'error'`
`function (exception) { }`

Emitted when an error occurs. The `'close'` event will be called directly 
following this event.

Event: `'close'`
`function (had_error) { }`

Emitted once the stream is fully closed. The argument had_error is a 
boolean which says if the stream was closed due to an error.

Event: `'signal'`
`function (data) { }`

Emitted when remote server send's a signal.

### Stream.readable

Returns `true` if stream is readable, else false.

### Stream.writable

Returns `true` if stream is writable, else false.

### Stream.emitable

Returns `true` if stream is emitable, else false.

### Stream.readyState

Either `'closed'`, `'closing'`, `'open'`, `'opening'`, 
`'read'`, `'write'`, `'readwrite'` and/or `'+emit'`.

### Stream.addr

Returns stream `addr` as a string. Property is `null` if not connected.

### Stream.setEncoding(encoding=null)

Sets the encoding (either `'ascii'`, `'utf8'`, `'base64'`, `'json'`)

### Stream.connect(addr, mode='readwrite', [token])

Opens a stream to the specified ´'addr'´.

This function is asynchronous. When the `'connect'` event is emitted 
the stream is established. If there is a problem connecting, the 
`'connect'` event will not be emitted, the 'error' event will be 
emitted with the exception.

Available modes:
* read (r) - Open stream in read mode
* write (w) - Open stream in write mode
* readwrite (rw) - Open stream in read-write mode.
* +emit - Open stream with emit-signal support (e.g. "rw+emit").

Example:

    var createConncetion = require("hydna").createConncetion;
    var stream = createConncetion("00000011-00000011", "read");
    stream.write("Hello World!");

The `token` is an optional `string` that required by some zones when 
connecting.

### Stream.write(data, encoding='ascii', priority=1)

Sends data on the stream. The second paramter specifies the encoding in
the case of a string--it defaults to ASCII because encoding to UTF8 is
rather slow.

Returns ´true´ if the entire data was flushed successfully to the 
underlying connection. Returns `false` if all or part of the data was 
queued in user memory. ´'drain'´ will be emitted when the buffer is 
again free.

### Stream.dispatch(data, encoding='utf8')

Dispatch a signal on the stream. The second paramter specifies the encoding 
in the case of a string--it defaults to UTF8 encoding.

Returns ´true´ if the signal was flushed successfully to the 
underlying connection. Returns `false` if the all or part of the signal 
was queued in user memory. ´'drain'´ will be emitted when the buffer is 
again free.

### Stream.end([message])

Closes stream for reading, writing and emiting. The optional `message` is
sent to the zone.
