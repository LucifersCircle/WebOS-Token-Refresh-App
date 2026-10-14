/* Add/remove keep the original server contract; status sends only the key hash. */
var TOKEN_SERVICE = 'luna://com.pirate.refresh.service';
var NOTIFICATION_SERVICE = 'luna://com.webos.notification';
var APP_ID = 'com.pirate.refresh';
var nativeAlertAvailable = true;
var nativeAlertId = null;
var nativeAlertPending = false;
var requestPending = false;
var statusPending = false;
var registrationState = 'checking';
var keyHash = null;
var libraryReady = false;
var pendingLaunch = null;
// The token element's ID is also exposed as a window property by browsers.
window.token = null;

function logEvent(message) {
    var content = document.getElementById('log-content');
    var entry = document.createElement('p');
    entry.textContent = '[' + new Date().toLocaleTimeString() + '] ' + message;
    content.appendChild(entry);
    content.scrollTop = content.scrollHeight;
}

function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, function (character) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
}

function availableButtons() {
    return Array.prototype.filter.call(document.querySelectorAll('button'), function (button) {
        return !button.hidden && !button.disabled;
    });
}

function focusButton(id) {
    var button = id && document.getElementById(id);
    if (!button || button.hidden || button.disabled) button = availableButtons()[0];
    if (button) button.focus();
}

function stateDescription() {
    return {
        checking: 'Checking automatic renewal…',
        active: 'Your token is already being renewed automatically.',
        inactive: 'Your token is not yet being renewed automatically.',
        unknown: 'Unable to check automatic renewal. Please try again.'
    }[registrationState];
}

function renderRegistration() {
    document.getElementById('dialog-description').textContent = stateDescription();
    var renew = document.getElementById('renew-btn');
    var remove = document.getElementById('remove-btn');
    var retry = document.getElementById('retry-btn');
    renew.hidden = registrationState !== 'inactive';
    remove.hidden = registrationState !== 'active';
    retry.hidden = registrationState !== 'unknown';
    renew.disabled = remove.disabled = requestPending || statusPending;
    retry.disabled = statusPending || requestPending || !window.token || !keyHash;
    document.getElementById('info-section').textContent = registrationState === 'active'
        ? 'You can uninstall this app. Your token will continue to be refreshed automatically.'
        : registrationState === 'inactive'
            ? 'Select “Renew Automatically” to enable automatic renewal. You can then uninstall this app.'
            : '';
    var focused = document.activeElement;
    if (!focused || focused.hidden || focused.disabled) focusButton();
}

async function checkRegistration(openAlert) {
    if (statusPending || requestPending || !window.token || !keyHash) return false;
    closeNativeAlert();
    statusPending = true;
    registrationState = 'checking';
    renderRegistration();
    var timer;
    logEvent('Checking token registration by SHA-256 hash…');
    try {
        var lookup = fetch('https://lg.pirate.vodka/api/key-status', {
            method: 'POST',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ key_hash: keyHash }).toString()
        }).then(async function (response) {
            if (!response.ok) throw new Error('Status lookup returned HTTP ' + response.status);
            var json = await response.json();
            if (typeof json.registered !== 'boolean') throw new Error('Invalid registration response');
            return json.registered;
        });
        var timeout = new Promise(function (resolve, reject) {
            timer = setTimeout(function () { reject(new Error('Status lookup timed out')); }, 8000);
        });
        registrationState = await Promise.race([lookup, timeout]) ? 'active' : 'inactive';
        logEvent(registrationState === 'active' ? 'Token is registered for automatic renewal.' : 'Token is not registered for automatic renewal.');
    } catch (error) {
        registrationState = 'unknown';
        logEvent('Unable to check automatic renewal: ' + error.message);
    } finally {
        clearTimeout(timer);
        statusPending = false;
        renderRegistration();
    }
    if (!document.getElementById('log-section').classList.contains('expanded')) focusButton();
    if (openAlert !== false) showNativeAlert();
    return registrationState !== 'unknown';
}

function toggleLog(forceOpen) {
    var section = document.getElementById('log-section');
    var open = forceOpen === true || !section.classList.contains('expanded');
    section.classList.toggle('expanded', open);
    section.setAttribute('aria-hidden', String(!open));
    var button = document.getElementById('toggle-log-btn');
    button.textContent = open ? 'Hide Log' : 'Show Log';
    button.setAttribute('aria-expanded', String(open));
    button.focus();
    button.scrollIntoView(false);
}

function alertButton(label, params, focus) {
    return {
        label: label,
        focus: !!focus,
        onclick: 'luna://com.webos.service.applicationmanager/launch',
        params: { id: APP_ID, params: params }
    };
}

