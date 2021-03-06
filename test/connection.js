var expect = require('chai').expect;
var log_root = require('../lib/logging').root;

var Connection = require('../lib/connection').Connection;

function callNTimes(limit, done) {
  var i = 0;
  return function() {
    i += 1;
    if (i === limit) {
      done();
    }
  };
}

var settings = {
  SETTINGS_MAX_CONCURRENT_STREAMS: 100,
  SETTINGS_INITIAL_WINDOW_SIZE: 100000
};

describe('connection.js', function() {
  describe('test scenario', function() {
    describe('connection setup', function() {
      it('should work as expected', function(done) {
        var c = new Connection(1, settings);
        var s = new Connection(2, settings);

        c.pipe(s).pipe(c);

        setTimeout(function() {
          // If there are no exception until this, then we're done
          done();
        }, 10);
      });
    });
    describe('sending/receiving a request', function() {
      it('should work as expected', function(done) {
        var c = new Connection(1, settings, log_root.child({ role: 'client' }));
        var s = new Connection(2, settings, log_root.child({ role: 'server' }));

        c.pipe(s).pipe(c);

        // Request and response data
        var request_headers = {
          ':method': 'GET',
          ':path': '/'
        };
        var request_data = new Buffer(0);
        var response_headers = {
          ':status': '200'
        };
        var response_data = new Buffer('12345678', 'hex');

        // Setting up server
        s.on('stream', function(server_stream) {
          server_stream.on('headers', function(headers) {
            expect(headers).to.deep.equal(request_headers);
            server_stream.headers(response_headers);
            server_stream.end(response_data);
          });
        });

        // Sending request
        var client_stream = c.createStream();
        client_stream.headers(request_headers);
        client_stream.end(request_data);

        // Waiting for answer
        done = callNTimes(2, done);
        client_stream.on('headers', function(headers) {
          expect(headers).to.deep.equal(response_headers);
          done();
        });
        client_stream.on('readable', function() {
          expect(client_stream.read()).to.deep.equal(response_data);
          done();
        });
      });
    });
    describe('server push', function() {
      it('should work as expected', function(done) {
        var c = new Connection(1, settings, log_root.child({ role: 'client' }));
        var s = new Connection(2, settings, log_root.child({ role: 'server' }));

        c.pipe(s).pipe(c);

        var request_headers = { ':method': 'get', ':path': '/' };
        var response_headers = { ':status': '200' };
        var push_request_headers = { ':method': 'get', ':path': '/x' };
        var push_response_headers = { ':status': '200' };
        var response_content = new Buffer(10);
        var push_content = new Buffer(10);

        done = callNTimes(4, done);

        s.on('stream', function(response) {
          response.headers(response_headers);

          var pushed = this.createStream();
          response.promise(pushed, push_request_headers);
          pushed.headers(push_response_headers);
          pushed.write(push_content);

          response.write(response_content);
        });

        var request = c.createStream();
        request.headers(request_headers);
        request.on('headers', function(headers) {
          expect(headers).to.deep.equal(response_headers);
          done();
        });
        request.on('readable', function() {
          expect(request.read()).to.deep.equal(response_content);
          done();
        });
        request.on('promise', function(pushed, headers) {
          expect(headers).to.deep.equal(push_request_headers);
          pushed.on('headers', function(headers) {
            expect(headers).to.deep.equal(response_headers);
            done();
          });
          pushed.on('readable', function() {
            expect(pushed.read()).to.deep.equal(push_content);
            done();
          });
        });
      });
    });
    describe('ping from client', function() {
      it('should work as expected', function(done) {
        var c = new Connection(1, settings, log_root.child({ role: 'client' }));
        var s = new Connection(2, settings, log_root.child({ role: 'server' }));

        c.pipe(s).pipe(c);
        c.ping(function() {
          done();
        });
      });
    });
    describe('ping from server', function() {
      it('should work as expected', function(done) {
        var c = new Connection(1, settings, log_root.child({ role: 'client' }));
        var s = new Connection(2, settings, log_root.child({ role: 'server' }));

        c.pipe(s).pipe(c);
        s.ping(function() {
          done();
        });
      });
    });
    describe('creating two streams and then using them in reverse order', function() {
      it('should not result in non-monotonous local ID ordering', function() {
        var c = new Connection(1, settings, log_root.child({ role: 'client' }));
        var s = new Connection(2, settings, log_root.child({ role: 'server' }));

        c.pipe(s).pipe(c);

        var s1 = c.createStream();
        var s2 = c.createStream();
        s2.headers({ ':method': 'get', ':path': '/' });
        s1.headers({ ':method': 'get', ':path': '/' });
      });
    });
    describe('creating two promises and then using them in reverse order', function() {
      it('should not result in non-monotonous local ID ordering', function(done) {
        var c = new Connection(1, settings, log_root.child({ role: 'client' }));
        var s = new Connection(2, settings, log_root.child({ role: 'server' }));

        c.pipe(s).pipe(c);

        s.on('stream', function(response) {
          response.headers({ ':status': '200' });

          var p1 = s.createStream();
          var p2 = s.createStream();
          response.promise(p2, { ':method': 'get', ':path': '/p2' });
          response.promise(p1, { ':method': 'get', ':path': '/p1' });
          p2.headers({ ':status': '200' });
          p1.headers({ ':status': '200' });
        });

        var request = c.createStream();
        request.headers({ ':method': 'get', ':path': '/' });

        done = callNTimes(2, done);
        request.on('promise', function() {
          done();
        });
      });
    });
  });
});
