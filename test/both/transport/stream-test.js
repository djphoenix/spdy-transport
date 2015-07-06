var assert = require('assert');
var async = require('async');
var fixtures = require('./fixtures');

var expectData = fixtures.expectData;
var everyProtocol = fixtures.everyProtocol;

var transport = require('../../../');

describe('Transport/Stream', function() {
  everyProtocol(function(name, version) {
    var server;
    var client;
    var pair;

    beforeEach(function() {
      server = fixtures.server;
      client = fixtures.client;
      pair = fixtures.pair;
    });

    it('should send request', function(done) {
      var sent = false;
      var received = false;

      client.request({
        method: 'GET',
        path: '/hello',
        headers: {
          a: 'b',
          c: 'd'
        }
      }, function(err, stream) {
        assert(!err);
        sent = true;

        stream.on('response', function(code, headers) {
          assert(received);

          assert.equal(code, 200);
          assert.equal(headers.ohai, 'yes');
          done();
        });
      });

      server.on('stream', function(stream) {
        stream.respond(200, {
          ohai: 'yes'
        });

        received = true;

        assert(sent);
        assert.equal(stream.method, 'GET');
        assert.equal(stream.path, '/hello');
        assert.equal(stream.headers.a, 'b');
        assert.equal(stream.headers.c, 'd');
      });
    });

    it('should send data on request', function(done) {
      client.request({
        method: 'GET',
        path: '/hello-with-data',
        headers: {
          a: 'b',
          c: 'd'
        }
      }, function(err, stream) {
        assert(!err);

        stream.write('hello ');
        stream.end('world');
      });

      server.on('stream', function(stream) {
        stream.respond(200, {
          ohai: 'yes'
        });

        expectData(stream, 'hello world', done);
      });
    });

    it('should send data after response', function(done) {
      client.request({
        method: 'GET',
        path: '/hello-with-data',
        headers: {
          a: 'b',
          c: 'd'
        }
      }, function(err, stream) {
        assert(!err);

        var gotResponse = false;
        stream.on('response', function() {
          gotResponse = true;
        });

        expectData(stream, 'ohai', function() {
          assert(gotResponse);
          done();
        });
      });

      server.on('stream', function(stream) {
        stream.respond(200, {
          ohai: 'yes'
        });

        stream.end('ohai');
      });
    });

    it('should timeout when sending data request', function(done) {
      client.request({
        path: '/hello-with-data'
      }, function(err, stream) {
        assert(!err);

        stream.on('error', function() {
          // Ignore errors
        });

        stream.write('hello ');
        setTimeout(function() {
          stream.end('world');
        }, 100);
      });

      server.on('stream', function(stream) {
        stream.respond(200, {
          ohai: 'yes'
        });

        stream.setTimeout(50, function() {
          stream.abort();
          done();
        });

        expectData(stream, 'hello world', function() {
          assert(false);
        });
      });
    });

    it('should not timeout when sending data request', function(done) {
      client.request({
        path: '/hello-with-data'
      }, function(err, stream) {
        assert(!err);

        stream.on('error', function() {
          assert(false);
        });

        stream.write('hello ');
        setTimeout(function() {
          stream.end('world');
        }, 50);
      });

      server.on('stream', function(stream) {
        stream.respond(200, {
          ohai: 'yes'
        });

        stream.setTimeout(100, function() {
          assert(false);
        });

        expectData(stream, 'hello world', function() {
          stream.setTimeout(0);
          done();
        });
      });
    });

    it('should fail to send data after FIN', function(done) {
      client.request({
        method: 'GET',
        path: '/hello-with-data',
        headers: {
          a: 'b',
          c: 'd'
        }
      }, function(err, stream) {
        assert(!err);

        stream.write('hello ');
        stream.end('world', function() {
          stream._spdyState.framer.dataFrame({
            id: stream.id,
            priority: 0,
            fin: false,
            data: new Buffer('no way')
          });
        });

        stream.on('error', next);
      });

      server.on('stream', function(stream) {
        stream.respond(200, {
          ohai: 'yes'
        });

        expectData(stream, 'hello world', next);
      });

      var waiting = 2;
      function next() {
        if (--waiting === 0)
          return done();
      }
    });

    it('should truncate data to fit maxChunk', function(done) {
      var big = new Buffer(1024);
      big.fill('a');

      client.request({
        path: '/hello-with-data'
      }, function(err, stream) {
        assert(!err);

        stream.setMaxChunk(10);
        stream.end(big);
      });

      server.on('stream', function(stream) {
        stream.respond(200, {
          ohai: 'yes'
        });

        stream.on('data', function(chunk) {
          assert(chunk.length <= 10);
        });
        expectData(stream, big, done);
      });
    });

    it('should control the flow of the request', function(done) {
      var a = new Buffer(128);
      a.fill('a');
      var b = new Buffer(128);
      b.fill('b');

      client.request({
        method: 'GET',
        path: '/hello-flow',
        headers: {
          a: 'b',
          c: 'd'
        }
      }, function(err, stream) {
        assert(!err);

        stream.setWindow(128);

        // Make sure settings will be applied before this
        stream.on('response', function() {
          stream.write(a);
          stream.write(b);
          stream.write(a);
          stream.end(b);
        });
      });

      server.on('stream', function(stream) {
        stream.setWindow(128);
        stream.respond(200, {});

        expectData(stream, a + b + a + b, done);
      });
    });

    it('should emit `close` on stream', function(done) {
      client.request({
        method: 'GET',
        path: '/hello-close',
        headers: {
          a: 'b',
          c: 'd'
        }
      }, function(err, stream) {
        stream.on('close', done);
        stream.resume();
        stream.end();
      });

      server.on('stream', function(stream) {
        stream.respond(200, {});
        stream.resume();
        stream.end();
      });
    });

    it('should split the data if it is too big', function(done) {
      var a = new Buffer(1024);
      a.fill('a');

      client.request({
        path: '/hello-split'
      }, function(err, stream) {
        assert(!err);

        // Make sure settings will be applied before this
        stream.on('response', function() {
          stream.end(a);
        });
      });

      server.on('stream', function(stream) {
        stream.respond(200, {});

        expectData(stream, a, done);
      });
    });

    it('should emit trailing headers', function(done) {
      client.request({
        path: '/hello-split'
      }, function(err, stream) {
        assert(!err);

        // Make sure settings will be applied before this
        stream.on('response', function() {
          stream.write('hello');
          stream.sendHeaders({ trailer: 'yes' });
          stream.end();
        });
      });

      server.on('stream', function(stream) {
        stream.respond(200, {});

        stream.resume();
        stream.on('headers', function(headers) {
          assert.equal(headers.trailer, 'yes');
          done();
        });
      });
    });

    it('should abort request', function(done) {
      client.request({
        path: '/hello-split'
      }, function(err, stream) {
        assert(!err);

        stream.on('error', function(err) {
          assert(err);
          done();
        });
      });

      server.on('stream', function(stream) {
        stream.abort();
      });
    });

    it('should abort request with pending write', function(done) {
      client.request({
        path: '/hello-split'
      }, function(err, stream) {
        assert(!err);

        stream.on('data', function() {
          assert(false, 'got data on aborted stream');
        });

        stream.on('error', function(err) {
          assert(err);
        });
      });

      server.on('stream', function(stream) {
        stream.write('hello', function(err) {
          assert(err);

          // Make sure it will emit the errors
          process.nextTick(done);
        });
        stream.on('error', function(err) {
          assert(err);
        });

        stream.abort();
      });
    });

    it('should abort request on closed stream', function(done) {
      client.request({
        path: '/hello-split'
      }, function(err, stream) {
        assert(!err);

        stream.resume();
        stream.end();
      });

      server.on('stream', function(stream) {
        stream.respond(200, {});
        stream.resume();
        stream.end();

        stream.once('close', function() {
          stream.abort(done);
        });
      });
    });

    it('should create prioritized stream', function(done) {
      client.request({
        path: '/path',
        priority: {
          parent: 0,
          exclusive: false,
          weight: 42
        }
      }, function(err, stream) {
        assert(!err);
      });

      server.on('stream', function(stream) {
        var priority = stream._spdyState.priority;

        // SPDY has just 3 bits of priority, can't fit 256 range into it
        if (version >= 4)
          assert.equal(priority.weight, 42);
        else
          assert.equal(priority.weight, 36);
        done();
      });
    });

    if (version >= 4) {
      it('should update stream priority', function(done) {
        client.request({
          method: 'GET',
          path: '/hello-split'
        }, function(err, stream) {
          assert(!err);

          stream.on('priority', function(info) {
            assert.equal(info.parent, 0);
            assert.equal(info.exclusive, false);
            assert.equal(info.weight, 42);
            done();
          });
        });

        server.on('stream', function(stream) {
          stream.setPriority({ parent: 0, exclusive: false, weight: 42 });
        });
      });
    }
  });
});