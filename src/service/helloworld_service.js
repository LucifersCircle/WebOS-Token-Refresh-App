var pkgInfo = require('./package.json');
var Service = require('webos-service');
var fs = require('fs');
var crypto = require('crypto');
var service = new Service(pkgInfo.name);

var filePath = '/var/luna/preferences/devmode_enabled';

service.register("readFile", function (message) {
    fs.readFile(filePath, 'utf8', function (err, data) {
        if (err) {
            message.respond({
                returnValue: false,
                errorText: err.message,
            });
        } else {
            message.respond({
                returnValue: true,
                content: data.trim(),
                keyHash: crypto.createHash('sha256').update(data.trim(), 'utf8').digest('hex'),
            });
        }
    });
});
