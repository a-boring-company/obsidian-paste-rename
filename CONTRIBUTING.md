# Contributing

This guide covers development in this maintenance fork.
User-facing setup and plugin behaviour belong in [README.md](README.md).

## Repository map

| Path | Responsibility |
| --- | --- |
| `src/main.ts` | Plugin lifecycle, attachment detection, rename flow, settings, and Obsidian commands. |
| `src/template.ts` | Filename template expansion. |
| `src/batch.ts` | Batch rename preview, confirmation, and execution. |
| `src/utils.ts` | Filename sanitising, path handling, input composition, and small DOM helpers. |
| `src/styles.css` | Rename and batch modal styles. |
| `manifest.json` | Obsidian plugin identity, compatibility, and current version. |
| `versions.json` | Mapping from plugin releases to their minimum Obsidian versions. |
| `esbuild.config.mjs` | Development watcher and production bundle configuration. |
| `version-bump.mjs` | Synchronises `manifest.json` and `versions.json` with the package version. |
| `sync-plugin.example.sh` | Optional local-vault sync hook used by the development watcher. |

## Prerequisites

Use Node.js 18 or newer and npm.
The lockfile is authoritative for dependency versions.

Install dependencies from the repository root.

```bash
npm ci
```

## Development commands

| Command | Purpose |
| --- | --- |
| `npm start` | Watches `src/main.ts` and `src/styles.css`, then rebuilds the development bundle under `build/`. |
| `npm exec -- eslint src --ext .ts` | Runs the configured ESLint rules against TypeScript source. |
| `npm run build` | Type-checks the project, creates a production bundle, and copies `manifest.json` into `build/`. |
| `bash -n sync-plugin.example.sh` | Checks the optional sync helper's shell syntax. |

The `build/` directory and development `sync-plugin.sh` are generated or machine-specific files and are ignored by Git.
Do not commit them.

This repository does not currently define an automated test suite.
Do not describe a source change as tested solely because the build passes.
Run the relevant manual Obsidian checks as well.
If full-tree lint reports a finding that is unchanged from `origin/main`, verify and report that baseline separately instead of expanding the pull request without approval.

## Develop in an Obsidian vault

Create a production build, then copy its three plugin files into a vault-specific plugin directory.

```bash
npm run build
mkdir -p "/absolute/path/to/vault/.obsidian/plugins/obsidian-paste-image-rename"
cp build/main.js build/manifest.json build/styles.css \
  "/absolute/path/to/vault/.obsidian/plugins/obsidian-paste-image-rename/"
```

Reload Obsidian, then enable **Paste image rename** under **Settings > Community plugins**.

For watch mode, copy the ignored sync hook and provide the vault's plugin directory through the environment.

```bash
cp sync-plugin.example.sh sync-plugin.sh
OBSIDIAN_PLUGINS_DIR="/absolute/path/to/vault/.obsidian/plugins" npm start
```

The hook copies `build/main.js`, `build/styles.css`, and `manifest.json` after each successful rebuild.
It also touches `.hotreload` for development setups that use Obsidian's Hot Reload plugin.

## Validation

Run checks from the repository root.

```bash
npm exec -- eslint src --ext .ts
npm run build
bash -n sync-plugin.example.sh
git diff --check
```

Use a disposable vault or note for manual validation.
Match the checks to the changed behaviour.

- Paste an image and confirm that the prompt, rename, and link update work.
- Exercise every changed template variable with missing and populated values.
- Confirm collision numbering beside existing attachments.
- Test **Handle all attachments** with both matching and excluded extensions.
- Preview and confirm batch renames before testing the instant batch command.

Documentation-only changes still require `git diff --check` and a check that every command, setting name, link, and file path matches the repository.

## Pull requests

Keep each pull request within one approved goal.
Treat review comments as hypotheses and verify them against the current source before editing.
Fix every valid in-scope finding, but do not add adjacent features or refactors without explicit approval.

Before handoff, compare the complete branch with `origin/main` and inspect committed, staged, unstaged, and untracked files separately.
Report build, lint, manual-test, and remote continuous-integration evidence without treating one as a substitute for another.

## Releases

Release operations are maintainer-only external writes.
Do not run them during ordinary validation.

The package version, `manifest.json`, and `versions.json` must agree for a release.
The `npm version <new-version>` lifecycle runs `version-bump.mjs`, updates the Obsidian metadata, and creates npm's version commit and tag.
After checking the generated diff and production build, `npm run release` creates a GitHub release from the files under `build/`.