function showNativeAlert(result) {
    if (!libraryReady || !nativeAlertAvailable || nativeAlertPending || !window.token) return;
    if (statusPending || registrationState === 'checking') return;
    if (document.getElementById('log-section').classList.contains('expanded')) return;
    nativeAlertPending = true;
    var message = '<b>Automatic webOS Token Refresh</b><br/><br/>';
    message += escapeHTML(stateDescription());
    if (result) message += '<br/><br/>' + escapeHTML(result);
    message += '<br/><br/>Your token:<br/>' + escapeHTML(window.token);
    var info = document.getElementById('info-section').textContent;
    if (info) message += '<br/><br/>' + escapeHTML(info);
    var buttons = [];
    if (registrationState === 'active') buttons.push(alertButton('Stop Auto Renewal', { tokenAction: 'remove' }, true));
    else if (registrationState === 'inactive') buttons.push(alertButton('Renew Automatically', { tokenAction: 'add' }, true));
    else buttons.push(alertButton('Check Again', { view: 'status' }, true));
    buttons.push(alertButton('Show Log', { view: 'log' }));
    var timer = setTimeout(function () {
        nativeAlertPending = false;
        nativeAlertAvailable = false;
        logEvent('System alert timed out; using the app dialog.');
        focusButton();
    }, 2000);
    function fallback(error) {
        clearTimeout(timer);
        nativeAlertPending = false;
        nativeAlertAvailable = false;
        logEvent('System alert unavailable; using the app dialog. ' + (error.errorText || error.message || ''));
        focusButton();
    }
    try {
        webOS.service.request(NOTIFICATION_SERVICE, {
            method: 'createAlert',
            parameters: {
                message: message,
                modal: true,
                buttons: buttons
            },
            onSuccess: function (response) {
                if (!response.returnValue) return fallback(response);
                clearTimeout(timer);
                nativeAlertPending = false;
                nativeAlertAvailable = true;
                nativeAlertId = response.alertId;
                logEvent('System alert opened.');
            },
            onFailure: fallback
        });
    } catch (error) { fallback(error); }
}

function closeNativeAlert() {
    if (!nativeAlertId) return;
    var alertId = nativeAlertId;
    nativeAlertId = null;
    try {
        webOS.service.request(NOTIFICATION_SERVICE, {
            method: 'closeAlert',
            parameters: { alertId: alertId },
            onFailure: function (error) { logEvent('System alert close: ' + (error.errorText || error.message || 'already closed')); }
        });
    } catch (error) { logEvent('System alert close: ' + error.message); }
}

function fetchToken() {
    var tokenElement = document.getElementById('token');
    tokenElement.textContent = 'Fetching token from /var/luna/preferences/devmode_enabled';
    logEvent('Starting token fetch…');
    var timeout = setTimeout(function () {
        tokenElement.textContent = 'Token fetch timed out.';
        logEvent('Token fetch timed out.');
        registrationState = 'unknown';
        renderRegistration();
    }, 5000);
    function fail(message) {
        clearTimeout(timeout);
        tokenElement.textContent = message;
        logEvent(message);
        registrationState = 'unknown';
        renderRegistration();
    }
    try {
        webOS.service.request(TOKEN_SERVICE, {
            method: 'readFile',
            onSuccess: function (response) {
                clearTimeout(timeout);
                if (!response.returnValue) return fail('Error: ' + response.errorText);
                window.token = response.content.trim();
                keyHash = response.keyHash;
                if (!window.token) return fail('Developer mode token file is empty.');
                tokenElement.textContent = window.token;
                logEvent('Token retrieved successfully.');
                if (typeof keyHash !== 'string' || !/^[a-f0-9]{64}$/.test(keyHash)) {
                    keyHash = null;
                    registrationState = 'unknown';
                    renderRegistration();
                    logEvent('The token helper did not provide a SHA-256 hash. Update the app and helper together.');
                    return;
                }
                checkRegistration(false).then(function () {
                    if (pendingLaunch) {
                        var params = pendingLaunch;
                        pendingLaunch = null;
                        handleLaunch(params);
                    } else { showNativeAlert(); }
                });
            },
            onFailure: function (error) { fail('Error fetching token: ' + (error.errorText || error.message || 'Service call failed.')); }
        });
    } catch (error) { fail('Exception fetching token: ' + error.message); }
}

function createPayload(action) {
    if (!window.token) {
        displayResponse({ error: 'Token not available!' });
        return null;
    }
    return new URLSearchParams({ key: window.token, action: action }).toString();
}

