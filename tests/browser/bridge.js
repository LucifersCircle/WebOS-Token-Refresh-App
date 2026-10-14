/* Test-only Luna bridge. The packaged app never includes this file. */
window.compatibilityScenario = /scenario=([^&]+)/.exec(location.search);
window.compatibilityScenario = window.compatibilityScenario ? window.compatibilityScenario[1] : 'success';
window.compatibilityErrors = [];
window.onerror = function (message) { window.compatibilityErrors.push(String(message)); };
window.fetch = undefined;
window.URLSearchParams = undefined;
window.WebSocket = function () { throw new Error('No SSAP service in this browser fixture'); };
window.PalmSystem = {
    identifier: 'com.pirate.refresh', launchParams: '{}',
    deviceInfo: '{"platformVersionMajor":6,"platformVersion":"06.10.60"}',
    platformBack: function () {}
};
window.PalmServiceBridge = function () {
    var bridge = this;
    bridge.cancel = function () {};
    bridge.call = function (uri) {
        if (!/\/readFile$/.test(uri)) throw new Error('Unexpected test Luna call: ' + uri);
        if (window.compatibilityScenario === 'timeout') return;
        setTimeout(function () {
            bridge.onservicecallback(JSON.stringify(window.compatibilityScenario === 'missing'
                ? { returnValue: false, errorText: 'ENOENT: test token is missing' }
                : window.compatibilityTokenResponse));
        }, 0);
    };
};
