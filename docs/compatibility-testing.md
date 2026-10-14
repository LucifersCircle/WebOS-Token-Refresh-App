# Older webOS compatibility: cloud test handoff

Test the current head of PR #9, branch `native-token-alert`, in
`LucifersCircle/WebOS-Token-Refresh-App`. Record the exact commit tested.
The first priority is an actual webOS 3.x emulator, followed by webOS 4.x.
Do not use a newer simulator's version label as evidence of an older browser.

## What the reports suggest

- [Issue #3](https://github.com/LucifersCircle/WebOS-Token-Refresh-App/issues/3):
  the OLED65E6T reporter identifies webOS 3.4.2 and describes a permanent
  fetching message, no timeout, and an unresponsive Show Log button. Unsupported
  script syntax can prevent all those functions from being defined. Other
  comments report a token that displays but cannot be submitted, and one describes
  a token path that is a directory. These are distinct failure cases.
- [Issues #4](https://github.com/LucifersCircle/WebOS-Token-Refresh-App/issues/4)
  and [#6](https://github.com/LucifersCircle/WebOS-Token-Refresh-App/issues/6)
  report non-working buttons. They need pointer and remote navigation tests;
  the reports do not establish one common cause.
- [Issue #7](https://github.com/LucifersCircle/WebOS-Token-Refresh-App/issues/7):
  actual Chromium 53 sends `%5Bobject+Object%5D=` for the old object-based
  `URLSearchParams` call. The real server then returns `token is required`.

The fix uses ES5 syntax throughout shipped scripts, XHR with explicitly encoded
form fields, and Promise chains instead of async functions. The helper's arrow
callback is replaced with an ES5 function. Library selection uses Chromium's
version rather than mistaking the firmware number for the webOS SDK version.

## Required environments and evidence

| Environment | Why it matters |
| --- | --- |
| webOS 3.x emulator / Chromium 38 / Node 0.12.2 | Issue #3 startup, helper, missing modern APIs, remote controls |
| webOS 4.x emulator / Chromium 53 / Node 0.12.2 | Form encoding and complete app/service integration |
| Newer simulator or TV | Native-alert and fallback regression checks |

LG's [engine table](https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine)
and [service runtime table](https://webostv.developer.lge.com/develop/guides/js-service-basics)
describe these versions. The
[older emulator](https://webostv.developer.lge.com/develop/tools/emulator-installation)
needs Intel VirtualBox. Check whether the cloud environment supports it before
downloading a VM. If it cannot boot, report the limitation and which browser/runtime
tests actually ran. Do not claim full emulator coverage from a browser test.

Capture `navigator.userAgent`, the real `sdkVersion` from `getSystemInfo`, helper
`node --version`, and any console or service errors. `05.40.97` and `06.10.60`
are firmware-style versions and must not be assumed to identify the webOS SDK.
webOS 1.x/2.x are not validated by this fix; Promise availability and their older
WebKit engines need separate work before claiming support.

## Automated checks

Use Node 18+ for development checks, which are not the TV's service runtime:

```sh
npm ci
npm test
```

This includes an ES5 parse check for every shipped JavaScript file, HTTP encoding
and failure tests, and native dialog/action regressions. Independently run:

```sh
/path/to/node-v0.12.2/bin/node tests/legacy-service.cjs
```

That runs the real helper source with a controlled filesystem and service bridge.
It checks token reading, trimming, SHA-256 output, and read errors using Node's
actual crypto implementation. It does not prove Luna integration on an emulator.

## Full browser test with the real server

Check out `LucifersCircle/webOS-Token-Refresh` at a revision containing
`/api/key-status` (the locally tested revision was
`cae6725302e777b2e4d55a5c3b640b059f8a5274`). In a disposable Python environment,
install Flask and cryptography. Then, from this app repository:

```sh
mkdir -p artifacts/browser-smoke
python tests/browser/server.py --server-source /path/to/webOS-Token-Refresh/app.py
```

The server binds to loopback and uses its own database and encryption key in the
test process. It serves a test copy of the complete app, redirects its requests
to the local server, and supplies fake Luna token responses. It does not modify
`src`, use a real token, or contact the production renewal service.
Use a fresh `--data-dir` for each server run, or, after stopping the server, remove
only the generated `artifacts/browser-smoke/test-keys.db` before rerunning. This
ensures an interrupted add/remove test does not leave the fake token registered.

In a second terminal, run the official Electron 1.4.16 executable (Chromium
53.0.2785.143; verify the release archive against its official SHA-256 file):

```sh
/path/to/electron tests/browser
```

On Linux a graphical session or Xvfb is needed. `SMOKE_SERVER_URL` and
`SMOKE_RESULT_PATH` can override the default loopback address and output path.
The runner targets Electron 1.4.16's APIs. Other browser engines can load
`http://127.0.0.1:18473/app/index.html?scenario=success` directly; also test
`scenario=missing` and `scenario=timeout`, and inspect `window.testResults`.
Native WebSocket alerts are deliberately unavailable in this fixture, so it tests
the real fallback. `fetch` and `URLSearchParams` are removed from the page.

Expected: token display, hash-only lookup, add/remove transitions, Enter opening
the log, Back closing it, no uncaught script errors, and usable log controls on
missing-token and timeout paths. Results go to `artifacts/browser-smoke/results.json`
and server observations to `http-results.jsonl` (field names and responses only).
Stop the test server afterward. These are browser checks, not an LG emulator run.

## Actual emulator: app and helper together

An emulator normally has no real Developer Mode token. Use a fake file in `/tmp`
and an isolated server. Never overwrite `/var/luna/preferences/devmode_enabled`.

1. Make the local test server reachable from the emulator (for VirtualBox NAT,
   this is commonly `http://10.0.2.2:18473`; verify it). Use port forwarding if
   required. Keep the test service isolated from public networks.
2. Prepare a disposable copy with that server origin:

   ```sh
   node scripts/prepare-emulator-test.cjs http://10.0.2.2:18473
   ares-package --no-minify artifacts/emulator-test/app artifacts/emulator-test/service --outdir artifacts/emulator-test
   ```

3. Copy `artifacts/emulator-test/fake-token.txt` to the emulator as
   `/tmp/auto-token-refresh-test-token`, using the emulator's developer SSH
   connection. The fixture is 64 characters of repeating `ab` plus a newline.
   Do not substitute a real token.
4. Install the test IPK with `ares-install --device emulator <IPK>` and launch
   with `ares-launch --device emulator com.pirate.refresh`. Capture the console
   and service logs. The helper must run in its real Node/Luna environment.
5. Check initial token display and unregistered state. Add the fake token, verify
   the registered state, restart the app, verify it again, then remove it and
   verify unregistered state. Confirm status requests contain only `key_hash`;
   mutations contain `key` and `action`, never `[object Object]`.
6. Test pointer clicks, D-pad movement, Enter, Show Log, and Back. Remove the fake
   file, close/relaunch the app, and verify an actionable error with a usable log.
   Repeat with an empty file and an unavailable helper. Restore the fixture after
   each test. A token-read failure must not generate a token mutation.
7. Test server-offline, invalid JSON, failed registration lookup, and stalled
   requests. Controls must recover; unknown status must never be displayed as
   unregistered. Do not require native alerts on an emulator lacking SSAP.
8. Where SSAP is available, test approval, decline, timeout, retry, saved approval,
   native status/log navigation, and Dismiss returning TV control without changing
   renewal. A simulator fallback is not evidence that stock TV pairing is broken.

Do not publish the fixture IPK. Production packages must be built from `src/app`
and `src/service`, retain the real token path and HTTPS endpoint, and contain none
of the browser test bridge or fake-token data.

## Local evidence and outstanding work

Locally verified: 46 Node regression tests, ES5 parsing of shipped scripts,
helper read/hash/error checks on actual Node 0.12.2, and all three full-page test
scenarios on actual Chromium 53 with the isolated real Flask server.
The earlier released code reproduced `token is required` in the same browser.

Still needed: actual webOS 3.x/4.x emulator app/service integration, old-TV TLS and
network behavior, and a physically unrooted TV's native-alert route. Native alert
buttons, saved pairing, and Dismiss were verified on an LG C2 before this
compatibility refactor; the complete native regression remains in the unit suite.
Report findings and evidence; do not automatically close the issue reports.
