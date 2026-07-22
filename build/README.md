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

## GitHub Actions secrets

`.github/workflows/release.yml` builds and publishes on every `v*` tag. Add these
under **Settings → Secrets and variables → Actions**. Without them the workflow
still runs but produces **unsigned** artifacts (dry run only).

| Secret | Platform | Value |
|---|---|---|
| `MAC_CSC_LINK` | macOS | base64 of the Developer ID `.p12` |
| `MAC_CSC_KEY_PASSWORD` | macOS | its password |
| `APPLE_ID` | macOS | Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | macOS | app-specific password (appleid.apple.com) |
| `APPLE_TEAM_ID` | macOS | 10-char team ID |
| `WIN_CSC_LINK` | Windows | base64 of the `.pfx` |
| `WIN_CSC_KEY_PASSWORD` | Windows | its password |

`GITHUB_TOKEN` is provided automatically and is what publishes the release.

To base64 a certificate:

```bash
base64 -i certificate.p12 | pbcopy      # macOS
certutil -encode certificate.pfx out.txt # Windows
```

## Auto-update

Wired and ready: `electron/updater.ts` + the `publish` block in `package.json`
(GitHub provider). Behaviour is deliberately conservative — updates download in
the background, but **installing always waits for the user** (this app gets
opened to look something up; a surprise restart would lose their place). The
header shows a "업데이트 설치" button once a build is ready.

Requirements for it to actually work:

1. **A signed build.** electron-updater refuses unsigned updates on macOS, and
   Windows shows SmartScreen warnings. Signing is not optional here.
2. **A published GitHub Release** containing the installers *and* the generated
   `latest.yml` / `latest-mac.yml` — the workflow uploads both.
3. **A version bump** in `package.json` before tagging; the updater compares
   against the running version.

Release flow:

```bash
npm version patch          # or minor/major — writes package.json + tag
git push --follow-tags     # triggers .github/workflows/release.yml
```

In dev or any unpackaged run the updater is skipped entirely (`state:
'unsupported'`), so no errors are logged during local development. Set
`VAULT_DISABLE_UPDATER=1` to force-disable it in a packaged build.
