# WebOS-Token-Refresh-App

Automatically renew your webOS developer mode token via https://lg.pirate.vodka.

The app checks whether the token's SHA-256 hash is registered before opening a
webOS system alert. The subtitle and buttons reflect the result:

- Registered: “Your token is already being renewed automatically”, **Stop Auto
  Renewal**, and **Show Log**.
- Absent: “Your token is not yet being renewed automatically”, **Renew
  Automatically**, and **Show Log**.
- Lookup unavailable: **Check Again** and **Show Log**, without claiming either state.

Native alerts work through a paired connection to the TV's own remote-control
service (`ws://127.0.0.1:3000`), without root or an external device. On first use,
approve **Auto Token Refresh** on the TV. The app requests only
`WRITE_NOTIFICATION_TOAST`, which also permits native alerts on the tested TV.
It saves the pairing key in its local storage and reuses it on later launches.
If the TV rejects a revoked key, the app asks to pair again. Clearing app data or
losing the saved key also requires another approval. The pairing key stays on the
TV and is never sent to the token-renewal server or written to the app log.

The alert buttons relaunch the app with the selected action. If pairing is
declined, times out, or the TV remote service is unavailable, the same state and
actions remain available in an app dialog. Failed, declined, or timed-out pairing
shows **Request TV Permission**, with an explanation of the TV approval prompt,
notification permission, saved approval, and how pairing differs from enabling
token renewal. Connection or alert-request failures offer **Retry Native Dialogs**
without discarding the saved permission.
While native alerts work, the fallback card is hidden. **Show Log** opens another
native alert with the eight most recent log entries, **Back**, and **Refresh Log**.
Long entries are shortened to fit the TV dialog; the fallback log retains them.
The dialog supports the pointer, D-pad, and Enter;
hidden buttons are skipped. Use Up/Down to scroll an expanded log and Back to
collapse it. Registration is checked again after adding or removing the token.

Direct `com.webos.notification/createAlert` calls from ordinary apps are denied
on the tested TV; LG reserves direct notification APIs for system apps. This app
uses `ssap://system.notifications/createAlert` and `closeAlert` after pairing.
See [LG's notification guidance](https://webostv.developer.lge.com/develop/guides/notifications).

The helper still reads `/var/luna/preferences/devmode_enabled` and now returns its
trimmed content and SHA-256 hash. Renewal and removal still POST the token as `key`
with `action=add` or `action=remove` to the same server. The read-only lookup POSTs
only `key_hash` to `/api/key-status`, expecting `{"registered": true}` or
`{"registered": false}`. Install the app and helper together.

**Server prerequisite:** deploy the companion `/api/key-status` change from
`LucifersCircle/webOS-Token-Refresh` before testing this version against the live
server. An older server without this endpoint will show the retry state. The new
endpoint checks the existing hash column without inserting, refreshing, removing,
or decrypting a token. After enabling automatic renewal, you can uninstall the app.

Run the regression checks with Node.js 18 or later:

```sh
node --test tests/*.test.js
```

Package the app and helper with the webOS CLI:

```sh
ares-package ./src/app ./src/service
```

The paired route has been verified from the ordinary app context on an LG C2
running webOS SDK 10.3.1: pairing, native rendering, alert closing, the Show Log
button, and reconnecting with the saved key. That test TV is rooted, but the alert
path uses no root helper, elevated permissions, or system modifications. A
physically unrooted TV and other firmware versions still need compatibility
testing. The app dialog remains available when the remote interface is absent,
including simulators without that service.

For integration tests, use a temporary 64-character hex token. Keep any rooted-TV
test override of the helper's file path outside the shipped source and IPK. If you
add the test token to the server, remove it afterwards and verify that the status
endpoint reports it as absent.
