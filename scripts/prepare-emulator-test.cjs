/* Prepare a disposable fixture; production src is never modified. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const endpoint = process.argv[2];
if (!endpoint) throw new Error('Usage: node scripts/prepare-emulator-test.cjs http://TEST-SERVER:18473');
const url = new URL(endpoint);
if (!['http:', 'https:'].includes(url.protocol) || url.hostname === 'lg.pirate.vodka' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Provide the origin of an isolated test server, not the production service.');
}
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'artifacts/emulator-test');
fs.mkdirSync(output, { recursive: true });
for (const directory of ['app', 'service']) {
    fs.rmSync(path.join(output, directory), { recursive: true, force: true });
    fs.cpSync(path.join(root, 'src', directory), path.join(output, directory), { recursive: true });
}
const app = path.join(output, 'app/app.js');
fs.writeFileSync(app, fs.readFileSync(app, 'utf8').replaceAll('https://lg.pirate.vodka', url.origin));
const helper = path.join(output, 'service/helloworld_service.js');
const source = fs.readFileSync(helper, 'utf8');
const original = "var filePath = '/var/luna/preferences/devmode_enabled';";
assert.ok(source.includes(original));
fs.writeFileSync(helper, source.replace(original, "var filePath = '/tmp/auto-token-refresh-test-token';"));
fs.writeFileSync(path.join(output, 'fake-token.txt'), 'ab'.repeat(32) + '\n');
console.log('Test app and helper prepared in ' + output);
console.log('Server: ' + url.origin);
console.log('Emulator token fixture: /tmp/auto-token-refresh-test-token');
