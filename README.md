# webOS Token Refresh App

Keep your webOS Developer Mode token renewed automatically through
[lg.pirate.vodka](https://lg.pirate.vodka).

## Using the app

Install or update the app through Homebrew Channel. The app and its token helper
are included in the same IPK and are installed together.

On first launch, approve **Auto Token Refresh** on your TV to enable native
dialogs. Approval is saved on the TV for later launches. This permission enables
the dialogs; automatic renewal is controlled separately by the buttons below.

The app checks your token's registration and shows the appropriate actions:

- **Renew Automatically** when the token is not registered.
- **Stop Auto Renewal** when the token is already being renewed automatically.
- **Check Again** when registration cannot be checked.

**Show Log** displays the app's recent activity. Native log dialogs include
**Back** and **Refresh Log**. **Dismiss** closes a native dialog and exits the app
without changing automatic renewal.

If native dialog permission is declined or the TV's remote service is unavailable,
the controls remain available in an app dialog. **Request TV Permission** retries
approval; **Retry Native Dialogs** reconnects using any saved approval. Pointer,
D-pad and Enter controls are supported, and Back closes an expanded app log.

After enabling automatic renewal, you can uninstall the app. Your token continues
to be renewed until you select **Stop Auto Renewal**.

## Compatibility and privacy

The compatibility target is webOS 3.x and later. Native dialogs depend on the
TV's paired remote interface. Registration checks send only the token's SHA-256
hash; enabling or stopping renewal sends the token to the renewal server. The
saved TV pairing key stays on the TV.

## Packaging

Package the app and helper together with the webOS CLI:

```sh
ares-package ./src/app ./src/service
```
