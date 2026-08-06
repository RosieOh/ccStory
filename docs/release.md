# Release process

Claude Vault ships as signed installers attached to a **GitHub Release**, which
also doubles as the [`electron-updater`](../electron/updater.ts) feed. There are
two ways to produce a release: the automated CI pipeline (recommended) and a
manual local build.

## Automated release (recommended)

Pushing a `v*` tag triggers [`.github/workflows/release.yml`](../.github/workflows/release.yml),
which builds on `macos-latest`, `windows-latest`, and `ubuntu-latest` in parallel
and publishes every artifact to a single GitHub Release.

```bash
npm version patch          # bump package.json + create the vX.Y.Z commit and tag
git push --follow-tags     # push the commit and the tag
```

What the workflow does per OS:

1. `npm ci` (native deps rebuild for Electron's ABI via `install-app-deps`).
2. `npm run typecheck && npm run lint && npm test` — a broken tag never ships.
3. `electron-builder --<platform> --publish always` — uploads installers and the
   `latest*.yml` update metadata to the Release.

The Release is created as a **draft**; review it and hit publish. `latest-mac.yml`
/ `latest.yml` must be attached (they are, by the step above) or auto-update
won't see the new version.

You can also run it on demand from the Actions tab (`workflow_dispatch`).

## Manual local build

```bash
npm install
npm run build              # local artifacts only, no upload
```

To build **and** publish to GitHub Releases from your machine:

```bash
export GH_TOKEN=<token with repo scope>
npm run release            # electron-builder --publish always
```

Note: a local build only produces installers for the OS you run it on — macOS
notarization in particular requires building on a Mac. Use the CI pipeline for a
full three-platform release.

Artifacts (in `release/`), named `${productName}-${version}-${os}-${arch}.${ext}`:

- macOS — `.dmg` + `.zip` (zip is what electron-updater consumes)
- Windows — NSIS `.exe`
- Linux — `.AppImage` + `.deb`

## Signing & notarization

Unsigned builds still work but trigger **Gatekeeper** (macOS) and **SmartScreen**
(Windows) warnings, and **auto-update only runs on signed macOS builds**. The
workflow reads credentials from repository secrets; when they are absent the
build succeeds unsigned and notarization is skipped automatically.

| Secret | Platform | Purpose |
|--------|----------|---------|
| `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD` | macOS | Developer ID Application cert (base64 `.p12`) |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | macOS | Notarization (`notarize: true` is already set) |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | Windows | Code-signing cert (optional) |

See [`build/README.md`](../build/README.md) for how to obtain and export each
one, plus the app icons electron-builder expects.

## Auto-update

`electron-updater` checks the GitHub Release feed on a packaged, signed build.
Downloads happen in the background but **installing is always the user's choice**
(see [`electron/updater.ts`](../electron/updater.ts)) — a surprise restart
mid-search would lose the user's place. In dev or unsigned builds the updater is
skipped entirely.

## Homebrew Cask (outline)

1. Publish a signed DMG on **GitHub Releases** with a stable tag (`v0.1.0`).
2. Fork [Homebrew/homebrew-cask](https://github.com/Homebrew/homebrew-cask) and add
   `Casks/claude-vault.rb` with `version`, `sha256`, and `url` pointing to the asset.
3. Follow the [Homebrew Cask contribution guide](https://docs.brew.sh/Adding-Software-to-Homebrew#casks).
4. Until the cask is merged, users install via the DMG download from Releases.

## Versioning

Semantic versioning. The git tag must match `package.json` `version` — `npm version`
keeps them in sync automatically.
