import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { App, Editor, MarkdownView, PluginManifest, TFile } from 'obsidian'

import PasteRenamePlugin, { DEFAULT_SETTINGS } from '../src/main'
import { cacheEmbedOccurrences } from '../src/batch-occurrences'
import { isImageExtension } from '../src/attachment-types'
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

interface BurstProductionHarnessOptions {
	sourcePath?: string
	filePaths: readonly string[]
	content: string
	diskContent?: string
	baselineContent?: string
	imageOutput?: 'html' | 'markdown'
	linkForPath?: (path: string) => string
	recordMetadataOnProcess?: boolean
	metadataSeedContent?: string
}

function cachedMetadataFor(value: string) {
	const embeds: Array<{
		link: string
		original: string
		position: {
			start: { line: number; col: number; offset: number }
			end: { line: number; col: number; offset: number }
		}
	}> = []
	const pattern = /!\[\[([^\]\n]+)\]\]/g
	let match: RegExpExecArray | null
	while ((match = pattern.exec(value)) !== null) {
		const original = match[0]
		const link = match[1].split('|', 1)[0]
		const line = value.slice(0, match.index).split('\n').length - 1
		const lineStart = value.lastIndexOf('\n', match.index - 1) + 1
		embeds.push({
			link,
			original,
			position: {
				start: { line, col: match.index - lineStart, offset: match.index },
				end: { line, col: match.index - lineStart + original.length, offset: match.index + original.length },
			},
		})
	}
	return {
		cache: { embeds },
		snapshot: {
			content: value,
			embeds: cacheEmbedOccurrences(value, embeds),
			references: cacheEmbedOccurrences(value, embeds),
		},
	}
}

function createBurstProductionHarness(options: BurstProductionHarnessOptions) {
	const sourcePath = options.sourcePath ?? 'notes/source.md'
	const sourceFile = createFile(sourcePath)
	const files = options.filePaths.map(createFile)
	const filesByPath = new Map([sourceFile, ...files].map(file => [file.path, file]))
	const linkForPath = options.linkForPath ?? ((path: string) => path)
	const editorInitialContent = options.content
	let editorContent = editorInitialContent
	let diskContent = options.diskContent ?? editorInitialContent
	let plugin: PasteRenamePlugin | null = null
	const recordMetadataOnProcess = options.recordMetadataOnProcess ?? true
	const metadataResolve = (link: string): TFile | null => {
		for (const file of files) if (linkForPath(file.path) === link) return file
		return filesByPath.get(link) ?? null
	}
	const recordMetadata = (value: string) => {
		if (!plugin) return
		plugin.metadataLedger.record(sourcePath, value, cachedMetadataFor(value).cache as never)
	}
	const editor = {
		getValue: () => editorContent,
		getCursor: () => ({ line: 0, ch: 0 }),
		lineCount: () => editorContent.split(/\r?\n/).length,
		getLine: (line: number) => editorContent.split(/\r?\n/)[line] ?? '',
		transaction: ({ changes }: { changes: Array<{ from: { line: number; ch: number }; to: { line: number; ch: number }; text: string }> }) => {
			const change = changes[0]
			const lines = editorContent.split(/\r?\n/)
			const offset = (position: { line: number; ch: number }) => lines.slice(0, position.line).reduce((total, line) => total + line.length + 1, 0) + position.ch
			const start = offset(change.from)
			const end = offset(change.to)
			editorContent = `${editorContent.slice(0, start)}${change.text}${editorContent.slice(end)}`
		},
	} as unknown as Editor
	const baselineContent = options.baselineContent ?? editorInitialContent
	const view = { file: sourceFile, editor, data: baselineContent } as MarkdownView
	const renameFile = vi.fn(async (target: TFile, newPath: string) => {
		filesByPath.delete(target.path)
		;(target as unknown as MockTFile).setPath(newPath)
		filesByPath.set(target.path, target)
	})
	const app = {
		fileManager: {
			generateMarkdownLink: (file: TFile) => `![[${linkForPath(file.path)}]]`,
			renameFile,
		},
		metadataCache: {
			fileToLinktext: (file: TFile) => linkForPath(file.path),
			getFileCache: (): null => null,
			getFirstLinkpathDest: (link: string) => metadataResolve(link),
		},
		vault: {
			adapter: { list: vi.fn(async () => ({ files: [], folders: [] })) },
			getAbstractFileByPath: (filePath: string) => filesByPath.get(filePath) ?? null,
			read: vi.fn(async () => diskContent),
			process: vi.fn(async (_target: TFile, transform: (value: string) => string) => {
				diskContent = transform(diskContent)
				if (recordMetadataOnProcess) recordMetadata(diskContent)
				return diskContent
			}),
		},
		workspace: { getActiveViewOfType: () => view },
	} as unknown as App
	const manifest = {
		id: 'paste-rename', name: 'Paste Rename', version: '2.0.0', minAppVersion: '1.0.0',
		description: '', author: '', dir: '.obsidian/plugins/paste-rename',
	} as PluginManifest
	plugin = new PasteRenamePlugin(app, manifest)
	plugin.settings = { ...DEFAULT_SETTINGS, disableRenameNotice: true, imageOutput: options.imageOutput ?? 'html' }
	const editorSession = { filePath: sourceFile.path, editor, view, baselineContent }
	const seedContent = options.metadataSeedContent ?? editorInitialContent
	recordMetadata(seedContent)
	return {
		app,
		cacheForContent: (value: string) => cachedMetadataFor(value),
		diskContent: () => diskContent,
		editor,
		editorSession,
		files,
		plugin,
		renameFile,
		sourceFile,
	}
}

