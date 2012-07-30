var BeepParser = require('./BeepParser');
var Stream = require('stream');
var inherits = require('util').inherits;

var CHAN_MGMT = 0;

function add(val, cur, maxBits) {
  return ((cur + val) % Math.pow(2, maxBits));
}

function Beep() {
  var self = this;

  this.writable = true;
  this._channels = {
    CHAN_MGMT: {
      seqno: 0,
      msgs: {}
    }
  };

  this._parser = new BeepParser();
  this._parser.on('header', function(meta) {
    /* keyword, chan, msgno, more, seqno, size, ansno */
    if (self._channels[meta.chan] === undefined)
      return self._fail(new Error('Invalid channel reference from peer'));
    var msg = new BeepMessage();
    self._channels[meta.chan].msgs[meta.msgno] = msg;
    self.emit('message', msg, meta.chan);
  });
  this._parser.on('data', function(data, meta) {
    self._channels[meta.chan].msgs[meta.msgno].emit('data', data);
  });
  this._parser.on('end', function(meta) {
    self._channels[meta.chan].msgs[meta.msgno].emit('end');
    delete self._channels[meta.chan].msgs[meta.msgno];
  });
  this._parser.on('error', function(err) {
    self._fail(err);
  });
}
inherits(Beep, Stream);

Beep.prototype.write = function(data) {
  this._parser.execute(data);
};
Beep.prototype.end = function() {};

Beep.prototype._fail = function(err) {
  this.writable = false;
  this._parser.removeAllListeners();
  this._parser = undefined;
  delete this._channels;
  this.emit('error', err);
};

function BeepMessage() {
  this.readable = true;
}
inherits(BeepMessage, Stream);
