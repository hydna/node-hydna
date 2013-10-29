var assert                    = require('assert');
var common                    = require('./common');

var payload
var reader;
var writer;
var path;
var count = 0;

payload = common.createPayload(512);
path = common.uniquePath();

common.timeout(5000);

function burst () {
  for(var i = 0; i < 100; i++) {
    writer.write(payload);
  }
}

reader = common.createTestChannel('read', path);
writer = common.createTestChannel('write', path);

assert.notEqual(reader._connection, writer._connection);

reader.on('connect', function() {
  if (writer.readyState == 'write') {
    burst();
  }
});

reader.on('data', function(data) {
  assert.ok(common.compareBuffers(payload, data));
  if (++count == 100) {
    reader.destroy();
  }
});

reader.on('close', function () {
  writer.destroy();
});

writer.on('connect', function () {
  if (reader.readyState == 'read') {
    burst();
  }
});

writer.on('close', function () {
  common.shutdown();
});