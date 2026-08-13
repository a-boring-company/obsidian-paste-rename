# Contributing

This repository maintains Paste Rename, the successor to [Paste image rename](https://github.com/reorx/obsidian-paste-image-rename).

## Repository map

- `src/main.ts`: lifecycle, rename flow, settings, and commands
- `src/template.ts`: filename templates
- `src/batch.ts`: batch rename flow
- `manifest.json`: plugin identity and compatibility
- `versions.json`: release compatibility map

## Develop

Use Node.js 18 or newer and the committed lockfile.

```bash
npm ci
npm start
```

`npm start` builds into `build/` and runs the optional ignored `sync-plugin.sh` hook. To sync a vault:

```bash
cp sync-plugin.example.sh sync-plugin.sh
OBSIDIAN_PLUGINS_DIR="/path/to/vault/.obsidian/plugins" npm start
```

The hook installs the build into `.obsidian/plugins/paste-rename`.

## Validate

```bash
npm exec -- eslint src --ext .ts
npm run build
bash -n sync-plugin.example.sh
git diff --check
```

There is no automated test suite. Test changed behaviour in a disposable vault. Report any lint finding that is unchanged from `origin/main` as baseline rather than expanding the change.

Before handoff, inspect the complete `origin/main...HEAD` diff and all committed, staged, unstaged, and untracked files.

## Release

Keep `package.json`, `manifest.json`, and `versions.json` versions aligned. `npm version <version>` updates release metadata. `npm run release` builds and creates a GitHub release.

Do not version, release, merge, or force-push without explicit authorisation.
