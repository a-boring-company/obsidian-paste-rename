import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { App, Editor, MarkdownView, PluginManifest, TFile } from 'obsidian'

import PasteRenamePlugin, { DEFAULT_SETTINGS } from '../src/main'
import { cacheEmbedOccurrences } from '../src/batch-occurrences'
import { renderFigure } from '../src/figure'
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

interface LiveHarnessOptions {
	sourcePath: string
	filePath: string
	generatedLink: string
	content?: string
	imageOutput?: 'html' | 'markdown'
	metadataResolve?: (link: string, filesByPath: Map<string, TFile>) => TFile | null
}

function createLiveHarness(options: LiveHarnessOptions) {
	const sourceFile = createFile(options.sourcePath)
	const file = createFile(options.filePath)
	const content = options.content ?? options.generatedLink
	let editorContent = content
	let diskContent = content
	const editor = {
		getValue: () => editorContent,
		getCursor: () => ({ line: 0, ch: 0 }),
		lineCount: () => editorContent.split(/\r?\n/).length,
		getLine: (line: number) => editorContent.split(/\r?\n/)[line] ?? '',
		transaction: ({ changes }: { changes: Array<{ from: { line: number; ch: number }; to: { line: number; ch: number }; text: string }> }) => {
			const change = changes[0]
			const lines = editorContent.split('\n')
			const offset = (position: { line: number; ch: number }) => lines.slice(0, position.line).reduce((total, line) => total + line.length + 1, 0) + position.ch
			const start = offset(change.from)
			const end = offset(change.to)
			editorContent = `${editorContent.slice(0, start)}${change.text}${editorContent.slice(end)}`
		},
	} as unknown as Editor
	const view = { file: sourceFile, editor, data: content } as MarkdownView
	const filesByPath = new Map([[sourceFile.path, sourceFile], [file.path, file]])
	const resolveMetadata = options.metadataResolve ?? ((link: string, availableFiles: Map<string, TFile>) => availableFiles.get(link) ?? null)
	const app = {
		fileManager: {
			generateMarkdownLink: () => options.generatedLink,
			renameFile: vi.fn(async (target: TFile, newPath: string) => {
				filesByPath.delete(target.path)
				;(target as unknown as MockTFile).setPath(newPath)
				filesByPath.set(target.path, target)
			}),
		},
		metadataCache: {
			getFirstLinkpathDest: (link: string) => resolveMetadata(link, filesByPath),
			fileToLinktext: (target: TFile) => target.path,
			getFileCache: (): null => null,
		},
		vault: {
			adapter: { list: vi.fn(async () => ({ files: [], folders: [] })) },
			getAbstractFileByPath: (path: string) => filesByPath.get(path) ?? null,
			read: vi.fn(async () => diskContent),
			process: vi.fn(async (_target: TFile, transform: (value: string) => string) => {
				diskContent = transform(diskContent)
				return diskContent
			}),
		},
		workspace: { getActiveViewOfType: () => view },
	} as unknown as App
	const manifest = {
		id: 'paste-rename', name: 'Paste Rename', version: '2.0.0', minAppVersion: '1.0.0',
		description: '', author: '', dir: '.obsidian/plugins/paste-rename',
	} as PluginManifest
	const plugin = new PasteRenamePlugin(app, manifest)
	plugin.settings = { ...DEFAULT_SETTINGS, disableRenameNotice: true, imageOutput: options.imageOutput ?? 'html' }
	const editorSession = { filePath: sourceFile.path, editor, view, baselineContent: content }
	return { app, diskContent: () => diskContent, editor, editorSession, file, plugin, sourceFile }
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

	it('uses the canonical file path for ordinary nested-note figure conversion', async () => {
		const { editor, file, plugin, sourceFile } = createLiveHarness({
			sourcePath: 'notes/deep/source.md', filePath: 'assets/image.png', generatedLink: '![[assets/image.png]]',
		})

		const result = await plugin.replaceAttachmentReference(file, sourceFile.path, file.path, { line: 0, ch: 0 }, 0)

		expect(result.matched).toBe(true)
		expect(editor.getValue()).toContain('<img src="assets/image.png"')
		expect(editor.getValue()).not.toContain('<img src="../assets/image.png"')
	})

	it('uses canonical old and new paths for manual batch figure rename', async () => {
		const oldFigure = renderFigure({ src: 'assets/old.png', stem: 'old' })
		const { editor, editorSession, file, plugin, sourceFile } = createLiveHarness({
			sourcePath: 'notes/deep/source.md', filePath: 'assets/old.png', generatedLink: '![[assets/old.png]]', content: oldFigure,
		})
		vi.spyOn(plugin, 'prepareBatchSource').mockResolvedValue({ content: oldFigure, embeds: [], references: [] })
		vi.spyOn(plugin, 'waitForBatchEditorContent').mockResolvedValue({ ready: true })
		vi.spyOn(plugin, 'renameFile').mockImplementation(async (target, _name) => {
			(target as unknown as MockTFile).setPath('assets/new.png')
			return { success: true, edit: null }
		})

		const result = await plugin.renameBatchAttachmentOutcome(file, 'new.png', sourceFile, editorSession, 0, false)

		expect(result).toBe('success')
		expect(editor.getValue()).toContain('<img src="assets/new.png"')
		expect(editor.getValue()).not.toContain('<img src="../assets/new.png"')
	})

	it.each([
		['vault root PNG', 'note.md', 'image.png'],
		['fixed root folder PNG', 'notes/topic.md', 'assets/image.png'],
		['current-note folder SVG', 'notes/topic.md', 'notes/image.svg'],
		['current-note subfolder GIF', 'notes/topic.md', 'notes/current/image.gif'],
		['literal percent JPEG', 'notes/topic.md', 'assets/raw%20folder/photo%.jpeg'],
		['space PNG', 'notes/topic.md', 'assets/photo space.png'],
		['Unicode PNG', 'notes/topic.md', 'assets/Đọc image.png'],
	] as const)('renders the canonical raw TFile.path exactly once for %s', async (_label, sourcePath, filePath) => {
		const { editor, file, plugin, sourceFile } = createLiveHarness({
			sourcePath,
			filePath,
			generatedLink: `![[${filePath}]]`,
		})

		const result = await plugin.replaceAttachmentReference(file, sourceFile.path, file.path, { line: 0, ch: 0 }, 0)
		const encodedPath = filePath.split('/').map(segment => encodeURIComponent(segment)).join('/')

		expect(result.matched).toBe(true)
		expect(editor.getValue()).toContain(`<img src="${encodedPath}"`)
	})

	it.each([
		['shortest Wikilink', 'notes/topic.md', '![[image.png]]'],
		['relative Markdown', 'notes/deep/topic.md', '![image](../../assets/image.png)'],
		['absolute Wikilink', 'notes/topic.md', '![[/assets/image.png]]'],
	] as const)('keeps generated %s destinations in container references', async (_label, sourcePath, generatedLink) => {
		const content = `- ${generatedLink}`
		const { editor, file, plugin, sourceFile } = createLiveHarness({
			sourcePath,
			filePath: 'assets/image.png',
			generatedLink,
			content,
		})

		const result = await plugin.replaceAttachmentReference(file, sourceFile.path, file.path, { line: 0, ch: content.indexOf('[') }, 0)

		expect(result.matched).toBe(true)
		expect(editor.getValue()).toBe(content)
	})

	it('resolves generated figures through exact vault paths when metadata best match is a decoy', async () => {
		const decoy = createFile('notes/deep/assets/image.png')
		const content = renderFigure({ src: 'assets/image.png', stem: 'image' })
		const { editorSession, file, plugin, sourceFile } = createLiveHarness({
			sourcePath: 'notes/deep/source.md',
			filePath: 'assets/image.png',
			generatedLink: '![[assets/image.png]]',
			content,
			metadataResolve: () => decoy,
		})
		vi.spyOn(plugin, 'prepareBatchSource').mockResolvedValue({ content, embeds: [], references: [] })
		const groups = await plugin.scanBatchAttachments(sourceFile, editorSession, 0)
		expect(groups?.map(group => group.file.path)).toEqual(['assets/image.png'])
		vi.spyOn(plugin, 'renameFile').mockResolvedValue({ success: true, edit: null })

		const outcome = await plugin.renameBatchAttachmentOutcome(file, 'image.png', sourceFile, editorSession, 0, false)

		expect(outcome).toBe('success')
		expect(plugin.renameFile).toHaveBeenCalledOnce()
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
