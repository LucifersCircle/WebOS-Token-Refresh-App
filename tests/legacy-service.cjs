/* Run with Node 0.12.2 as well as the current development Node version. */
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var crypto = require('crypto');
var source = fs.readFileSync(path.join(__dirname, '../src/service/helloworld_service.js'), 'utf8');
var token = new Array(65).join('a');

function run(readError) {
    var handler;
    vm.runInNewContext(source, {
        require: function (name) {
            if (name === './package.json') return { name: 'com.pirate.refresh.service' };
            if (name === 'crypto') return crypto;
            if (name === 'webos-service') return function () {
                this.register = function (method, callback) {
                    assert.equal(method, 'readFile');
                    handler = callback;
                };
            };
            if (name === 'fs') return { readFile: function (file, encoding, callback) {
                assert.equal(file, '/var/luna/preferences/devmode_enabled');
                assert.equal(encoding, 'utf8');
                callback(readError, '  ' + token + '\n');
            } };
            throw new Error('Unexpected dependency: ' + name);
        }
    });
    var responded = false;
    handler({ respond: function (response) {
        responded = true;
        if (readError) {
            assert.equal(response.returnValue, false);
            assert.equal(response.errorText, readError.message);
        } else {
            assert.equal(response.returnValue, true);
            assert.equal(response.content, token);
            assert.equal(response.keyHash, crypto.createHash('sha256').update(token, 'utf8').digest('hex'));
        }
    } });
    assert.ok(responded);
}

run(null);
run(new Error('EACCES: permission denied'));
run(new Error('EISDIR: token path is a directory'));
console.log('Token helper passed read/hash/error checks on Node ' + process.version);
