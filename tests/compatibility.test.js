const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');

function scripts(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const file = path.join(directory, entry.name);
        return entry.isDirectory() ? scripts(file) : entry.name.endsWith('.js') ? [file] : [];
    });
}

test('every shipped app and service script parses as ES5', () => {
    for (const file of scripts(path.join(__dirname, '../src'))) {
        assert.doesNotThrow(() => acorn.parse(fs.readFileSync(file, 'utf8'), { ecmaVersion: 5 }), file);
    }
});
