import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { App, Editor, MarkdownView, PluginManifest, TFile } from 'obsidian'

import PasteRenamePlugin, { DEFAULT_SETTINGS } from '../src/main'
import { cacheEmbedOccurrences } from '../src/batch-occurrences'
import { noticeMessages, TFile as MockTFile } from './mocks/obsidian'

function createFile(filePath: string): TFile {
	return new MockTFile(filePath) as unknown as TFile
}

function exactSnapshot(files: readonly TFile[]) {
	const content = files.map(file => `![[${file.path}]]`).join('\n')
	const embeds = cacheEmbedOccurrences(content, files.map((file, line) => {
		const original = `![[${file.path}]]`
		const offset = content.indexOf(original)
		return {
			link: file.path,
			original,
			position: {
				start: { line, col: 0, offset },
				end: { line, col: original.length, offset: offset + original.length },
			},
		}
	}))
	return { content, embeds, references: embeds }
}

function createHarness(paths: readonly string[]) {
	const sourceFile = createFile('notes/source.md')
	const files = paths.map(createFile)
	const filesByPath = new Map([sourceFile, ...files].map(file => [file.path, file]))
	const renameFile = vi.fn(async (file: TFile, newPath: string) => {
		filesByPath.delete(file.path)
		;(file as unknown as MockTFile).setPath(newPath)
		filesByPath.set(file.path, file)
	})
	const app = {
		fileManager: {
			generateMarkdownLink: (file: TFile) => `![[${file.path}]]`,
			renameFile,
		},
		metadataCache: {
			fileToLinktext: (file: TFile) => file.path,
			getFileCache: (): null => null,
			getFirstLinkpathDest: (link: string) => filesByPath.get(link) ?? null,
		},
		vault: {
			adapter: { list: vi.fn(async () => ({ files: [], folders: [] })) },
			getAbstractFileByPath: (filePath: string) => filesByPath.get(filePath) ?? null,
		},
		workspace: { getActiveViewOfType: (): null => null },
	} as unknown as App
	const manifest = {
		id: 'paste-rename',
		name: 'Paste Rename',
		version: '2.0.0',
		minAppVersion: '1.0.0',
		description: '',
		author: '',
		dir: '.obsidian/plugins/paste-rename',
	} as PluginManifest
	const plugin = new PasteRenamePlugin(app, manifest)
	plugin.settings = { ...DEFAULT_SETTINGS, disableRenameNotice: false }
	const editor = {} as Editor
	const view = { file: sourceFile, editor, data: '' } as MarkdownView
	const editorSession = { filePath: sourceFile.path, editor, view, baselineContent: '' }
	return { editorSession, files, plugin, renameFile, sourceFile }
}

function request(file: TFile, sourceFile: TFile) {
	return {
		file,
		sourceFile,
		sourcePath: sourceFile.path,
		cursor: { line: 0, ch: 0 },
		autoRename: true,
		generation: 0,
	}
}

beforeEach(() => { noticeMessages.length = 0 })
afterEach(() => { vi.restoreAllMocks() })

describe('PasteRenamePlugin burst notification boundaries', () => {
	it('passes silent outcomes through the exact process and emits only its final notice', async () => {
		const { editorSession, files, plugin, sourceFile } = createHarness(['assets/one.png', 'assets/two.png'])
		const snapshot = exactSnapshot(files)
		vi.spyOn(plugin, 'generateNewName').mockImplementation(file => ({
			stem: file.basename,
			newName: file === files[0] ? file.name : 'two-new.png',
			isMeaningful: true,
		}))
		vi.spyOn(plugin, 'prepareExactRenameBurst').mockResolvedValue({
			context: { sourceFile, editorSession },
			occurrencesByPath: new Map(files.map(file => [
				file.path,
				snapshot.references.filter(reference => reference.link === file.path),
			])),
		})
		vi.spyOn(plugin, 'prepareBatchSourceExact').mockResolvedValue({ snapshot, failure: null })
		vi.spyOn(plugin, 'prepareBatchSource').mockResolvedValue(snapshot)
		vi.spyOn(plugin, 'waitForBatchEditorContent').mockResolvedValue(null)
		const outcome = vi.spyOn(plugin, 'renameBatchAttachmentOutcome')

		await plugin.processRenameBurst(files.map(file => request(file, sourceFile)))

		expect(outcome.mock.calls.map(call => call[5])).toEqual([false, false])
		expect(noticeMessages).toEqual([
			'Renamed 1 attachment, but references could not be synchronized.',
		])
	})

	it('emits no successful rename notice when notify is false', async () => {
		const { files: [file], plugin, sourceFile } = createHarness(['assets/old.png'])
		vi.spyOn(plugin, 'deduplicateNewName').mockResolvedValue({ name: 'new.png', stem: 'new', extension: 'png' })
		vi.spyOn(plugin, 'nativeDiskReferenceState').mockResolvedValue('old')
		vi.spyOn(plugin, 'replaceAttachmentReference').mockResolvedValue({ matched: true, edit: null })

		const result = await plugin.renameFile(file, 'new.png', sourceFile.path, true, { line: 0, ch: 0 }, 0, false)

		expect(result.success).toBe(true)
		expect(noticeMessages).toEqual([])
	})

	it('keeps the bounded one-file process user-visible', async () => {
		const { files: [file], plugin, sourceFile } = createHarness(['assets/one.png'])
		vi.spyOn(plugin, 'generateNewName').mockReturnValue({ stem: 'one', newName: 'one.png', isMeaningful: true })
		vi.spyOn(plugin, 'nativeDiskReferenceState').mockResolvedValue('old')
		vi.spyOn(plugin, 'replaceAttachmentReference').mockResolvedValue({ matched: true, edit: null })
		const rename = vi.spyOn(plugin, 'renameFile')

		await plugin.processRenameBurst([request(file, sourceFile)])

		expect(rename.mock.calls[0][6]).toBe(true)
		expect(noticeMessages).toEqual(['Renamed one.png to one.png'])
	})

	it('keeps manual batch rename notices enabled through the structured outcome', async () => {
		const { editorSession, files: [file], plugin, sourceFile } = createHarness(['assets/manual.png'])
		vi.spyOn(plugin, 'prepareBatchSource').mockResolvedValue(exactSnapshot([file]))
		const outcome = vi.spyOn(plugin, 'renameBatchAttachmentOutcome')

		expect(await plugin.renameBatchAttachment(file, '', sourceFile, editorSession)).toBe(false)

		expect(outcome.mock.calls[0][5]).toBe(true)
		expect(noticeMessages).toEqual(['Failed to rename attachment: new name is empty'])
	})
})
