# WebOS-Token-Refresh-App

Automatically renew your webOS developer mode token via https://lg.pirate.vodka.

The app checks whether the token's SHA-256 hash is registered before opening a
webOS system alert. The subtitle and buttons reflect the result:

- Registered: “Your token is already being renewed automatically”, **Stop Auto
  Renewal**, and **Show Log**.
- Absent: “Your token is not yet being renewed automatically”, **Renew
  Automatically**, and **Show Log**.
- Lookup unavailable: **Check Again** and **Show Log**, without claiming either state.

The alert buttons relaunch the app with the selected action. If the notification
service is unavailable, denied, or does not respond, the same state and actions
are available in an app dialog. The dialog supports the pointer, D-pad, and Enter;
hidden buttons are skipped. Use Up/Down to scroll an expanded log and Back to
collapse it. Registration is checked again after adding or removing the token.

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
node tests/alert.test.js
```

Package the app and helper with the webOS CLI:

```sh
ares-package ./src/app ./src/service
```

LG's webOS TV 26 Simulator 1.5.0 supports the helper and app dialog but does not
provide `com.webos.notification`. The native alert payload and relaunch actions
have regression coverage; rendering the actual system alert requires a TV that
allows this service. For integration tests, use a temporary 64-character hex token
at the helper's path. If you add it to the server, remove it with `action=remove`
and verify that a subsequent removal reports that the token is absent.
