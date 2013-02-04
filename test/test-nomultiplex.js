var throws              = require('assert').throws;
var notEqual            = require('assert').notEqual;

var timeout             = require('./common').timeout;
var shutdown            = require('./common').shutdown;
var TEST_CH             = require('./common').TEST_CH;

var Channel             = require('../index').Channel;

var chan1;
var chan2;

timeout(5000);


function onconnect () {
  notEqual(chan1._connection, chan2._connection);
  if (chan1._connecting == chan2._connecting) {
    shutdown();
  }
}


chan1 = new Channel();
chan1.on('connect', onconnect);
chan1.connect(TEST_CH, 'r', { noMultiplex: true });

chan2 = new Channel(TEST_CH, 'r');
chan2.on('connect', onconnect);
chan2.connect(TEST_CH, 'r', { noMultiplex: true });