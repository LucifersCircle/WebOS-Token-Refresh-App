const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/app/native-alerts.js'), 'utf8');
const KEY_NAME = 'com.pirate.refresh.nativeAlerts.clientKey';
const flush = () => new Promise(resolve => setImmediate(resolve));

function fixture(options = {}) {
    const sockets = [], states = [], timers = new Map();
    const saved = new Map(options.key ? [[KEY_NAME, options.key]] : []);
    let sequence = 0;
    class Socket {
        constructor(url) {
            if (options.constructorFailure) throw new Error('Unavailable');
            this.url = url; this.sent = []; sockets.push(this);
        }
        open() { this.onopen(); }
        send(data) { this.sent.push(JSON.parse(data)); }
        receive(message) { this.onmessage({ data: JSON.stringify(message) }); }
        close() { if (this.closed) return; this.closed = true; if (this.onclose) this.onclose(); }
        register(key = 'test-pairing-key') {
            this.receive({ type: 'registered', id: this.sent.at(-1).id, payload: { 'client-key': key } });
        }
        respond(payload = { returnValue: true }) {
            this.receive({ type: 'response', id: this.sent.at(-1).id, payload });
        }
    }
    const context = {
        WebSocket: Socket,
        localStorage: {
            getItem: key => saved.get(key) || null,
            setItem(key, value) { if (options.storageFailure) throw new Error('Storage unavailable'); saved.set(key, value); },
            removeItem: key => saved.delete(key)
        },
        setTimeout(callback, delay) { const id = ++sequence; timers.set(id, { callback, delay }); return id; },
        clearTimeout: id => timers.delete(id)
    };
    context.window = context;
    vm.runInNewContext(source, context);
    const client = new context.NativeAlertClient({ onState: state => states.push(state) });
    return {
        client, sockets, saved, states,
        expire(delay) {
            for (const [id, timer] of Array.from(timers)) {
                if (timer.delay === delay) { timers.delete(id); timer.callback(); }
            }
        },
        async ready() { const promise = client.connect(); sockets.at(-1).open(); sockets.at(-1).register(); await promise; }
    };
}

test('first use pairs locally with only notification permission and saves the key', async () => {
    const app = fixture();
    const connecting = app.client.connect();
    assert.equal(app.client.connect(), connecting, 'concurrent callers share one pairing');
    const socket = app.sockets[0];
    assert.equal(socket.url, 'ws://127.0.0.1:3000');
    socket.open();
    const registration = socket.sent[0];
    assert.deepEqual(registration.payload.manifest.permissions, ['WRITE_NOTIFICATION_TOAST']);
    assert.equal(registration.payload.manifest.appId, 'com.pirate.refresh');
    assert.equal(registration.payload.manifest.signed, undefined);
    assert.equal(registration.payload.pairingType, 'PROMPT');
    socket.receive({ type: 'response', id: registration.id, payload: { pairingType: 'PROMPT', returnValue: true } });
    assert.equal(app.client.ready, false, 'showing the pairing prompt is not approval');
    socket.register();
    await connecting;
    assert.equal(app.saved.get(KEY_NAME), 'test-pairing-key');
    assert.equal(app.client.ready, true);
});

test('a saved key reconnects without requesting another pairing prompt', async () => {
    const app = fixture({ key: 'existing-key' });
    const connecting = app.client.connect();
    app.sockets[0].open();
    assert.deepEqual(app.sockets[0].sent[0].payload, { 'client-key': 'existing-key' });
    app.sockets[0].register('existing-key');
    await connecting;
    assert.ok(!app.states.includes('pairing'));
});

test('an explicitly revoked key is cleared and paired again once', async () => {
    const app = fixture({ key: 'revoked' });
    const connecting = app.client.connect();
    const socket = app.sockets[0]; socket.open();
    socket.receive({ type: 'error', id: socket.sent[0].id, error: '401 client-key does not exist' });
    assert.equal(app.saved.has(KEY_NAME), false);
    assert.equal(socket.sent.length, 2);
    assert.equal(socket.sent[1].payload.pairingType, 'PROMPT');
    socket.register('replacement');
    await connecting;
    assert.equal(app.saved.get(KEY_NAME), 'replacement');
});

test('network failure keeps the saved key and supports retry', async () => {
    const app = fixture({ key: 'keep-me' });
    const failed = assert.rejects(app.client.connect(), /connect/);
    app.sockets[0].onerror(); await failed;
    assert.equal(app.saved.get(KEY_NAME), 'keep-me');
    await app.ready();
    assert.equal(app.sockets.length, 2);
});

