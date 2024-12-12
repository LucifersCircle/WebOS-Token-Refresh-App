var pkgInfo = require('./package.json');
var Service = require('webos-service');
var fs = require('fs');
var service = new Service(pkgInfo.name);

var filePath = '/var/luna/preferences/devmode_enabled';

service.register("readFile", function (message) {
    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
            message.respond({
                returnValue: false,
                errorText: err.message,
            });
        } else {
            message.respond({
                returnValue: true,
                content: data.trim(),
            });
        }
    });
});