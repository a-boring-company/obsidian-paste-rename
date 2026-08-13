<paste_rename_project>
<repository_context>
- This is the `a-boring-company/obsidian-paste-rename` successor to `reorx/obsidian-paste-image-rename`.
- Use repository/package slug `obsidian-paste-rename`, plugin ID and vault folder `paste-rename`, and display name `Paste Rename`.
- Treat `manifest.json` as plugin identity, `package.json` as command and package metadata, and `versions.json` as release compatibility.
- Trace rename flow in `src/main.ts`, templates in `src/template.ts`, batch behaviour in `src/batch.ts`, and helpers in `src/utils.ts`.
</repository_context>

<scope_control>
- Preserve unrelated changes. Keep temporary files under `.tmp/` and remove them before handoff.
- Keep review fixes within the approved goal. Verify findings before editing.
- Compare the complete branch with `origin/main` before handoff.
</scope_control>

<node_environment>
- Use Node.js 18 or newer and `npm ci`.
- Do not commit `build/`, `node_modules/`, `data.json`, or `sync-plugin.sh`.
</node_environment>

<quality_gates>
- Run `npm exec -- eslint src --ext .ts`, `npm run build`, `bash -n sync-plugin.example.sh`, and `git diff --check`.
- Report unchanged lint findings as baseline. Do not fix unrelated source.
- There is no automated test suite. Test behaviour changes in Obsidian.
- Verify commands, settings, paths, screenshots, and links changed in documentation.
</quality_gates>

<release_safety>
- Keep `package.json`, `manifest.json`, and `versions.json` versions consistent when preparing a release.
- Do not version, release, merge, or force-push without explicit authorisation.
</release_safety>
</paste_rename_project>