test('a service error checking saved approval does not offer fresh pairing', async () => {
    const app = fixture({ key: 'keep-me' });
    const failed = assert.rejects(app.client.connect(), error => !error.pairingFailed && /could not be checked/.test(error.message));
    const socket = app.sockets[0]; socket.open();
    socket.receive({ type: 'error', id: socket.sent[0].id, error: '500 Service unavailable' });
    await failed;
    assert.equal(app.saved.get(KEY_NAME), 'keep-me');
    assert.equal(app.states.includes('pairing'), false);
    await app.ready();
    assert.deepEqual(app.sockets[1].sent[0].payload, { 'client-key': 'keep-me' });
});

test('declined pairing and timeout reject without trapping the app', async () => {
    for (const mode of ['decline', 'timeout']) {
        const app = fixture();
        const failed = assert.rejects(app.client.connect(), error => error.pairingFailed === true && /pairing/.test(error.message));
        const socket = app.sockets[0]; socket.open();
        if (mode === 'decline') socket.receive({ type: 'error', id: socket.sent[0].id, error: '403 User rejected pairing' });
        else app.expire(60000);
        await failed;
        assert.equal(socket.closed, true);
        assert.equal(app.saved.size, 0);
        await app.ready();
    }
});

test('missing pairing keys and an unavailable WebSocket fail cleanly', async () => {
    const app = fixture();
    const failed = assert.rejects(app.client.connect(), error => error.pairingFailed === true && /key/.test(error.message));
    app.sockets[0].open(); app.sockets[0].register(''); await failed;
    const missingSocket = fixture({ constructorFailure: true });
    await assert.rejects(missingSocket.client.connect(), /unavailable/);
    assert.equal(missingSocket.client.connecting, null);
});

test('unavailable storage still permits native alerts for this session', async () => {
    const app = fixture({ storageFailure: true });
    await app.ready();
    assert.ok(app.states.includes('storage-unavailable'));
    assert.equal(app.client.key, 'test-pairing-key');
    assert.equal(app.saved.size, 0);
});

test('requests correlate replies and close alerts through SSAP', async () => {
    const app = fixture(); await app.ready(); const socket = app.sockets[0];
    const opening = app.client.request('createAlert', { message: 'Test', buttons: [{ label: 'Dismiss' }] });
    await flush();
    assert.equal(socket.sent.at(-1).uri, 'ssap://system.notifications/createAlert');
    socket.onmessage({ data: 'not json' }); socket.receive({ type: 'response', id: 'unrelated', payload: { returnValue: true } });
    socket.respond({ returnValue: true, alertId: 'alert-1' });
    assert.equal((await opening).alertId, 'alert-1');
    const closing = app.client.closeAlert('alert-1'); await flush();
    assert.equal(socket.sent.at(-1).uri, 'ssap://system.notifications/closeAlert');
    assert.deepEqual(socket.sent.at(-1).payload, { alertId: 'alert-1' });
    socket.respond(); await closing;
});

test('lost connection rejects pending requests and cleanup never starts pairing', async () => {
    const app = fixture(); await app.client.closeAlert('old-alert');
    assert.equal(app.sockets.length, 0);
    await app.ready();
    const failed = assert.rejects(app.client.request('createAlert', {}), /closed/);
    await flush(); app.sockets[0].close(); await failed;
    await app.client.closeAlert('old-alert');
    assert.equal(app.sockets.length, 1);
    await app.ready();
    assert.deepEqual(app.sockets[1].sent[0].payload, { 'client-key': 'test-pairing-key' });
});

test('request rejection falls back, and a late timed-out alert is closed', async () => {
    const app = fixture(); await app.ready(); const socket = app.sockets[0];
    const denied = assert.rejects(app.client.request('createAlert', {}), /rejected/);
    await flush(); socket.respond({ returnValue: false, errorText: 'Permission Denied' }); await denied;
    const timeout = assert.rejects(app.client.request('createAlert', {}), /timed out/);
    await flush(); const id = socket.sent.at(-1).id; app.expire(5000); await timeout;
    socket.receive({ type: 'response', id, payload: { returnValue: true, alertId: 'late-alert' } });
    await flush();
    assert.equal(socket.sent.at(-1).uri, 'ssap://system.notifications/closeAlert');
    assert.equal(socket.sent.at(-1).payload.alertId, 'late-alert');
    socket.respond();
});
