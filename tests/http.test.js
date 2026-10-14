const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function fixture() {
    const requests = [], timers = new Map();
    let nextTimer = 0;
    class XHR {
        constructor() { requests.push(this); this.headers = {}; }
        open(method, url, asynchronous) { Object.assign(this, { method, url, asynchronous }); }
        setRequestHeader(name, value) { this.headers[name] = value; }
        send(body) { this.body = body; }
        abort() { this.aborted = true; this.onabort(); }
        reply(status, text) { Object.assign(this, { status, responseText: text, readyState: 4 }); this.onreadystatechange(); }
    }
    const context = {
        XMLHttpRequest: XHR,
        setTimeout(fn) { timers.set(++nextTimer, fn); return nextTimer; },
        clearTimeout(id) { timers.delete(id); }
    };
    context.window = context;
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/app/http.js'), 'utf8'), context);
    return { context, requests, timers, expire() { Array.from(timers.values()).forEach(fn => fn()); } };
}

test('XHR sends correctly escaped form fields without fetch or URLSearchParams', async () => {
    const app = fixture();
    const fields = { key: 'ab'.repeat(32), action: 'add', sample: 'space +&= / café' };
    const pending = app.context.postFormJSON('/test', fields);
    const xhr = app.requests[0];
    assert.equal(xhr.method, 'POST');
    assert.equal(xhr.asynchronous, true);
    assert.equal(xhr.headers.Accept, 'application/json');
    assert.equal(xhr.headers['Content-Type'], 'application/x-www-form-urlencoded');
    assert.deepEqual(Object.fromEntries(new URLSearchParams(xhr.body)), fields);
    xhr.reply(201, '{"message":"token added successfully"}');
    const response = await pending;
    assert.equal(response.status, 201);
    assert.equal(response.ok, true);
    assert.equal(response.data.message, 'token added successfully');
    assert.equal(app.timers.size, 0);
});

test('server JSON errors preserve the HTTP status and message', async () => {
    const app = fixture();
    const pending = app.context.postFormJSON('/test', { key_hash: 'ab'.repeat(32) });
    app.requests[0].reply(503, '{"error":"unable to check token registration"}');
    const response = await pending;
    assert.equal(response.ok, false);
    assert.equal(response.status, 503);
    assert.equal(response.data.error, 'unable to check token registration');
});

test('invalid JSON, disconnected requests, and network errors reject cleanly', async () => {
    for (const mode of ['json', 'status-zero', 'network']) {
        const app = fixture();
        const pending = app.context.postFormJSON('/test', {});
        const rejected = assert.rejects(pending, /invalid JSON|Unable to connect/);
        if (mode === 'network') app.requests[0].onerror();
        else app.requests[0].reply(mode === 'json' ? 200 : 0, '<html>Error</html>');
        await rejected;
        assert.equal(app.timers.size, 0);
    }
});

test('timeout aborts the request and ignores late completion', async () => {
    const app = fixture();
    const rejected = assert.rejects(app.context.postFormJSON('/test', {}), /timed out/);
    app.expire();
    assert.equal(app.requests[0].aborted, true);
    app.requests[0].reply(200, '{"registered":true}');
    await rejected;
    assert.equal(app.timers.size, 0);
});
