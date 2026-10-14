const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '../src/app/app.js'), 'utf8');
const KEY = 'ab'.repeat(32);
const KEY_HASH = crypto.createHash('sha256').update(KEY).digest('hex');

function fixture(options = {}) {
    const elements = new Map();
    const events = {};
    const calls = [];
    const requests = [];
    const scripts = [];
    const timers = new Map();
    let context;
    let timerId = 0;
    let registered = !!options.registered;
    function element(id) {
        const classes = new Set();
        return {
            id, textContent: '', disabled: false, hidden: false, scrollTop: 0, scrollHeight: 100,
            attributes: {}, children: [],
            classList: {
                contains: value => classes.has(value),
                toggle: (value, enabled) => enabled ? classes.add(value) : classes.delete(value)
            },
            setAttribute(name, value) { this.attributes[name] = value; },
            removeAttribute(name) { delete this.attributes[name]; },
            appendChild(child) { this.children.push(child); },
            focus() { context.document.activeElement = this; },
            scrollIntoView() {}, addEventListener() {},
            click() { return ({ 'renew-btn': context.renewToken, 'remove-btn': context.removeToken, 'retry-btn': context.checkRegistration, 'toggle-log-btn': context.toggleLog })[id](); }
        };
    }
    ['token', 'response', 'log-content', 'log-section', 'dialog-description', 'info-section', 'renew-btn', 'remove-btn', 'retry-btn', 'toggle-log-btn'].forEach(id => elements.set(id, element(id)));
    context = {
        console, URLSearchParams, Date,
        token: elements.get('token'), // Named DOM properties must not become API keys.
        PalmSystem: { deviceInfo: JSON.stringify({ platformVersionMajor: options.legacy ? 3 : 6 }), launchParams: JSON.stringify(options.launch || {}) },
        document: {
            activeElement: null,
            getElementById: id => elements.get(id),
            createElement: () => element(''),
            querySelectorAll: () => ['renew-btn', 'remove-btn', 'retry-btn', 'toggle-log-btn'].map(id => elements.get(id)),
            addEventListener: (event, callback) => { events[event] = callback; },
            head: { appendChild: script => scripts.push(script) }
        },
        setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
        clearTimeout: id => timers.delete(id),
        webOS: {
            service: {
                request(service, spec) {
                    calls.push({ service, spec });
                    if (spec.method === 'readFile') {
                        if (options.readFailure) spec.onFailure({ message: 'Cannot read token' });
                        else if (!options.readTimeout) spec.onSuccess({ returnValue: true, content: KEY + '\n', keyHash: options.missingHash ? undefined : KEY_HASH });
                    } else if (spec.method === 'createAlert') {
                        if (options.nativeTimeout) return;
                        if (options.nativeDenied) spec.onSuccess({ returnValue: false, errorText: 'Permission denied' });
                        else spec.onSuccess({ returnValue: true, alertId: 'test-alert' });
                    }
                }
            },
            platformBack() {}
        },
        fetch: async (url, init) => {
            requests.push({ url, init });
            if (url.endsWith('/api/key-status')) {
                if (options.statusTimeout) return new Promise(() => {});
                if (options.statusFailure) throw new Error('Offline');
                return { ok: !options.statusHTTPError, status: options.statusHTTPError || 200, json: async () => options.invalidStatus || { registered } };
            }
            if (options.networkFailure) throw new Error('Offline');
            const action = new URLSearchParams(init.body).get('action');
            if (!options.response || !options.response.error) registered = action === 'add';
            return { ok: true, json: async () => options.response || { message: action === 'add' ? 'token added successfully' : 'token removed successfully' } };
        }
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(source, context);
    return {
        context, elements, events, calls, requests, scripts,
        mutations: () => requests.filter(request => !request.url.endsWith('/api/key-status')),
        async load() { scripts[0].onload(); await flush(); },
        setRegistered(value) { registered = value; },
        expire(delay) { for (const timer of timers.values()) if (timer.delay === delay) timer.callback(); }
    };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test('native alert offers the original actions and Show Log through app relaunch', async () => {
    const app = fixture();
    await app.load();
    assert.equal(app.context.token, KEY);
    assert.equal(app.calls[0].service, 'luna://com.pirate.refresh.service');
    assert.equal(app.calls[0].spec.method, 'readFile');
    const alert = app.calls.find(call => call.spec.method === 'createAlert');
    assert.equal(alert.service, 'luna://com.webos.notification');
    const payload = JSON.parse(JSON.stringify(alert.spec.parameters));
    assert.equal(payload.modal, true);
    assert.deepEqual(payload.buttons.map(button => button.label), ['Renew Automatically', 'Show Log']);
    assert.match(payload.message, /not yet being renewed automatically/);
    assert.equal(payload.buttons[0].focus, true);
    for (const button of payload.buttons) {
        assert.equal(button.onclick, 'luna://com.webos.service.applicationmanager/launch');
        assert.equal(button.params.id, 'com.pirate.refresh');
    }
    app.events.webOSRelaunch({ detail: payload.buttons[0].params.params });
    await flush();
    assert.equal(app.mutations().length, 1);
    const request = app.mutations()[0];
    assert.equal(request.url, 'https://lg.pirate.vodka');
    assert.equal(request.init.method, 'POST');
    assert.equal(request.init.headers.Accept, 'application/json');
    assert.equal(request.init.headers['Content-Type'], 'application/x-www-form-urlencoded');
    assert.deepEqual(Object.fromEntries(new URLSearchParams(request.init.body)), { key: KEY, action: 'add' });
    assert.ok(app.calls.some(call => call.spec.method === 'closeAlert' && call.spec.parameters.alertId === 'test-alert'));
    const activeAlert = app.calls.filter(call => call.spec.method === 'createAlert').at(-1).spec.parameters;
    assert.deepEqual(Array.from(activeAlert.buttons, button => button.label), ['Stop Auto Renewal', 'Show Log']);
    assert.match(activeAlert.message, /already being renewed automatically/);
    app.events.webOSRelaunch({ detail: activeAlert.buttons[0].params.params });
    await flush();
    assert.equal(new URLSearchParams(app.mutations()[1].init.body).get('action'), 'remove');
    app.events.webOSRelaunch({ detail: payload.buttons[1].params.params });
    assert.equal(app.elements.get('log-section').attributes['aria-hidden'], 'false');
});

test('native permission denial preserves the state-appropriate fallback action', async () => {
    const app = fixture({ registered: true, nativeDenied: true });
    await app.load();
    assert.equal(app.context.nativeAlertAvailable, false);
    await app.context.removeToken();
    assert.equal(new URLSearchParams(app.mutations()[0].init.body).get('action'), 'remove');
    assert.equal(app.elements.get('response').textContent, 'token removed successfully');
    assert.equal(app.elements.get('response').attributes['data-state'], 'success');
    assert.equal(app.calls.filter(call => call.spec.method === 'createAlert').length, 1);
});

test('an unanswered native alert times out to the usable fallback', async () => {
    const app = fixture({ nativeTimeout: true });
    await app.load();
    app.expire(2000);
    assert.equal(app.context.nativeAlertAvailable, false);
    assert.equal(app.context.document.activeElement.id, 'renew-btn');
});

test('missing token never sends the named token element to the server', async () => {
    const app = fixture({ readFailure: true });
    await app.load();
    await app.context.renewToken();
    assert.equal(app.requests.length, 0);
    assert.equal(app.elements.get('response').textContent, 'Token not available!');
});

test('cold launch action waits for the helper and sends exactly one request', async () => {
    const app = fixture({ registered: true, launch: { tokenAction: 'remove' } });
    assert.equal(app.requests.length, 0);
    await app.load();
    await flush();
    assert.equal(app.mutations().length, 1);
    assert.equal(new URLSearchParams(app.mutations()[0].init.body).get('action'), 'remove');
    assert.equal(app.context.pendingLaunch, null);
});

test('relaunch uses PalmSystem.launchParams when the event has no detail', async () => {
    const app = fixture({ registered: true });
    await app.load();
    app.context.PalmSystem.launchParams = JSON.stringify({ tokenAction: 'remove' });
    app.events.webOSRelaunch({});
    await flush();
    assert.equal(new URLSearchParams(app.mutations()[0].init.body).get('action'), 'remove');
});

test('log launch remains usable even when token retrieval fails', async () => {
    const app = fixture({ readFailure: true, launch: { view: 'log' } });
    await app.load();
    assert.equal(app.elements.get('log-section').attributes['aria-hidden'], 'false');
    assert.equal(app.elements.get('toggle-log-btn').textContent, 'Hide Log');
});

test('server and network errors remain visible and restore the actions', async () => {
    for (const options of [{ response: { error: 'duplicate token hash detected - rejecting' } }, { networkFailure: true }]) {
        const app = fixture({ ...options, nativeDenied: true });
        await app.load();
        await app.context.renewToken();
        assert.equal(app.elements.get('response').attributes['data-state'], 'error');
        assert.equal(app.elements.get('renew-btn').disabled, false);
        assert.equal(app.context.requestPending, false);
    }
});

test('legacy and modern library selection is preserved', () => {
    assert.equal(fixture({ legacy: true }).scripts[0].src, 'webOSjs-0.1.0/webOS.js');
    assert.equal(fixture().scripts[0].src, 'webOSTVjs-1.2.11/webOSTV.js');
});

test('D-pad skips hidden actions and Enter opens the log', async () => {
    const app = fixture({ nativeDenied: true });
    await app.load();
    function press(keyCode) { app.events.keydown({ keyCode, preventDefault() {} }); }
    press(40);
    assert.equal(app.context.document.activeElement.id, 'toggle-log-btn');
    press(13);
    assert.equal(app.elements.get('log-section').attributes['aria-hidden'], 'false');
    press(40);
    assert.equal(app.elements.get('log-content').scrollTop, 140);
    press(461);
    assert.equal(app.elements.get('log-section').attributes['aria-hidden'], 'true');
});

test('read-only startup sends the hash and shows only Renew and Log for an absent key', async () => {
    const app = fixture();
    assert.deepEqual(Array.from(app.context.availableButtons(), button => button.id), ['toggle-log-btn']);
    await app.load();
    assert.equal(app.requests.length, 1);
    assert.equal(app.requests[0].url, 'https://lg.pirate.vodka/api/key-status');
    assert.deepEqual(Object.fromEntries(new URLSearchParams(app.requests[0].init.body)), { key_hash: KEY_HASH });
    assert.ok(!app.requests[0].init.body.includes(KEY));
    assert.equal(app.mutations().length, 0);
    assert.equal(app.elements.get('dialog-description').textContent, 'Your token is not yet being renewed automatically.');
    assert.deepEqual(Array.from(app.context.availableButtons(), button => button.id), ['renew-btn', 'toggle-log-btn']);
});

test('existing key shows only Stop and Log without attempting a duplicate registration', async () => {
    const app = fixture({ registered: true });
    await app.load();
    assert.equal(app.mutations().length, 0);
    assert.equal(app.elements.get('dialog-description').textContent, 'Your token is already being renewed automatically.');
    assert.deepEqual(Array.from(app.context.availableButtons(), button => button.id), ['remove-btn', 'toggle-log-btn']);
    const payload = app.calls.find(call => call.spec.method === 'createAlert').spec.parameters;
    assert.deepEqual(Array.from(payload.buttons, button => button.label), ['Stop Auto Renewal', 'Show Log']);
});

test('lookup failure, missing server endpoint, and malformed replies never claim inactive', async () => {
    for (const options of [{ statusFailure: true }, { statusHTTPError: 404 }, { invalidStatus: { registered: 'false' } }]) {
        const app = fixture(options);
        await app.load();
        assert.equal(app.context.registrationState, 'unknown');
        assert.deepEqual(Array.from(app.context.availableButtons(), button => button.id), ['retry-btn', 'toggle-log-btn']);
        assert.equal(app.mutations().length, 0);
        const alert = app.calls.find(call => call.spec.method === 'createAlert').spec.parameters;
        assert.deepEqual(Array.from(alert.buttons, button => button.label), ['Check Again', 'Show Log']);
    }
});

test('a status timeout leaves Retry and Log available, and Retry can recover', async () => {
    const options = { statusTimeout: true };
    const app = fixture(options);
    await app.load();
    app.expire(8000);
    await flush();
    assert.equal(app.context.registrationState, 'unknown');
    options.statusTimeout = false;
    app.setRegistered(true);
    await app.context.checkRegistration();
    assert.equal(app.context.registrationState, 'active');
    assert.equal(app.elements.get('retry-btn').hidden, true);
});

test('add and remove both recheck the server and switch to the opposite action', async () => {
    const app = fixture({ nativeDenied: true });
    await app.load();
    await app.context.renewToken();
    assert.equal(app.context.registrationState, 'active');
    assert.equal(app.elements.get('renew-btn').hidden, true);
    assert.equal(app.elements.get('remove-btn').hidden, false);
    assert.equal(app.context.document.activeElement.id, 'remove-btn');
    await app.context.removeToken();
    assert.equal(app.context.registrationState, 'inactive');
    assert.equal(app.elements.get('remove-btn').hidden, true);
    assert.equal(app.elements.get('renew-btn').hidden, false);
    assert.equal(app.context.document.activeElement.id, 'renew-btn');
    assert.equal(app.requests.filter(request => request.url.endsWith('/api/key-status')).length, 3);
});

test('a stale native action cannot renew an already registered key', async () => {
    const app = fixture({ registered: true, launch: { tokenAction: 'add' } });
    await app.load();
    app.events.webOSRelaunch({ detail: { tokenAction: 'add' } });
    await flush();
    assert.equal(app.mutations().length, 0);
    assert.equal(app.context.registrationState, 'active');
});

test('a duplicate response reconciles a registration changed by another client', async () => {
    const app = fixture({ response: { error: 'duplicate token hash detected - rejecting' } });
    await app.load();
    app.setRegistered(true);
    await app.context.renewToken();
    assert.equal(app.context.registrationState, 'active');
    assert.equal(app.elements.get('response').attributes['data-state'], 'error');
    assert.equal(app.elements.get('renew-btn').hidden, true);
});

test('an old helper without a hash does not send a raw token to the status API', async () => {
    const app = fixture({ missingHash: true });
    await app.load();
    assert.equal(app.requests.length, 0);
    assert.equal(app.context.registrationState, 'unknown');
});

test('helper hashes exactly the trimmed token used by the existing server', () => {
    const serviceSource = fs.readFileSync(path.join(__dirname, '../src/service/helloworld_service.js'), 'utf8');
    let readFile;
    const ctx = {
        require(name) {
            if (name === 'webos-service') return class { register(method, handler) { assert.equal(method, 'readFile'); readFile = handler; } };
            if (name === 'fs') return { readFile(file, encoding, callback) { assert.equal(file, '/var/luna/preferences/devmode_enabled'); callback(null, '  ' + KEY + '\n'); } };
            if (name === 'crypto') return crypto;
            if (name === './package.json') return { name: 'com.pirate.refresh.service' };
            throw new Error(name);
        }
    };
    vm.runInNewContext(serviceSource, ctx);
    readFile({ respond(response) {
        assert.equal(response.returnValue, true);
        assert.equal(response.content, KEY);
        assert.equal(response.keyHash, KEY_HASH);
    } });
});
