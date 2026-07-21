# Release build resources

`electron-builder` picks these up automatically (`directories.buildResources`).

## Icons (required before a public release)

Drop three files here — without them the installer ships the default Electron icon:

| File | Size | Used by |
|------|------|---------|
| `icon.icns` | 1024×1024 source | macOS |
| `icon.ico` | 256×256 (multi-size) | Windows |
| `icon.png` | 512×512 | Linux |

A single 1024×1024 PNG can generate all three:

```bash
npx electron-icon-builder --input=./source-icon.png --output=./build
```

## Code signing

Unsigned builds trigger **macOS Gatekeeper** and **Windows SmartScreen** warnings,
which is the single biggest blocker to distributing this outside your own machine.
`electron-builder` reads credentials from the environment — never commit them.

**macOS** (Apple Developer Program, ~$99/yr). `notarize: true` is already set:

```bash
export CSC_LINK=/path/to/certificate.p12       # Developer ID Application
export CSC_KEY_PASSWORD=…
export APPLE_ID=…
export APPLE_APP_SPECIFIC_PASSWORD=…
export APPLE_TEAM_ID=…
npm run build
```

**Windows** (OV/EV code-signing certificate). EV avoids SmartScreen reputation build-up:

```bash
export CSC_LINK=/path/to/certificate.pfx
export CSC_KEY_PASSWORD=…
npm run build
```

## Auto-update

`publish` is currently `null`, so no update feed is configured. To enable it,
install `electron-updater`, set `publish` (e.g. a GitHub release provider), and
call `autoUpdater.checkForUpdatesAndNotify()` after `app.whenReady()`. Updates
only work on **signed** builds.
