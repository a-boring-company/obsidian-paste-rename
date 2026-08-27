# Contributing

This repository maintains Paste Rename, the successor to [Paste image rename](https://github.com/reorx/obsidian-paste-image-rename).

Version 2.0.1 targets Obsidian 1.1.1 or newer; batch synchronization relies on its atomic `Vault.process` and metadata-cache changed-event APIs.

## Repository map

- `src/main.ts`: lifecycle, rename flow, settings, and commands
- `src/template.ts`: filename templates
- `src/batch.ts`: batch rename flow
- `manifest.json`: plugin identity and compatibility
- `versions.json`: release compatibility map

## Develop

Use Node.js 24 (`.nvmrc`) and the committed lockfile.

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

The build installs immutable `attachment-types.default.json`; the plugin creates or updates user-editable `attachment-types.json` in the installed plugin folder. Attachment files are renamed in place; no custom attachment directory is introduced.

## Validate

```bash
npm run check
bash -n sync-plugin.example.sh
npm ls --depth=0
git diff --check
```

`npm run check` runs zero-warning linting for `src` and `tests`, TypeScript checking, Vitest, V8 coverage with 100% statements/branches/functions/lines for the extracted core, and the production build. Test changed behaviour in a disposable vault as well: verify image figures, Markdown mode, attachment allowlists, ignored extensions, in-place directories, popup batch choices, rename failures, and delayed embed insertion. A passing local check does not replace Obsidian UAT.

Before handoff, inspect the complete `origin/main...HEAD` diff and all committed, staged, unstaged, and untracked files.

## Release

Keep `package.json`, `manifest.json`, and `versions.json` versions aligned. `npm version <version>` updates release metadata. `npm run release` builds and creates a GitHub release.

Do not version, release, merge, or force-push without explicit authorisation.
