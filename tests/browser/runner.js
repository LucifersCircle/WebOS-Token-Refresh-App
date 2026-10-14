/* Runs the complete app page; requires no fetch, URLSearchParams, or async syntax. */
(function () {
    var result = window.testResults = { scenario: window.compatibilityScenario, userAgent: navigator.userAgent, checks: [] };
    function check(condition, name) {
        if (!condition) throw new Error(name);
        result.checks.push(name);
    }
    function waitFor(predicate) {
        return new Promise(function (resolve, reject) {
            var deadline = Date.now() + 12000;
            function poll() {
                if (predicate()) { resolve(); return; }
                if (Date.now() > deadline) { reject(new Error('App did not settle before the test deadline')); return; }
                setTimeout(poll, 25);
            }
            poll();
        });
    }
    function press(key) {
        var event = document.createEvent('Event');
        event.initEvent('keydown', true, true);
        event.keyCode = key;
        document.dispatchEvent(event);
    }
    waitFor(function () { return !document.getElementById('app-container').hidden; }).then(function () {
        check(typeof fetch === 'undefined' && typeof URLSearchParams === 'undefined', 'App starts without modern request APIs');
        check(window.compatibilityErrors.length === 0, 'No script or startup errors');
        document.getElementById('toggle-log-btn').focus();
        press(13);
        check(document.getElementById('log-section').classList.contains('expanded'), 'Enter opens Show Log');
        press(461);
        check(!document.getElementById('log-section').classList.contains('expanded'), 'Back closes the log');
        if (result.scenario !== 'success') {
            check(registrationState === 'unknown', 'Helper failure stays unknown');
            check(!window.token, 'No token invented after helper failure');
            check(/missing|timed out/.test(document.getElementById('token').textContent), 'Helper failure or timeout is visible');
            return;
        }
        check(window.token === window.compatibilityTokenResponse.content, 'Token retrieved and displayed');
        check(registrationState === 'inactive', 'Hash lookup reports unregistered');
        document.getElementById('renew-btn').click();
        return waitFor(function () { return !requestPending && !statusPending && registrationState === 'active'; }).then(function () {
            check(!document.getElementById('remove-btn').hidden, 'Add succeeds and exposes Stop Auto Renewal');
            document.getElementById('remove-btn').click();
            return waitFor(function () { return !requestPending && !statusPending && registrationState === 'inactive'; });
        }).then(function () {
            check(!document.getElementById('renew-btn').hidden, 'Remove succeeds and exposes Renew Automatically');
            check(window.compatibilityErrors.length === 0, 'No errors during token actions');
        });
    }).catch(function (error) {
        result.failure = error.message;
    }).then(function () {
        result.errors = window.compatibilityErrors;
        document.title = 'COMPLETE';
    });
}());
