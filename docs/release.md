# Release process

## Local build

```bash
npm install
npm run build
```

Artifacts:

- `release/Claude Vault-<version>-arm64.dmg` (on Apple Silicon; x64 when built on Intel)
- Packaged app under `release/mac-*/`

## Prerequisites

- Apple Developer ID signing (optional for public distribution): configure `mac.identity` in electron-builder if you have certificates.

## Homebrew Cask (outline)

1. Publish a signed or unsigned DMG on **GitHub Releases** with a stable version tag (`v0.1.0`).
2. Fork [Homebrew/homebrew-cask](https://github.com/Homebrew/homebrew-cask) and add `Casks/claude-vault.rb` with `version`, `sha256`, and `url` pointing to the release asset.
3. Follow [Homebrew Cask contribution guide](https://docs.brew.sh/Adding-Software-to-Homebrew#casks).
4. Until cask is merged, users can install via DMG download from Releases.

## Versioning

Use semantic versioning. Tag releases in git to match `package.json` `version`.
