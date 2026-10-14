/* Launch with Electron 1.4.16 (Chromium 53); this uses its callback-based APIs. */
var electron = require('electron');
var fs = require('fs');
var path = require('path');
var app = electron.app;
var output = process.env.SMOKE_RESULT_PATH || path.resolve('artifacts/browser-smoke/results.json');
var profile = path.join(path.dirname(output), 'profile');
if (!fs.existsSync(profile)) fs.mkdirSync(profile);
app.setPath('userData', profile);
app.setPath('appData', profile);
app.disableHardwareAcceleration();
var results = { runtime: process.versions, cases: [] };
var scenarios = ['success', 'missing', 'timeout'];
var timer = setTimeout(function () { console.error('Browser smoke timed out'); app.exit(1); }, 45000);
app.on('ready', function () {
    var win = new electron.BrowserWindow({show: false, width: 1920, height: 1080, webPreferences: {nodeIntegration: false}});
    function next() {
        win.loadURL((process.env.SMOKE_SERVER_URL || 'http://127.0.0.1:18473') + '/app/index.html?scenario=' + scenarios.shift());
    }
    win.on('page-title-updated', function (event, title) {
        if (title !== 'COMPLETE') return;
        win.webContents.executeJavaScript('window.testResults', function (result) {
            results.cases.push(result);
            if (scenarios.length) { next(); return; }
            fs.writeFileSync(output, JSON.stringify(results, null, 2));
            console.log(JSON.stringify(results, null, 2));
            clearTimeout(timer);
            app.exit(results.cases.some(function (item) { return item.failure || item.errors.length; }) ? 1 : 0);
        });
    });
    next();
});
