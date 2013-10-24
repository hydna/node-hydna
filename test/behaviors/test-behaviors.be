// Add this behaviors into your domain in order to pass all
// tests in the test-suite.


behavior('/ping-back', {
  emit: function (evt) {
    if (evt.data == 'ping') {
      evt.channel.emit('pong', evt.connection);
    }
  }
});

behavior('/open-deny', {
  open: function (evt) {
    evt.deny('DENIED');
  }
});

behavior('/test-token', {
  open: function (evt) {
    evt.allow(evt.token);
  }
});