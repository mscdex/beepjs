var inherits = require('util').inherits;
var EventEmitter = require('events').EventEmitter;

var I = 0;
var PARSE_KEYWORD = I++,
    PARSE_PARAM_CHAN = I++,
    PARSE_PARAM_MSGNO = I++,
    PARSE_PARAM_MORE = I++,
    PARSE_PARAM_SEQNO = I++,
    PARSE_PARAM_SIZE = I++,
    PARSE_PARAM_ANSNO = I++,
    PARSE_PAYLOAD = I++,
    PARSE_TRAILER = I++;
var INDEX = ['keyword', 'chan', 'msgno', 'more', 'seqno', 'size', 'ansno'];
var MAX_INT = 2147483647,
    MAX_SEQNO = 4294967295;
var SPACE = 32,
    CR = 13,
    LF = 10,
    ASCII_E = 69,
    ASCII_N = 78,
    ASCII_D = 68;
function BeepParser() {
  this._state = PARSE_KEYWORD;
  this._expectCRLF = -1;
  this._expectTrailer = -1;
  this._payloadCnt = 0;
  this._meta = {
    keyword: undefined,
    chan: undefined,
    msgno: undefined,
    more: undefined,
    seqno: undefined,
    size: undefined,
    ansno: undefined
  };
}
inherits(BeepParser, EventEmitter);

BeepParser.prototype.execute = function(b, start, end) {
  start || (start = 0);
  end || (end = b.length);

  var i = start, finished = false;

  while (i < end) {
    if (this._expectCRLF > -1) {
      if (this._expectCRLF === 0 && b[i] !== CR) {
        return this._emitError('Parse error: expected CR, got 0x'
                               + b[i].toString(16));
      } else if (this._expectCRLF === 1) {
        if (b[i] === LF)
          this._expectCRLF = -1;
        else {
          return this._emitError('Parse error: expected LF, got 0x'
                                 + b[i].toString(16));
        }
      } else
        ++this._expectCRLF;
      ++i;
      if (this._state !== PARSE_TRAILER && this._expectTrailer !== 2)
        continue;
    }
    switch (this._state) {
      case PARSE_PAYLOAD:
        if (this._meta.size === 0) {
          this._state = PARSE_TRAILER;
          break;
        }
        if (i > start)
          start = i;
        var need = this._meta.size - this._payloadCnt,
            bLeft = end - start;
        if (need > 0) {
          if (start === 0 && end === b.length)
            this.emit('data', b);
          else if (need <= bLeft) {
            this._payloadCnt += need;
            this.emit('data', b.slice(start, start + need));
            i += need;
          } else {
            this._payloadCnt += bLeft;
            this.emit('data', b.slice(start, end));
            i += bLeft;
          }
        } else
          this._state = PARSE_TRAILER;
        break;
      case PARSE_KEYWORD:
      case PARSE_PARAM_CHAN:
      case PARSE_PARAM_MSGNO:
      case PARSE_PARAM_MORE:
      case PARSE_PARAM_SEQNO:
      case PARSE_PARAM_SIZE:
      case PARSE_PARAM_ANSNO:
        if (i > start)
          start = i;
        while (i < end) {
          if (b[i] === SPACE) {
            finished = true;
            break;
          } else if (b[i] === CR) {
            if (this._meta.keyword === undefined
                || (this._meta.keyword === 'ANS'
                    && this._state !== PARSE_PARAM_ANSNO)
                || (this._meta.keyword !== 'ANS'
                    && this._state !== PARSE_PARAM_SIZE)) {
              return this._emitError('Parse Error: header: Unexpected CR');
            }
            this._expectCRLF = 0;
            finished = true;
            break;
          }
          ++i;
        }
        if (!finished) {
          if (this._meta[INDEX[this._state]] === undefined)
            this._meta[INDEX[this._state]] = b.toString('ascii', start, end);
          else
            this._meta[INDEX[this._state]] += b.toString('ascii', start, end);
        } else {
          finished = false;
          if (this._meta[INDEX[this._state]] === undefined) {
            this._meta[INDEX[this._state]] = b.toString('ascii', start, (i < end
                                                                         ? i
                                                                         : end));
          } else {
            this._meta[INDEX[this._state]] += b.toString('ascii', start, (i < end
                                                                          ? i
                                                                          : end));
          }
          if (this._state !== PARSE_KEYWORD && this._state !== PARSE_PARAM_MORE) {
            var intval = parseInt(this._meta[INDEX[this._state]], 10);
            if (isNaN(intval)) {
              return this._emitError('Type Error: header: ' + INDEX[this._state]
                                      + ' value ('
                                      + this._meta[INDEX[this._state]]
                                      + ') is not a number');
            }
            this._meta[INDEX[this._state]] = intval;
            if (this._state === PARSE_PARAM_SEQNO && intval > MAX_SEQNO) {
              return this._emitError('Bounds Error: header: seqno value is too large ('
                                      + intval + ' > ' + MAX_SEQNO);
            } else if (intval > MAX_INT) {
              return this._emitError('Bounds Error: header: ' + INDEX[this._state]
                                      + ' value is too large ('
                                      + intval + ' > ' + MAX_INT);
            } else if (intval < 0) {
              return this._emitError('Bounds Error: header: ' + INDEX[this._state]
                                      + ' value cannot be negative ('
                                      + intval + ' < 0');
            }
          }
          if ((this._state === PARSE_KEYWORD && b[i] === CR) ||
              (this._state === PARSE_PARAM_SIZE && this._meta.keyword !== 'ANS')) {
            this._state = PARSE_PAYLOAD;
            this.emit('header', this._meta);
          } else
            ++this._state;
          if (this._expectCRLF === -1)
            ++i;
        }
        break;
      case PARSE_TRAILER:
        if (this._expectTrailer === -1 && b[i] !== ASCII_E) {
          return this._emitError('Parse Error: trailer: expected "E", got 0x'
                                 + b[i].toString(16));
        } else if (this._expectTrailer === 0 && b[i] !== ASCII_N) {
          return this._emitError('Parse Error: trailer: expected "N", got 0x'
                                 + b[i].toString(16));
        } else if (this._expectTrailer === 1) {
          if (b[i] === ASCII_D) {
            this._expectCRLF = 0;
            ++this._expectTrailer;
          } else {
            return this._emitError('Parse Error: trailer: expected "D", got 0x'
                                   + b[i].toString(16));
          }
        } else if (this._expectTrailer === 2) {
          this.emit('end');
          this.reset();
        } else
          ++this._expectTrailer;
        ++i;
        break;
    }
  }
};
BeepParser.prototype.reset = function() {
  this._state = PARSE_KEYWORD;
  this._expectCRLF = -1;
  this._expectTrailer = -1;
  this._payloadCnt = 0;
  this._meta.keyword = this._meta.chan
                     = this._meta.msgno
                     = this._meta.more
                     = this._meta.seqno
                     = this._meta.size
                     = this._meta.ansno
                     = undefined;
};
BeepParser.prototype._emitError = function(msg) {
  this.reset();
  this.emit('error', new Error(msg));
};

module.exports = BeepParser;