async function sendRequest(action) {
    if (requestPending || statusPending) return;
    var payload = createPayload(action);
    if (!payload) return;
    if ((action !== 'add' || registrationState !== 'inactive') &&
        (action !== 'remove' || registrationState !== 'active')) return;
    closeNativeAlert();
    requestPending = true;
    renderRegistration();
    var responseElement = document.getElementById('response');
    responseElement.textContent = action === 'add' ? 'Enabling automatic renewal…' : 'Stopping automatic renewal…';
    responseElement.removeAttribute('data-state');
    logEvent('Sending request for action: ' + action);
    try {
        var response = await fetch('https://lg.pirate.vodka', {
            method: 'POST',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
            body: payload
        });
        var json = await response.json();
        logEvent('Server response received for action: ' + action + ': ' + JSON.stringify(json));
        displayResponse(json);
    } catch (error) {
        logEvent('Error during request for action ' + action + ': ' + error.message);
        displayResponse({ error: 'Failed to ' + action + ' token' });
    } finally {
        requestPending = false;
        await checkRegistration(false);
        renderRegistration();
        focusButton();
        showNativeAlert(responseElement.textContent);
    }
}

function renewToken() { return sendRequest('add'); }
function removeToken() { return sendRequest('remove'); }

function displayResponse(response) {
    var element = document.getElementById('response');
    element.textContent = response.error || response.message || JSON.stringify(response, null, 2);
    element.setAttribute('data-state', response.error ? 'error' : (response.message ? 'success' : 'neutral'));
}

function readLaunchParams(event) {
    try {
        var system = window.webOSSystem || window.PalmSystem;
        var params = event && event.detail ? event.detail : (system && system.launchParams);
        return typeof params === 'string' ? JSON.parse(params || '{}') : (params || {});
    } catch (error) {
        logEvent('Unable to read launch parameters: ' + error.message);
        return {};
    }
}

function handleLaunch(params) {
    if (params.tokenAction !== 'add' && params.tokenAction !== 'remove' && params.view !== 'log' && params.view !== 'status') return;
    if (params.view === 'log') { closeNativeAlert(); toggleLog(true); return; }
    if (!libraryReady || !window.token || statusPending || registrationState === 'checking') { pendingLaunch = params; return; }
    if (params.view === 'status') { checkRegistration(); return; }
    closeNativeAlert();
    if ((params.tokenAction === 'add' && registrationState === 'inactive') ||
        (params.tokenAction === 'remove' && registrationState === 'active')) sendRequest(params.tokenAction);
    else showNativeAlert();
}

document.addEventListener('webOSRelaunch', function (event) { handleLaunch(readLaunchParams(event)); });

function loadWebOSLibrary() {
    var legacy = false;
    try {
        var info = JSON.parse((window.PalmSystem && window.PalmSystem.deviceInfo) || '{}');
        legacy = !!info.platformVersionMajor && parseInt(info.platformVersionMajor, 10) < 4;
    } catch (error) { logEvent('Error reading deviceInfo: ' + error.message); }
    var script = document.createElement('script');
    script.src = legacy ? 'webOSjs-0.1.0/webOS.js' : 'webOSTVjs-1.2.11/webOSTV.js';
    logEvent('Loading ' + (legacy ? 'webOS.js' : 'webOSTV.js'));
    script.onload = script.onerror = function () { libraryReady = true; fetchToken(); };
    document.head.appendChild(script);
}

/* Navigation includes only visible, enabled buttons. */
document.addEventListener('keydown', function (event) {
    var key = event.keyCode || event.which;
    var buttons = availableButtons();
    var index = buttons.indexOf(document.activeElement);
    if (key === 37 || key === 38 || key === 39 || key === 40) {
        event.preventDefault();
        if (document.getElementById('log-section').classList.contains('expanded') && (key === 38 || key === 40)) {
            document.getElementById('log-content').scrollTop += key === 38 ? -40 : 40;
            return;
        }
        var step = key === 37 || key === 38 ? -1 : 1;
        if (buttons.length) buttons[(index + step + buttons.length) % buttons.length].focus();
    } else if (key === 13 && index !== -1) {
        event.preventDefault();
        buttons[index].click();
    } else if (key === 461) {
        event.preventDefault();
        if (document.getElementById('log-section').classList.contains('expanded')) toggleLog();
        else if (window.webOS && webOS.platformBack) webOS.platformBack();
    }
});
Array.prototype.forEach.call(document.querySelectorAll('button'), function (button) {
    button.addEventListener('mouseenter', function () { if (!button.disabled) button.focus(); });
});

pendingLaunch = readLaunchParams();
if (!pendingLaunch.tokenAction && pendingLaunch.view !== 'log' && pendingLaunch.view !== 'status') pendingLaunch = null;
renderRegistration();
focusButton();
if (pendingLaunch && pendingLaunch.view === 'log') {
    handleLaunch(pendingLaunch);
    pendingLaunch = null;
}
loadWebOSLibrary();
