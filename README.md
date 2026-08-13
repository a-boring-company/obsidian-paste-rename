# Paste Rename

Paste Rename renames images and other attachments when they are added to an [Obsidian](https://obsidian.md/) vault. It is the maintained successor to [Paste image rename](https://github.com/reorx/obsidian-paste-image-rename).

The successor uses repository slug `obsidian-paste-rename`, plugin ID `paste-rename`, and display name **Paste Rename**. It is not yet listed in Obsidian's Community Plugins directory.

## Install

Until the Community Plugins listing is updated, build and install from source:

```bash
npm ci
npm run build
mkdir -p "/path/to/vault/.obsidian/plugins/paste-rename"
cp build/main.js build/manifest.json build/styles.css \
  "/path/to/vault/.obsidian/plugins/paste-rename/"
```

Reload Obsidian, then enable **Paste Rename** under **Settings > Community plugins**.

## Use

Paste an image into an open Markdown note. Enter a filename without the extension, then press Enter. Enable **Auto rename** to skip the prompt or **Handle all attachments** to include files that keep their original names.

The default pattern is `{{fileName}}`. Available variables are:

| Variable | Value |
| --- | --- |
| `{{fileName}}` | Active note name without `.md` |
| `{{dirName}}` | Active note's directory name |
| `{{firstHeading}}` | First level-one heading |
| `{{imageNameKey}}` | `imageNameKey` frontmatter value |
| `{{frontmatter:key}}` | Named frontmatter value |
| `{{DATE:FORMAT}}` | Current date using a [Moment.js format](https://momentjs.com/docs/#/displaying/format/) |

Name collisions receive the next configured numeric prefix or suffix.

## Batch commands

- **Batch rename embeded files (in the current file)** previews matches before confirmation.
- **Batch rename all images instantly (in the current file)** renames supported images without confirmation.

The instant command can stop after partially renaming a note if it encounters an unresolved or unsupported embed. Back up the vault or test on a disposable note first.

## Migrate from Paste image rename

The new plugin ID means Obsidian treats Paste Rename as a separate plugin.

1. Disable the predecessor.
2. Install Paste Rename in `.obsidian/plugins/paste-rename`.
3. Reconfigure the plugin, or close Obsidian and copy `data.json` from `.obsidian/plugins/obsidian-paste-image-rename/` into the new folder.
4. Confirm normal operation before removing the predecessor.

Back up `data.json` before copying it.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for commands, validation, and release rules.

## Licence

[MIT](LICENSE). The original copyright notice is retained.