function detachBatchEditorAfterThirdRead(app: App): void {
	const view = (app.workspace.getActiveViewOfType as () => MarkdownView)()
	const vault = app.vault as unknown as { read: (target: TFile) => Promise<string> }
	const originalRead = vault.read.bind(vault)
	let reads = 0
	vi.spyOn(vault, 'read').mockImplementation(async target => {
		const value = await originalRead(target)
		reads += 1
		if (reads === 3) view.file = createFile('notes/other.md') as unknown as TFile
		return value
	})
}

beforeEach(() => { noticeMessages.length = 0 })
afterEach(() => { vi.restoreAllMocks() })

describe('PasteRenamePlugin burst notification boundaries', () => {
	it('rejects an exact burst when the active editor changes during source capture', async () => {
		const paths = ['assets/first.png', 'assets/second.png']
		const content = paths.map(path => `![[${path}]]`).join('\n')
		const { app, diskContent, editor, files, plugin, sourceFile } = createBurstProductionHarness({
			filePaths: paths,
			content,
			baselineContent: content,
		})
		vi.spyOn(plugin, 'generateNewName').mockImplementation(file => ({ stem: file.basename, newName: file.name, isMeaningful: false }))
		const originalRead = (app.vault as unknown as { read: (file: TFile) => Promise<string> }).read
		let changed = false
		vi.spyOn(app.vault as unknown as { read: (file: TFile) => Promise<string> }, 'read').mockImplementation(async file => {
			const value = await originalRead(file)
			if (!changed) {
				changed = true
				editor.transaction({ changes: [{ from: { line: 1, ch: content.split('\n')[1].length }, to: { line: 1, ch: content.split('\n')[1].length }, text: ' user edit' }] })
			}
			return value
		})
		vi.spyOn(plugin, 'openRenameModal').mockResolvedValue({ action: 'cancel', applyToRemaining: true })

		await plugin.processRenameBurst(files.map(file => ({ ...request(file, sourceFile), autoRename: false })))

		expect(editor.getValue()).toContain('user edit')
		expect(diskContent()).toBe(content)
		expect(plugin.openRenameModal).not.toHaveBeenCalled()
		expect(noticeMessages).toEqual(['Skipped 2 attachments because the active note could not be synchronized'])
	})

	it('rolls back an exact burst when the active editor changes during cache polling', async () => {
		const paths = ['assets/first.png', 'assets/second.png']
		const content = paths.map(path => `![[${path}]]`).join('\n')
		const originalDisk = 'note text before the burst'
		const { diskContent, editor, files, plugin, sourceFile } = createBurstProductionHarness({
			filePaths: paths,
			content,
			diskContent: originalDisk,
			baselineContent: originalDisk,
			metadataSeedContent: originalDisk,
		})
		vi.spyOn(plugin, 'generateNewName').mockImplementation(file => ({ stem: file.basename, newName: file.name, isMeaningful: false }))
		const exact = plugin.metadataLedger.exact.bind(plugin.metadataLedger)
		let changed = false
		vi.spyOn(plugin.metadataLedger, 'exact').mockImplementation((path, snapshot) => {
			const result = exact(path, snapshot)
			if (!changed) {
				changed = true
				editor.transaction({ changes: [{ from: { line: 1, ch: content.split('\n')[1].length }, to: { line: 1, ch: content.split('\n')[1].length }, text: ' user edit' }] })
			}
			return result
		})
		vi.spyOn(plugin, 'openRenameModal').mockResolvedValue({ action: 'cancel', applyToRemaining: true })

		await plugin.processRenameBurst(files.map(file => ({ ...request(file, sourceFile), autoRename: false })))

		expect(editor.getValue()).toContain('user edit')
		expect(diskContent()).toBe(originalDisk)
		expect(plugin.openRenameModal).not.toHaveBeenCalled()
		expect(noticeMessages).toEqual(['Skipped 2 attachments because the active note could not be synchronized'])
	})

	it('leaves editor and disk unchanged when figure commit rejects after transforming', async () => {
		const paths = ['assets/first.png', 'assets/second.pdf']
		const content = paths.map(path => `![[${path}]]`).join('\n')
		const { app, diskContent, editor, files, plugin, sourceFile } = createBurstProductionHarness({ filePaths: paths, content, imageOutput: 'html' })
		vi.spyOn(plugin, 'generateNewName').mockImplementation(file => ({ stem: file.basename, newName: file.name, isMeaningful: false }))
		vi.spyOn(plugin, 'openRenameModal').mockResolvedValue({ action: 'cancel', applyToRemaining: true })
		const vault = app.vault as unknown as { process: (file: TFile, transform: (value: string) => string) => Promise<string> }
		const originalProcess = vault.process.bind(vault)
		let rejectNext = true
		vi.spyOn(vault, 'process').mockImplementation(async (file, transform) => {
			const result = await originalProcess(file, transform)
			if (rejectNext) {
				rejectNext = false
				throw new Error(`rejected after ${result.length}`)
			}
			return result
		})

		await plugin.processRenameBurst(files.map(file => ({ ...request(file, sourceFile), autoRename: false })))

		expect(editor.getValue()).toBe(content)
		expect(diskContent()).toBe(content)
		expect(noticeMessages).toEqual(['Skipped 1 attachment because the requested change could not be applied.'])
	})

	it('reports a partial figure mutation when guarded compensation cannot restore disk', async () => {
		const paths = ['assets/first.png', 'assets/second.pdf']
		const content = paths.map(path => `![[${path}]]`).join('\n')
		const { app, diskContent, editor, files, plugin, sourceFile } = createBurstProductionHarness({ filePaths: paths, content, imageOutput: 'html' })
		vi.spyOn(plugin, 'generateNewName').mockImplementation(file => ({ stem: file.basename, newName: file.name, isMeaningful: false }))
		vi.spyOn(plugin, 'openRenameModal').mockResolvedValue({ action: 'cancel', applyToRemaining: true })
		const vault = app.vault as unknown as { process: (file: TFile, transform: (value: string) => string) => Promise<string> }
		const originalProcess = vault.process.bind(vault)
		let firstProcess = true
		vi.spyOn(vault, 'process').mockImplementation(async (file, transform) => {
			if (!firstProcess) throw new Error('rollback unavailable')
			firstProcess = false
			const result = await originalProcess(file, transform)
			throw new Error(`unrecoverable after ${result.length}`)
		})

		await plugin.processRenameBurst(files.map(file => ({ ...request(file, sourceFile), autoRename: false })))

		expect(editor.getValue()).toBe(content)
		expect(diskContent()).toContain('<figure')
		expect(noticeMessages).toEqual([
			'Changed 1 attachment, but references could not be synchronized.',
		])
	})

	it('compensates a detached figure commit instead of reporting a false success', async () => {
		const paths = ['assets/first.png', 'assets/second.pdf']
		const content = paths.map(path => `![[${path}]]`).join('\n')
		const { app, diskContent, editor, files, plugin, sourceFile } = createBurstProductionHarness({ filePaths: paths, content, imageOutput: 'html' })
		vi.spyOn(plugin, 'generateNewName').mockImplementation(file => ({ stem: file.basename, newName: file.name, isMeaningful: false }))
		vi.spyOn(plugin, 'openRenameModal').mockResolvedValue({ action: 'cancel', applyToRemaining: true })
		const view = (app.workspace.getActiveViewOfType as () => MarkdownView)()
		const vault = app.vault as unknown as { process: (file: TFile, transform: (value: string) => string) => Promise<string> }
		const originalProcess = vault.process.bind(vault)
		vi.spyOn(vault, 'process').mockImplementation(async (file, transform) => {
			const result = await originalProcess(file, transform)
			if (result.includes('<figure')) view.file = createFile('notes/other.md') as unknown as TFile
			return result
		})

		await plugin.processRenameBurst(files.map(file => ({ ...request(file, sourceFile), autoRename: false })))

		expect(editor.getValue()).toBe(content)
		expect(diskContent()).toBe(content)
		expect(noticeMessages).toEqual(['Skipped 1 attachment because the requested change could not be applied.'])
	})

	it.each([
		['shortest Wikilink', 'notes/topic.md', '![[image.png]]'],
		['relative Markdown with encoded spaces', 'notes/deep/topic.md', '![image](../../assets/photo%20space.png)'],
		['absolute Wikilink', 'notes/topic.md', '![[/assets/image.png]]'],
	] as const)('keeps the exact generated %s destination when cancelling a container reference', async (_label, sourcePath, generatedLink) => {
		const filePath = generatedLink.includes('photo') ? 'assets/photo space.png' : 'assets/image.png'
		const content = `- ${generatedLink}`
		const generatedDestination = generatedLink.includes('photo') ? '../../assets/photo%20space.png' : generatedLink.slice(3, -2)
		const { editor, files, plugin, sourceFile } = createBurstProductionHarness({
			sourcePath,
			filePaths: [filePath, 'assets/second.png'],
			content: `${content}\n![[assets/second.png]]`,
			imageOutput: 'html',
			linkForPath: path => path === filePath ? generatedDestination : path,
		})
		vi.spyOn(plugin, 'generateNewName').mockImplementation(file => ({ stem: file.basename, newName: file.name, isMeaningful: false }))
		const fullContent = `${content}\n![[assets/second.png]]`
		const firstReference = {
			link: generatedDestination, original: generatedLink,
			position: {
				start: { line: 0, col: 2, offset: 2 },
				end: { line: 0, col: 2 + generatedLink.length, offset: 2 + generatedLink.length },
			},
		}
		const secondReference = {
			link: 'assets/second.png', original: '![[assets/second.png]]',
			position: { start: { line: 1, col: 0, offset: fullContent.indexOf('![[assets/second.png]]') }, end: { line: 1, col: 22, offset: fullContent.length } },
		}
		plugin.metadataLedger.record(sourceFile.path, fullContent, {
			...(generatedLink.startsWith('![[') ? { embeds: [firstReference, secondReference] } : { embeds: [secondReference], links: [firstReference] }),
		} as never)
		vi.spyOn(plugin, 'openRenameModal').mockResolvedValue({ action: 'cancel', applyToRemaining: true })

		await plugin.processRenameBurst(files.map(file => ({ ...request(file, sourceFile), autoRename: false })))

		expect(editor.getValue()).toContain(content)
		expect(editor.getValue().match(/<figure style="text-align: center;">/g)).toHaveLength(1)
	})

	it('revalidates and renames exact non-image cache.links attachments', async () => {
		const paths = ['assets/report.pdf', 'assets/second.png']
		const content = `[Report](${paths[0]})\n![[${paths[1]}]]`
		const { editor, files, plugin, sourceFile } = createBurstProductionHarness({ filePaths: paths, content, imageOutput: 'markdown' })
		const metadata = plugin.metadataLedger.exact(sourceFile.path, content)
		if (metadata) {
			const link = { link: paths[0], original: `[Report](${paths[0]})`, position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: `[Report](${paths[0]})`.length, offset: `[Report](${paths[0]})`.length } } }
			plugin.metadataLedger.record(sourceFile.path, content, { ...metadata, links: [link] } as never)
		}
		vi.spyOn(plugin, 'generateNewName').mockImplementation(file => ({ stem: file.basename, newName: `${file.basename}-renamed.${file.extension}`, isMeaningful: false }))
		vi.spyOn(plugin, 'openRenameModal').mockResolvedValue({ action: 'rename', name: 'report-renamed.pdf', applyToRemaining: false })

		await plugin.processRenameBurst(files.map(file => ({ ...request(file, sourceFile), autoRename: false })))

		expect(files[0].path).toBe('assets/report-renamed.pdf')
		expect(editor.getValue()).toContain('[Report](assets/report-renamed.pdf)')
	})

	it('resolves an eleven-item sparse exact burst before its first decision', async () => {
		const paths = Array.from({ length: 11 }, (_, index) => `assets/item-${index}.png`)
		const content = paths.map((path, index) => `${index === 0 ? '' : '\n'.repeat(10)}![[${path}]]`).join('')
			+ `\n![[${paths[0]}]]\n![[assets/existing.jpeg]]`
		const { cacheForContent, files, plugin, sourceFile } = createBurstProductionHarness({
			filePaths: [...paths, 'assets/existing.jpeg', 'assets/stale.png'],
			content,
			imageOutput: 'html',
		})
		const cached = cacheForContent(content)
		cached.cache.embeds.push({
			link: 'assets/stale.png',
			original: '![[assets/stale.png]]',
			position: {
				start: { line: 999, col: 0, offset: content.length + 100 },
				end: { line: 999, col: 21, offset: content.length + 121 },
			},
		})
		plugin.metadataLedger.record(sourceFile.path, content, cached.cache as never)
		vi.spyOn(plugin, 'generateNewName').mockImplementation(file => ({
			stem: file.basename,
			newName: `${file.basename}-default.${file.extension}`,
			isMeaningful: false,
		}))
		const prepare = plugin.prepareExactRenameBurst.bind(plugin)
		let preparedPaths: string[] = []
		let preparedCounts = new Map<string, number>()
		vi.spyOn(plugin, 'prepareExactRenameBurst').mockImplementation(async (...args) => {
			const result = await prepare(...args)
			if ('context' in result) {
				preparedPaths = [...result.occurrencesByPath.keys()]
				preparedCounts = new Map([...result.occurrencesByPath.entries()].map(([path, occurrences]) => [path, occurrences.length]))
			}
			return result
		})
		const firstDecisionPaths: string[] = []
		vi.spyOn(plugin, 'openRenameModal').mockImplementation(async () => {
			firstDecisionPaths.push(...preparedPaths)
			return { action: 'cancel', applyToRemaining: true }
		})
		const appliedIds: string[] = []
		vi.spyOn(plugin, 'convertBatchAttachmentToFigure').mockImplementation(async task => {
			appliedIds.push(task.id)
			return true
		})

		await plugin.processRenameBurst(files.slice(0, paths.length).map(file => ({ ...request(file, sourceFile), autoRename: false })))

		expect(preparedPaths).toEqual(paths)
		expect(preparedCounts.get(paths[0])).toBe(2)
		expect(preparedCounts.has('assets/stale.png')).toBe(false)
		expect(preparedPaths.includes('assets/existing.jpeg')).toBe(false)
		expect(firstDecisionPaths).toEqual(paths)
		expect(appliedIds).toEqual(paths.map((_, index) => String(index)))
	})

	it('renames every exact task in order when one modal choice applies to all remaining files', async () => {
		const paths = ['assets/first.png', 'assets/second.png', 'assets/third.png']
		const content = paths.map(path => `![[${path}]]`).join('\n')
		const { diskContent, editor, files, plugin, sourceFile } = createBurstProductionHarness({ filePaths: paths, content, imageOutput: 'markdown' })
		vi.spyOn(plugin, 'generateNewName').mockImplementation(file => ({
			stem: file.basename,
			newName: `${file.basename}-default.${file.extension}`,
			isMeaningful: false,
		}))
		const modal = vi.spyOn(plugin, 'openRenameModal').mockResolvedValue({
			action: 'rename', name: 'first-confirmed.png', applyToRemaining: true,
		})
		const exactPreflights = vi.spyOn(plugin, 'prepareBatchSourceExact')
		const renameImplementation = plugin.renameFile.bind(plugin)
		const mutations = vi.spyOn(plugin, 'renameFile').mockImplementation(async (...args) => renameImplementation(...args))
		const mutationOrder: Array<[string, string]> = []
		const batchMutationImplementation = plugin.renameBatchAttachmentOutcome.bind(plugin)
		const outcomes: string[] = []
		const batchMutations = vi.spyOn(plugin, 'renameBatchAttachmentOutcome').mockImplementation(async (...args) => {
			mutationOrder.push([args[0].path, args[1]])
			const outcome = await batchMutationImplementation(...args)
			outcomes.push(outcome)
			return outcome
		})

		await plugin.processRenameBurst(files.map(file => ({ ...request(file, sourceFile), autoRename: false })))

		expect(modal).toHaveBeenCalledOnce()
		expect(mutationOrder).toEqual([
			['assets/first.png', 'first-confirmed.png'],
			['assets/second.png', 'second-default.png'],
			['assets/third.png', 'third-default.png'],
		])
		expect(outcomes).toEqual(['success', 'success', 'success'])
		expect(files.map(file => file.path)).toEqual([
			'assets/first-confirmed.png',
			'assets/second-default.png',
			'assets/third-default.png',
		])
		const expectedContent = '![[assets/first-confirmed.png]]\n![[assets/second-default.png]]\n![[assets/third-default.png]]'
		expect(editor.getValue()).toBe(expectedContent)
		expect(diskContent()).toBe(expectedContent)
		expect(noticeMessages).toEqual([])
		expect(mutations.mock.calls.map(call => call[3])).toEqual([false, false, false])
		expect(batchMutations).toHaveBeenCalledTimes(paths.length)
		expect(exactPreflights).toHaveBeenCalledTimes(files.length + 1)
	})

	it('converts every exact renamed image into a canonical figure in HTML output', async () => {
		const paths = ['assets/first.png', 'assets/second.png', 'assets/third.png']
		const content = paths.map(path => `![[${path}]]`).join('\n')
		const { diskContent, editor, files, plugin, sourceFile } = createBurstProductionHarness({ filePaths: paths, content, imageOutput: 'html' })
		vi.spyOn(plugin, 'generateNewName').mockImplementation(file => ({
			stem: file.basename,
			newName: `${file.basename}-default.${file.extension}`,
			isMeaningful: false,
		}))
		vi.spyOn(plugin, 'openRenameModal').mockResolvedValue({
			action: 'rename', name: 'first-confirmed.png', applyToRemaining: true,
		})

		await plugin.processRenameBurst(files.map(file => ({ ...request(file, sourceFile), autoRename: false })))

		const expectedPaths = ['assets/first-confirmed.png', 'assets/second-default.png', 'assets/third-default.png']
		const expectedContent = expectedPaths.map(path => renderFigure({
			src: path,
			stem: path.slice(path.lastIndexOf('/') + 1, path.lastIndexOf('.')),
			width: plugin.settings.imageWidth,
		})).join('\n\n')
		expect(editor.getValue()).toBe(expectedContent)
		expect(diskContent()).toBe(expectedContent)
	})

	it.each([
		['live', 'length increase', false, 'assets/old.png', 'very-long-renamed-image.png'],
		['live', 'length decrease', false, 'assets/old-long-image-name.png', 'new.png'],
		['detached', 'length increase', true, 'assets/old.png', 'very-long-renamed-image.png'],
		['detached', 'length decrease', true, 'assets/old-long-image-name.png', 'new.png'],
	] as const)('converts repeated mixed references in a %s exact rename with a %s', async (_path, _length, detached, oldPath, newName) => {
		const content = `![[${oldPath}]]\n- ![[${oldPath}|Caption]]\n![[${oldPath}]]`
		const { app, diskContent, editor, editorSession, files: [file], plugin, sourceFile } = createBurstProductionHarness({ filePaths: [oldPath], content, imageOutput: 'html' })
		if (detached) detachBatchEditorAfterThirdRead(app)

		const outcome = await plugin.renameBatchAttachmentOutcome(file, newName, sourceFile, editorSession, 0, false, true)

		const newPath = `assets/${newName}`
		const figure = renderFigure({ src: newPath, stem: newName.slice(0, -'.png'.length), width: plugin.settings.imageWidth })
		const expectedContent = `${figure}\n\n- ![[${newPath}|Caption]]\n${figure}`
		expect(outcome).toBe('success')
		expect(editor.getValue()).toBe(detached ? content : expectedContent)
		expect(diskContent()).toBe(expectedContent)
	})

	it.each([
		['live', false],
		['detached', true],
	] as const)('converts a same-name exact image to a figure in the %s editor path', async (_label, detached) => {
		const filePath = 'assets/same-name.png'
		const content = `![[${filePath}]]`
		const { app, diskContent, editor, editorSession, files: [file], plugin, sourceFile } = createBurstProductionHarness({ filePaths: [filePath], content, imageOutput: 'html' })
		const exactPreflights = vi.spyOn(plugin, 'prepareBatchSourceExact')
		if (detached) detachBatchEditorAfterThirdRead(app)

		const outcome = await plugin.renameBatchAttachmentOutcome(file, file.name, sourceFile, editorSession, 0, false, true)

		const expectedContent = renderFigure({ src: filePath, stem: file.basename, width: plugin.settings.imageWidth })
		expect(outcome).toBe('success')
		expect(exactPreflights).toHaveBeenCalledOnce()
		expect(editor.getValue()).toBe(detached ? content : expectedContent)
		expect(diskContent()).toBe(expectedContent)
	})

	it('reports a same-name live commit rejection before its transform as not applied', async () => {
		const filePath = 'assets/same-name.png'
		const content = `![[${filePath}]]`
		const { app, diskContent, editor, editorSession, files: [file], plugin, sourceFile } = createBurstProductionHarness({
			filePaths: [filePath], content, imageOutput: 'html',
		})
		vi.spyOn(app.vault as unknown as { process: () => Promise<string> }, 'process').mockRejectedValue(new Error('rejected before transform'))

		const outcome = await plugin.renameBatchAttachmentOutcome(file, file.name, sourceFile, editorSession, 0, false, true)

		expect(outcome).toBe('not-applied')
		expect(editor.getValue()).toBe(content)
		expect(diskContent()).toBe(content)
	})

	it('rebases repeated exact occurrences while preserving container links in the live editor', async () => {
		const paths = ['assets/a.png', 'assets/b.png']
		const content = `![[${paths[0]}]]\n- ![[${paths[0]}]]\n![[${paths[1]}]]`
		const { diskContent, editor, files, plugin, sourceFile } = createBurstProductionHarness({ filePaths: paths, content, imageOutput: 'html' })
		vi.spyOn(plugin, 'generateNewName').mockImplementation(file => ({
			stem: file.basename,
			newName: `${file.basename}-default.${file.extension}`,
			isMeaningful: false,
		}))
		vi.spyOn(plugin, 'openRenameModal').mockResolvedValue({
			action: 'rename', name: 'a-much-longer-confirmed.png', applyToRemaining: true,
		})

		await plugin.processRenameBurst(files.map(file => ({ ...request(file, sourceFile), autoRename: false })))

		const firstPath = 'assets/a-much-longer-confirmed.png'
		const secondPath = 'assets/b-default.png'
		const expectedContent = [
			renderFigure({ src: firstPath, stem: 'a-much-longer-confirmed', width: plugin.settings.imageWidth }),
			'',
			`- ![[${firstPath}]]`,
			renderFigure({ src: secondPath, stem: 'b-default', width: plugin.settings.imageWidth }),
		].join('\n')
		expect(editor.getValue()).toBe(expectedContent)
		expect(diskContent()).toBe(expectedContent)
	})

	it('reports stale exact figure provenance as renamed but unsynchronized', async () => {
		const oldPath = 'assets/old.png'
		const content = `![[${oldPath}]]`
		const { diskContent, editor, editorSession, file, plugin, sourceFile } = createLiveHarness({
			sourcePath: 'notes/source.md', filePath: oldPath, generatedLink: '![[assets/new.png]]', content, imageOutput: 'html',
		})
		const exact = cachedMetadataFor(content).snapshot
		const stale = exact.references.map(occurrence => ({
			...occurrence,
			start: occurrence.start + 1,
			end: occurrence.end + 1,
			destinationStart: occurrence.destinationStart + 1,
			destinationEnd: occurrence.destinationEnd + 1,
		}))
		vi.spyOn(plugin, 'prepareBatchSource').mockResolvedValue({ ...exact, embeds: stale, references: stale })
		vi.spyOn(plugin, 'waitForBatchEditorContent').mockResolvedValue({ ready: true })

		const outcome = await plugin.renameBatchAttachmentOutcome(file, 'new.png', sourceFile, editorSession, 0, false, true)

		expect(outcome).toBe('renamed-but-unsynchronized')
		expect(editor.getValue()).toBe(content)
		expect(diskContent()).toBe(content)
	})

	it('converts an encoded cached reference to a canonical figure in an actual burst', async () => {
		const rawPath = 'assets/raw%20 folder/Đọc image%.png'
		const encodedPath = rawPath.split('/').map(segment => encodeURIComponent(segment)).join('/')
		const secondPath = 'assets/second.png'
		const linkForPath = (path: string) => path.split('/').map(segment => encodeURIComponent(segment)).join('/')
		const content = `![[${encodedPath}]]\n![[${linkForPath(secondPath)}]]`
		const { editor, files, plugin, sourceFile } = createBurstProductionHarness({
			filePaths: [rawPath, secondPath],
			content,
			linkForPath,
			imageOutput: 'html',
		})
		vi.spyOn(plugin, 'generateNewName').mockImplementation(file => ({
			stem: file.basename,
			newName: file.name,
			isMeaningful: false,
		}))
		vi.spyOn(plugin, 'openRenameModal').mockResolvedValue({ action: 'cancel', applyToRemaining: true })
		const conversions = vi.spyOn(plugin, 'convertBatchAttachmentToFigure')
		const exactPreflights = vi.spyOn(plugin, 'prepareBatchSourceExact')

		await plugin.processRenameBurst(files.map(file => ({ ...request(file, sourceFile), autoRename: false })))

		expect(conversions.mock.calls.map(call => call[0].file.path)).toEqual([rawPath, secondPath])
		expect(editor.getValue()).toContain(`<img src="${encodedPath}"`)
		expect(editor.getValue()).not.toContain('<img src="../')
		expect(editor.getValue()).toContain('raw%2520%20folder')
		expect(editor.getValue()).toContain('%C4%90%E1%BB%8Dc')
		expect(editor.getValue()).toContain('image%25.png')
		expect(exactPreflights).toHaveBeenCalledTimes(files.length + 1)
	})

	it('processes GIF, SVG, PNG, and JPEG in one exact burst in task order', async () => {
		const paths = ['assets/animated.gif', 'assets/diagram.svg', 'assets/hero.png', 'assets/photo.jpeg']
		const content = paths.map(path => `![[${path}]]`).join('\n')
		const { editor, files, plugin, sourceFile } = createBurstProductionHarness({ filePaths: paths, content, imageOutput: 'html' })
		vi.spyOn(plugin, 'generateNewName').mockImplementation(file => ({
			stem: file.basename,
			newName: file.name,
			isMeaningful: false,
		}))
		vi.spyOn(plugin, 'openRenameModal').mockResolvedValue({ action: 'cancel', applyToRemaining: true })
		const conversions = vi.spyOn(plugin, 'convertBatchAttachmentToFigure')

		await plugin.processRenameBurst(files.map(file => ({ ...request(file, sourceFile), autoRename: false })))

		expect(files.map(file => file.extension)).toEqual(['gif', 'svg', 'png', 'jpeg'])
		expect(files.every(file => isImageExtension(file.extension, plugin.attachmentTypes))).toBe(true)
		expect(conversions.mock.calls.map(call => call[0].file.path)).toEqual(paths)
		expect(editor.getValue().match(/<figure style="text-align: center;">/g)).toHaveLength(paths.length)
	})

	it('rolls back an exact preflight failure before opening decisions or mutating attachments', async () => {
		const paths = ['assets/first.png', 'assets/second.png']
		const content = paths.map(path => `![[${path}]]`).join('\n')
		const originalDisk = 'disk content before the burst'
		const { app, diskContent, files, plugin, sourceFile } = createBurstProductionHarness({
			filePaths: paths,
			content,
			diskContent: originalDisk,
			baselineContent: originalDisk,
			metadataSeedContent: originalDisk,
			recordMetadataOnProcess: false,
		})
		vi.spyOn(plugin, 'generateNewName').mockImplementation(file => ({
			stem: file.basename,
			newName: `${file.basename}-default.${file.extension}`,
			isMeaningful: false,
		}))
		const modal = vi.spyOn(plugin, 'openRenameModal')
		const rename = vi.spyOn(plugin, 'renameBatchAttachmentOutcome')
		const events: string[] = []
		const vault = app.vault as unknown as {
			process: (file: TFile, transform: (content: string) => string) => Promise<string>
		}
		const originalProcess = vault.process.bind(vault)
		vi.spyOn(vault, 'process').mockImplementation(async (file, transform) => {
			const before = diskContent()
			const result = await originalProcess(file, transform)
			events.push(`process:${before}->${diskContent()}`)
			return result
		})
		const originalExact = plugin.metadataLedger.exact.bind(plugin.metadataLedger)
		const exactPolls: string[] = []
		vi.spyOn(plugin.metadataLedger, 'exact').mockImplementation((path, value) => {
			exactPolls.push(`${path}:${value}`)
			events.push('cache-poll')
			return originalExact(path, value)
		})
		const originalNoticePush = noticeMessages.push.bind(noticeMessages)
		vi.spyOn(noticeMessages, 'push').mockImplementation((...messages) => {
			events.push('notice')
			return originalNoticePush(...messages)
		})

		vi.stubGlobal('window', { setTimeout: (callback: () => void) => { callback(); return 0 } })
		try {
			await plugin.processRenameBurst(files.map(file => ({ ...request(file, sourceFile), autoRename: false })))
		} finally {
			vi.unstubAllGlobals()
		}
		expect(diskContent()).toBe(originalDisk)
		expect(files.map(file => file.path)).toEqual(paths)
		expect(events[0]).toBe(`process:${originalDisk}->${content}`)
		expect(events.slice(1, -2)).toEqual(Array.from({ length: 5 }, () => 'cache-poll'))
		expect(events[events.length - 2]).toBe(`process:${content}->${originalDisk}`)
		expect(events[events.length - 1]).toBe('notice')
		expect(exactPolls).toHaveLength(5)
		expect(exactPolls.every(poll => poll === `${sourceFile.path}:${content}`)).toBe(true)
		expect(modal).not.toHaveBeenCalled()
		expect(rename).not.toHaveBeenCalled()
		expect(noticeMessages).toEqual(['Skipped 2 attachments because the active note could not be synchronized'])
	})

	it('verifies and rolls back a preflight write that rejects after applying its transform', async () => {
		const paths = ['assets/first.png', 'assets/second.png']
		const content = paths.map(path => `![[${path}]]`).join('\n')
		const originalDisk = 'disk content before the rejected write'
		const { app, diskContent, editor, files, plugin, sourceFile } = createBurstProductionHarness({
			filePaths: paths,
			content,
			diskContent: originalDisk,
			baselineContent: originalDisk,
			metadataSeedContent: originalDisk,
			recordMetadataOnProcess: false,
		})
		vi.spyOn(plugin, 'generateNewName').mockImplementation(file => ({ stem: file.basename, newName: file.name, isMeaningful: false }))
		const modal = vi.spyOn(plugin, 'openRenameModal')
		const rename = vi.spyOn(plugin, 'renameBatchAttachmentOutcome')
		const figure = vi.spyOn(plugin, 'convertBatchAttachmentToFigure')
		const vault = app.vault as unknown as { process: (file: TFile, transform: (value: string) => string) => Promise<string> }
		const originalProcess = vault.process.bind(vault)
		let rejectNext = true
		vi.spyOn(vault, 'process').mockImplementation(async (file, transform) => {
			const result = await originalProcess(file, transform)
			if (rejectNext) {
				rejectNext = false
				throw new Error(`rejected after applying ${result.length} characters`)
			}
			return result
		})

		await plugin.processRenameBurst(files.map(file => ({ ...request(file, sourceFile), autoRename: false })))

		expect(diskContent()).toBe(originalDisk)
		expect(editor.getValue()).toBe(content)
		expect(files.map(file => file.path)).toEqual(paths)
		expect(modal).not.toHaveBeenCalled()
		expect(rename).not.toHaveBeenCalled()
		expect(figure).not.toHaveBeenCalled()
		expect(noticeMessages).toEqual(['Skipped 2 attachments because the active note could not be synchronized'])
	})

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
			'Renamed 1 attachment, but references could not be synchronized; skipped 1 attachment because the requested change could not be applied.',
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
