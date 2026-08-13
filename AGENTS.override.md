<obsidian_paste_image_rename_project>
<repository_context>
- Begin with `README.md` for plugin behaviour and `CONTRIBUTING.md` for the repository map, commands, local-vault workflow, and release boundaries.
- Treat `manifest.json` as the source of plugin identity and Obsidian compatibility, `package.json` as the source of npm commands and package version, and `versions.json` as the release-to-minimum-app-version map.
- Trace attachment handling and settings through `src/main.ts`, template expansion through `src/template.ts`, batch behaviour through `src/batch.ts`, and shared helpers through `src/utils.ts` before changing related documentation or behaviour.
- This checkout is a maintenance fork of `reorx/obsidian-paste-image-rename`. Verify the target repository before any release, issue, or pull-request write.
</repository_context>

<scope_control>
- Establish the approved base commit and inspect `git status --short --untracked-files=all` before editing.
- Preserve unrelated user changes and keep temporary artefacts under `.tmp/` only. Remove agent-owned temporary artefacts before handoff.
- Keep review-driven work within the approved goal. Classify every finding as valid, invalid, stale, duplicate, out of scope, or unresolved before acting.
- Fix every valid in-scope finding regardless of severity. Do not implement adjacent features, refactors, or material scope growth without explicit approval.
- After each review round, compare the complete `<approved-base>...HEAD` diff and quantify unexpected file or line growth. Use `origin/main...HEAD` separately for final merge-target assessment.
</scope_control>

<node_environment>
- Use Node.js 18 or newer with npm and the committed `package-lock.json`.
- Install exact dependencies with `npm ci`.
- Use repository scripts and configuration as authority. Do not introduce another package manager, formatter, test framework, or build path without an approved need.
- `build/`, `node_modules/`, `data.json`, and `sync-plugin.sh` are ignored local or generated artefacts. Do not commit them.
</node_environment>

<quality_gates>
- Source changes require `npm exec -- eslint src --ext .ts` followed by `npm run build`. Do not claim lint passes while a finding remains.
- If full-tree lint reports an unchanged `origin/main` finding, verify and report it separately. Do not repair unrelated baseline source without scope approval.
- The repository has no automated test suite. Add focused tests first when introducing testable behaviour, and report manual Obsidian validation separately from lint and build results.
- Shell changes require `bash -n <changed-script>` and a focused behavioural check when the script contract changes.
- Documentation changes require `git diff --check` and verification that commands, setting names, paths, screenshots, and links match the current repository.
- Before merge-readiness claims, fetch `origin`, inspect `origin/main...HEAD`, and check committed, staged, unstaged, and untracked state separately.
</quality_gates>

<release_safety>
- Keep `package.json`, `manifest.json`, and `versions.json` versions consistent when preparing a release.
- Do not run `npm version`, `npm run version`, `npm run release`, create a GitHub release, merge, or force-push without explicit authorisation for that external or history-changing action.
</release_safety>
</obsidian_paste_image_rename_project>
