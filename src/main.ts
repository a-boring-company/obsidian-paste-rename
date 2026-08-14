/* TODOs:
 * - [x] check name existence when saving
 * - [x] imageNameKey in frontmatter
 * - [x] after renaming, cursor should be placed after the image file link
 * - [x] handle image insert from drag'n drop
 * - [ ] select text when opening the renaming modal, make this an option
 * - [ ] add button for use the current file name, imageNameKey, last input name,
 *       segments of last input name
 * - [x] batch rename all pasted images in a file
 * - [ ] add rules for moving matched images to destination folder
 */
import {
  App,
  EditorPosition,
  HeadingCache,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TAbstractFile,
  TFile,
} from 'obsidian';

import { ImageBatchRenameModal } from './batch';
import { observeAsyncCommand } from './async-command';
import { applyBatchChoice, createBatchChoiceState } from './batch-state';
import { attachmentTargetPathGroups, extractGeneratedDestination, imageLinkText } from './attachment-links';
import { relativeAttachmentPath, renameInPlace } from './attachment-path';
import { replaceAttachmentReference } from './attachment-reference';
import { collectBatchReferenceLinks } from './batch-references';
import { replaceGeneratedFigures } from './figure-document';
import { applyAttachmentTypeSnapshot, commitAttachmentTypeSnapshot, createAttachmentTypePersistence, reconcileAttachmentTypeFailure } from './attachment-type-state';
import {
	AttachmentTypeConfig,
	cloneAttachmentTypeConfig,
	DEFAULT_ATTACHMENT_TYPE_CONFIG,
	isImageExtension,
	parseAttachmentTypeConfig,
	parseAttachmentTypeTextarea,
} from './attachment-types';
import { cancelBurst, createBurstCancellation, isBurstCancelled } from './burst';
import { isEligibleAttachmentCreate } from './create-eligibility';
import { LineEdit, mapCursorAfterLineEdit, replaceNearCursorInText } from './embed-location';
import { renderFigure } from './figure';
import { normalizeFilenameStem } from './filename';
import { retryBounded } from './retry';
import { renderTemplate } from './template';
import { createSerializedWriteQueue } from './write-queue';
import {
  createElementTree,
  DEBUG,
  debugLog,
  escapeRegExp,
  lockInputMethodComposition,
  NameObj,
  path,
  sanitizer,
} from './utils';

interface PluginSettings {
	// {{imageNameKey}}-{{DATE:YYYYMMDD}}
	imageNamePattern: string
	dupNumberAtStart: boolean
	dupNumberDelimiter: string
	dupNumberAlways: boolean
	autoRename: boolean
	handleAllAttachments: boolean
	imageOutput: 'html' | 'markdown'
	imageWidth: number
	excludeExtensionPattern: string
	disableRenameNotice: boolean
}

export const DEFAULT_SETTINGS: PluginSettings = {
	imageNamePattern: '{{fileName}}',
	dupNumberAtStart: false,
	dupNumberDelimiter: '-',
	dupNumberAlways: false,
	autoRename: false,
	handleAllAttachments: true,
	imageOutput: 'html',
	imageWidth: 80,
	excludeExtensionPattern: '',
	disableRenameNotice: false,
}

const PASTED_IMAGE_PREFIX = 'Pasted image '
const CREATE_BURST_DELAY_MS = 100
const FIGURE_RETRY_COUNT = 3
const FIGURE_RETRY_DELAY_MS = 50

interface RenameRequest {
	file: TFile
	sourceFile: TFile
	sourcePath: string
	cursor: EditorPosition
	autoRename: boolean
	generation: number
}

interface RenameTask extends RenameRequest {
	id: string
	proposedName: string
	stem: string
	isMeaningful: boolean
}

interface ModalChoice {
	action: 'rename' | 'cancel'
	name?: string
	applyToRemaining: boolean
}

interface ReferenceReplacement {
	matched: boolean
	edit: LineEdit | null
}


export default class PasteRenamePlugin extends Plugin {
	settings: PluginSettings
	attachmentTypes: AttachmentTypeConfig = DEFAULT_ATTACHMENT_TYPE_CONFIG
	modals: Modal[] = []
	excludeExtensionRegex: RegExp
	pendingRenameRequests: RenameRequest[] = []
	burstTimer: number | null = null
	processingBurst = false
	cancellation = createBurstCancellation()
	attachmentTypeWrites = createSerializedWriteQueue(cloneAttachmentTypeConfig)
	attachmentTypePersistence = createAttachmentTypePersistence(DEFAULT_ATTACHMENT_TYPE_CONFIG)

	async onload() {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const pkg = require('../package.json')
		console.log(`Plugin loading: ${pkg.name} ${pkg.version} BUILD_ENV=${process.env.BUILD_ENV}`)
		const generation = this.cancellation.generation
		await this.loadSettings();
		if (!this.isCurrent(generation)) return
		await this.loadAttachmentTypes(generation);
		if (!this.isCurrent(generation)) return

		this.registerEvent(
			this.app.vault.on('create', (file) => {
				// debugLog('file created', file)
				if (!(file instanceof TFile))
					return
				const timeGapMs = (new Date().getTime()) - file.stat.ctime
				// if the file is created more than 1 second ago, the event is most likely be fired on vault initialization when starting Obsidian app, ignore it
				if (timeGapMs > 1000)
					return
				// always ignore markdown file creation
				if (isMarkdownFile(file))
					return
				if (!this.isEligibleCreate(file)) return
				const sourceFile = this.getActiveFile()
				if (!sourceFile) {
					new Notice('Error: No active file found.')
					return
				}
				const editor = this.getActiveEditor()
				const cursor = editor?.getCursor() || { line: 0, ch: 0 }
				debugLog('attachment created', file)
				this.enqueueRenameRequest({
					file,
					sourceFile,
					sourcePath: sourceFile.path,
					cursor,
					autoRename: this.settings.autoRename,
					generation: this.cancellation.generation,
				})
			})
		)

		const startBatchRenameProcess = () => {
			this.openBatchRenameModal()
		}
		this.addCommand({
			id: 'batch-rename-embeded-files',
			name: 'Batch rename embeded files (in the current file)',
			callback: startBatchRenameProcess,
		})
		if (DEBUG) {
			this.addRibbonIcon('wand-glyph', 'Batch rename embeded files', startBatchRenameProcess)
		}

		const batchRenameAllImages = () => {
			void observeAsyncCommand(
				() => this.batchRenameAllImages(),
				error => {
					console.error('Could not batch rename images', error)
					new Notice('Could not batch rename images')
				},
			)
		}
		this.addCommand({
			id: 'batch-rename-all-images',
			name: 'Batch rename all images instantly (in the current file)',
			callback: batchRenameAllImages,
		})
		if (DEBUG) {
			this.addRibbonIcon('wand-glyph', 'Batch rename all images instantly (in the current file)', batchRenameAllImages)
		}

		// add settings tab
		this.addSettingTab(new SettingTab(this.app, this));

	}

	isEligibleCreate(file: TFile): boolean {
		return isEligibleAttachmentCreate(
			file.extension,
			isPastedImage(file),
			this.settings.handleAllAttachments,
			() => this.testExcludeExtension(file),
			this.attachmentTypes,
		)
	}

	enqueueRenameRequest(request: RenameRequest) {
		this.pendingRenameRequests.push(request)
		if (this.burstTimer !== null) window.clearTimeout(this.burstTimer)
		this.burstTimer = window.setTimeout(() => {
			this.burstTimer = null
			void this.processPendingBurst()
		}, CREATE_BURST_DELAY_MS)
	}

	async processPendingBurst() {
		if (this.processingBurst || !this.pendingRenameRequests.length || this.cancellation.cancelled) return
		this.processingBurst = true
		const requests = this.pendingRenameRequests.splice(0)
		const generation = requests[0]?.generation ?? this.cancellation.generation
		try {
			await this.processRenameBurst(requests, generation)
		} finally {
			this.processingBurst = false
			if (this.pendingRenameRequests.length && this.isCurrent(generation)) {
				this.burstTimer = window.setTimeout(() => {
					this.burstTimer = null
					void this.processPendingBurst()
				}, CREATE_BURST_DELAY_MS)
			}
		}
	}

	async processRenameBurst(requests: RenameRequest[], generation = this.cancellation.generation) {
		if (!this.isCurrent(generation)) return
		const tasks: RenameTask[] = requests.map((request, index) => {
			const generated = this.generateNewName(request.file, request.sourceFile)
			return { ...request, id: `${index}`, proposedName: generated.newName, stem: generated.stem, isMeaningful: generated.isMeaningful }
		})
		let state = createBatchChoiceState(tasks.map(task => ({ id: task.id, proposedName: task.proposedName })))
		const taskById = new Map(tasks.map(task => [task.id, task]))
		while (state.remaining.length) {
			if (!this.isCurrent(generation)) return
			const current = taskById.get(state.remaining[0].id)
			if (!current) break
			if (current.autoRename) {
				if (!current.isMeaningful) {
					if (this.isCurrent(generation)) new Notice('Failed to rename attachment: generated name is empty')
					state = applyBatchChoice(state, 'cancel').state
					continue
				}
				const result = applyBatchChoice(state, 'rename', { name: current.proposedName })
				await this.applyRenameDecisions(result.decisions, taskById, generation)
				state = result.state
				continue
			}
			const choice = await this.openRenameModal(current, state.remaining.length > 1, generation)
			if (!this.isCurrent(generation)) return
			const result = applyBatchChoice(state, choice.action, {
				name: choice.name,
				applyToRemaining: choice.applyToRemaining,
			})
			await this.applyRenameDecisions(result.decisions, taskById, generation)
			state = result.state
		}
	}

	async applyRenameDecisions(
		decisions: Array<{ id: string; action: 'rename' | 'cancel'; name: string }>,
		taskById: Map<string, RenameTask>,
		generation = this.cancellation.generation,
	) {
		for (const decision of decisions) {
			if (!this.isCurrent(generation)) return
			const task = taskById.get(decision.id)
			if (!task) continue
			if (decision.action === 'rename') {
				const edit = await this.renameFile(task.file, decision.name, task.sourcePath, true, task.cursor, generation)
				if (edit && this.isCurrent(generation)) this.updateTaskCursors(taskById, edit)
			} else if (this.settings.imageOutput === 'html' && isImageExtension(task.file.extension, this.attachmentTypes)) {
				const result = await this.replaceAttachmentReference(task.file, task.sourcePath, task.file.path, task.cursor, generation)
				if (result.edit && this.isCurrent(generation)) this.updateTaskCursors(taskById, result.edit)
			}
		}
	}

	updateTaskCursors(taskById: Map<string, RenameTask>, edit: LineEdit) {
		for (const task of taskById.values()) task.cursor = mapCursorAfterLineEdit(task.cursor, edit)
	}

	async renameFile(
		file: TFile,
		inputNewName: string,
		sourcePath: string,
		replaceCurrentLine = false,
		capturedCursor?: EditorPosition,
		generation = this.cancellation.generation,
	): Promise<LineEdit | null> {
		const originPath = file.path
		const suffix = file.extension ? `.${file.extension}` : ''
		const rawStem = suffix && inputNewName.endsWith(suffix) ? inputNewName.slice(0, -suffix.length) : inputNewName
		const normalizedStem = normalizeFilenameStem(rawStem)
		if (!normalizedStem) {
			if (this.isCurrent(generation)) new Notice('Failed to rename attachment: new name is empty')
			return null
		}
		const normalizedName = suffix ? `${normalizedStem}${suffix}` : normalizedStem
		// deduplicate name
		const { name: newName } = await this.deduplicateNewName(normalizedName, file)
		if (!this.isCurrent(generation)) return null
		debugLog('deduplicated newName:', newName)
		const originName = file.name
		const oldLinkText = this.app.fileManager.generateMarkdownLink(file, sourcePath)
		// File system operation: rename the file in its current parent directory.
		const newPath = renameInPlace(originPath, newName)
		try {
			if (!this.isCurrent(generation)) return null
			await this.app.fileManager.renameFile(file, newPath)
		} catch (err) {
			if (this.isCurrent(generation)) new Notice(`Failed to rename ${newName}: ${err}`)
			return null
		}
		if (!this.isCurrent(generation)) return null

		if (!replaceCurrentLine) {
			return null
		}

		// in case fileManager.renameFile may not update the internal link in the active file,
		// we manually replace the current line by manipulating the editor

		const newLinkText = this.app.fileManager.generateMarkdownLink(file, sourcePath)
		debugLog('replace text', newLinkText)
		const cursor = capturedCursor || this.getActiveEditor()?.getCursor() || { line: 0, ch: 0 }
		const targetGroups = attachmentTargetPathGroups(
			sourcePath,
			originPath,
			file.path,
			oldLinkText,
			newLinkText,
		)
		const result = await this.replaceAttachmentReference(file, sourcePath, originPath, cursor, generation, targetGroups, newLinkText)
		if (!this.isCurrent(generation)) return null

		if (!this.settings.disableRenameNotice) {
			new Notice(`Renamed ${originName} to ${newName}`)
		}
		return result.edit
	}

	async replaceAttachmentReference(
		file: TFile,
		sourcePath: string,
		previousPath: string,
		cursor: EditorPosition,
		generation = this.cancellation.generation,
		targetGroups = attachmentTargetPathGroups(
			sourcePath,
			previousPath,
			file.path,
			this.app.fileManager.generateMarkdownLink(file, sourcePath),
			this.app.fileManager.generateMarkdownLink(file, sourcePath),
		),
		newLinkText = this.app.fileManager.generateMarkdownLink(file, sourcePath),
	): Promise<ReferenceReplacement> {
		if (!this.isCurrent(generation)) return { matched: false, edit: null }
		const currentPath = relativeAttachmentPath(sourcePath, file.path)
		const targetPaths = targetGroups.old
		const image = isImageExtension(file.extension, this.attachmentTypes)
		const asFigure = image && this.settings.imageOutput === 'html'
		const desiredLinkText = image ? imageLinkText(newLinkText) : newLinkText
		const replacementPath = extractGeneratedDestination(newLinkText) ?? currentPath
		const replacement = asFigure
			? renderFigure({ src: currentPath, stem: file.basename, width: this.settings.imageWidth })
			: desiredLinkText
		const figureImageLine = asFigure ? replacement.split('\n')[1] : ''
		const result = await retryBounded(FIGURE_RETRY_COUNT, async attempt => {
			if (!this.isCurrent(generation)) return null
			const liveEditor = this.getActiveEditor()
			if (!liveEditor || this.getActiveFile()?.path !== sourcePath) return null
			const edit = replaceNearCursorInText(
				cursor,
				liveEditor.lineCount(),
				(content, contentCursor) => replaceAttachmentReference({
					content,
					cursor: contentCursor,
					targetPaths,
					currentTargetPaths: targetGroups.current,
					replacement,
					replacementPath,
					image,
					asFigure,
					figureImageLine,
				}),
				line => liveEditor.getLine(line),
			)
			if (!edit) {
				if (attempt + 1 < FIGURE_RETRY_COUNT) {
					await new Promise(resolve => window.setTimeout(resolve, FIGURE_RETRY_DELAY_MS))
				}
				return null
			}
			if (edit.matched) return { edit: null, matched: true }
			if (!this.isCurrent(generation)) return null
			liveEditor.transaction({
				changes: [{
					from: { line: edit.line, ch: edit.start },
					to: { line: edit.endLine, ch: edit.endCh },
					text: edit.text,
				}],
			})
			return { edit, matched: true }
		}, () => !this.isCurrent(generation))
		if (result?.matched) return result
		if (this.isCurrent(generation)) {
			new Notice('Could not update attachment embed; keeping the existing content')
		}
		return { matched: false, edit: null }
	}

	openRenameModal(task: RenameTask, hasRemaining: boolean, generation = this.cancellation.generation): Promise<ModalChoice> {
		return new Promise(resolve => {
			if (!this.isCurrent(generation)) {
				resolve({ action: 'cancel', applyToRemaining: true })
				return
			}
			let settled = false
			const finish = (choice: ModalChoice) => {
				if (settled) return
				settled = true
				resolve(choice)
			}
			const modal = new ImageRenameModal(this.app, task.file, task.stem, hasRemaining, this.attachmentTypes, finish, () => {
				const index = this.modals.indexOf(modal)
				if (index >= 0) this.modals.splice(index, 1)
			})
			this.modals.push(modal)
			modal.open()
			debugLog('modals count', this.modals.length)
		})
	}

	openBatchRenameModal() {
		const activeFile = this.getActiveFile()
		if (!activeFile) {
			new Notice('Error: No active file found.')
			return
		}
		const modal = new ImageBatchRenameModal(
			this.app,
			activeFile,
			async (file: TFile, name: string) => {
				await this.renameBatchAttachment(file, name, activeFile)
			},
			() => {
				const index = this.modals.indexOf(modal)
				if (index >= 0) this.modals.splice(index, 1)
			}
		)
		this.modals.push(modal)
		modal.open()
	}

	async batchRenameAllImages() {
		const activeFile = this.getActiveFile()
		if (!activeFile) {
			new Notice('Error: No active file found.')
			return
		}
		const fileCache = this.app.metadataCache.getFileCache(activeFile)
		const content = await this.app.vault.cachedRead(activeFile)
		const links = collectBatchReferenceLinks(fileCache?.embeds?.map(embed => embed.link) ?? [], content)
		if (!links.length) return
		const files = new Map<string, TFile>()

		for (const link of links) {
			const file = this.app.metadataCache.getFirstLinkpathDest(link, activeFile.path)
			if (!file) {
				console.warn('file not found', link)
				return
			}
			files.set(file.path, file)
		}

		for (const file of files.values()) {
			if (!isImageExtension(file.extension, this.attachmentTypes)) return

			// rename
			const { newName, isMeaningful }= this.generateNewName(file, activeFile)
			debugLog('generated newName:', newName, isMeaningful)
			if (!isMeaningful) {
				new Notice('Failed to batch rename images: the generated name is not meaningful')
				break;
			}

			await this.renameBatchAttachment(file, newName, activeFile)
		}
	}

	async renameBatchAttachment(file: TFile, newName: string, sourceFile: TFile): Promise<void> {
		const oldPath = file.path
		const oldStem = file.basename
		await this.renameFile(file, newName, sourceFile.path, false)
		if (file.path === oldPath) return
		const oldRelativePath = relativeAttachmentPath(sourceFile.path, oldPath)
		const newRelativePath = relativeAttachmentPath(sourceFile.path, file.path)
		await this.app.vault.process(sourceFile, content => replaceGeneratedFigures(
			content,
			oldRelativePath,
			newRelativePath,
			oldStem,
			file.basename,
		))
	}

	// returns a new name for the input file, with extension
	generateNewName(file: TFile, activeFile: TFile) {
		let imageNameKey = ''
		let firstHeading = ''
		let frontmatter
		const fileCache = this.app.metadataCache.getFileCache(activeFile)
		if (fileCache) {
			debugLog('frontmatter', fileCache.frontmatter)
			frontmatter = fileCache.frontmatter
			imageNameKey = frontmatter?.imageNameKey || ''
			firstHeading = getFirstHeading(fileCache.headings)
		} else {
			console.warn('could not get file cache from active file', activeFile.name)
		}

		const stem = normalizeFilenameStem(renderTemplate(
			this.settings.imageNamePattern,
			{
				imageNameKey,
				fileName: activeFile.basename,
				dirName: activeFile.parent.name,
				firstHeading,
			},
			frontmatter))

		return {
			stem,
			newName: `${stem}.${file.extension}`,
			isMeaningful: stem !== '',
		}
	}

	// newName: foo.ext
	async deduplicateNewName(newName: string, file: TFile): Promise<NameObj> {
		// list files in dir
		const dir = file.parent.path
		const listed = await this.app.vault.adapter.list(dir)
		debugLog('sibling files', listed)

		// parse newName
		const newNameExt = path.extension(newName),
			newNameStem = newName.slice(0, newName.length - newNameExt.length - 1),
			newNameStemEscaped = escapeRegExp(newNameStem),
			delimiter = this.settings.dupNumberDelimiter,
			delimiterEscaped = escapeRegExp(delimiter)

		let dupNameRegex
		if (this.settings.dupNumberAtStart) {
			dupNameRegex = new RegExp(
				`^(?<number>\\d+)${delimiterEscaped}(?<name>${newNameStemEscaped})\\.${newNameExt}$`)
		} else {
			dupNameRegex = new RegExp(
				`^(?<name>${newNameStemEscaped})${delimiterEscaped}(?<number>\\d+)\\.${newNameExt}$`)
		}
		debugLog('dupNameRegex', dupNameRegex)

		const dupNameNumbers: number[] = []
		let isNewNameExist = false
		for (let sibling of listed.files) {
			sibling = path.basename(sibling)
			if (sibling == newName) {
				isNewNameExist = true
				continue
			}

			// match dupNames
			const m = dupNameRegex.exec(sibling)
			if (!m) continue
			// parse int for m.groups.number
			dupNameNumbers.push(parseInt(m.groups.number))
		}

		if (isNewNameExist || this.settings.dupNumberAlways) {
			// get max number
			const newNumber = dupNameNumbers.length > 0 ? Math.max(...dupNameNumbers) + 1 : 1
			// change newName
			if (this.settings.dupNumberAtStart) {
				newName = `${newNumber}${delimiter}${newNameStem}.${newNameExt}`
			} else {
				newName = `${newNameStem}${delimiter}${newNumber}.${newNameExt}`
			}
		}

		return {
			name: newName,
			stem: newName.slice(0, newName.length - newNameExt.length - 1),
			extension: newNameExt,
		}
	}

	getActiveFile() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView)
		const file = view?.file
		debugLog('active file', file?.path)
		return file
	}
	getActiveEditor() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView)
		return view?.editor
	}

	isCurrent(generation: number): boolean {
		return !isBurstCancelled(this.cancellation, generation)
	}

	onunload() {
		cancelBurst(this.cancellation)
		if (this.burstTimer !== null) window.clearTimeout(this.burstTimer)
		this.burstTimer = null
		this.pendingRenameRequests = []
		const modals = this.modals.slice()
		this.modals = []
		for (const modal of modals) modal.close()
	}

	testExcludeExtension(file: TFile): boolean {
		const pattern = this.settings.excludeExtensionPattern
		if (!pattern) return false
		return new RegExp(pattern).test(file.extension)
	}

	attachmentTypesPath(): string {
		return `${this.manifest.dir}/attachment-types.json`
	}

	async loadAttachmentTypes(generation = this.cancellation.generation) {
		try {
			const raw = await this.app.vault.adapter.read(this.attachmentTypesPath())
			if (!this.isCurrent(generation)) return
			const result = parseAttachmentTypeConfig(raw)
			if (result.ok === true) {
				this.attachmentTypes = result.value
				this.attachmentTypePersistence.current = cloneAttachmentTypeConfig(result.value)
				commitAttachmentTypeSnapshot(this.attachmentTypePersistence, result.value)
				return
			}
			if (this.isCurrent(generation)) new Notice(`Invalid attachment types; using defaults (${result.error})`)
		} catch {
			if (this.isCurrent(generation)) new Notice('Attachment types file missing; using defaults')
		}
		if (this.isCurrent(generation)) {
			this.attachmentTypes = cloneAttachmentTypeConfig(DEFAULT_ATTACHMENT_TYPE_CONFIG)
			this.attachmentTypePersistence.current = cloneAttachmentTypeConfig(this.attachmentTypes)
			commitAttachmentTypeSnapshot(this.attachmentTypePersistence, this.attachmentTypes)
		}
	}

	async saveAttachmentTypes(config = this.attachmentTypes, revision = this.attachmentTypePersistence.revision) {
		const snapshot = cloneAttachmentTypeConfig(config)
		try {
			await this.attachmentTypeWrites.enqueue(snapshot, async queuedSnapshot => {
				await this.app.vault.adapter.write(this.attachmentTypesPath(), `${JSON.stringify(queuedSnapshot, null, 2)}\n`)
			})
			commitAttachmentTypeSnapshot(this.attachmentTypePersistence, snapshot)
		} catch (error) {
			reconcileAttachmentTypeFailure(this.attachmentTypePersistence, revision)
			this.attachmentTypes = cloneAttachmentTypeConfig(this.attachmentTypePersistence.current)
			throw error
		}
	}

	async resetAttachmentTypes() {
		const revision = applyAttachmentTypeSnapshot(this.attachmentTypePersistence, DEFAULT_ATTACHMENT_TYPE_CONFIG)
		this.attachmentTypes = cloneAttachmentTypeConfig(this.attachmentTypePersistence.current)
		await this.saveAttachmentTypes(this.attachmentTypes, revision)
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
		if (this.settings.imageOutput !== 'html' && this.settings.imageOutput !== 'markdown') this.settings.imageOutput = DEFAULT_SETTINGS.imageOutput
		if (typeof this.settings.imageWidth !== 'number' || !Number.isFinite(this.settings.imageWidth)) this.settings.imageWidth = DEFAULT_SETTINGS.imageWidth
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

function getFirstHeading(headings?: HeadingCache[]) {
	if (headings && headings.length > 0) {
		for (const heading of headings) {
			if (heading.level === 1) {
				return heading.heading
			}
		}
	}
	return ''
}

function isPastedImage(file: TAbstractFile): boolean {
	if (file instanceof TFile) {
		if (file.name.startsWith(PASTED_IMAGE_PREFIX)) {
			return true
		}
	}
	return false
}

function isMarkdownFile(file: TAbstractFile): boolean {
	if (file instanceof TFile) {
		if (file.extension.toLowerCase() === 'md') {
			return true
		}
	}
	return false
}

class ImageRenameModal extends Modal {
	src: TFile
	stem: string
	hasRemaining: boolean
	attachmentTypes: AttachmentTypeConfig
	finish: (choice: ModalChoice) => void
	onCloseExtra: () => void
	settled = false
	applyToRemaining = false

	constructor(app: App, src: TFile, stem: string, hasRemaining: boolean, attachmentTypes: AttachmentTypeConfig, finish: (choice: ModalChoice) => void, onClose: () => void) {
		super(app)
		this.src = src
		this.stem = stem
		this.hasRemaining = hasRemaining
		this.attachmentTypes = attachmentTypes
		this.finish = finish
		this.onCloseExtra = onClose
	}

	onOpen() {
		this.containerEl.addClass('image-rename-modal')
		const { contentEl, titleEl } = this
		titleEl.setText('Rename attachment')

		if (isImageExtension(this.src.extension, this.attachmentTypes)) {
			const imageContainer = contentEl.createDiv({ cls: 'image-container' })
			imageContainer.createEl('img', { attr: { src: this.app.vault.getResourcePath(this.src) } })
		}

		let stem = this.stem
		const ext = this.src.extension
		const getNewName = (stem: string) => ext ? `${stem}.${ext}` : stem
		const getNewPath = (stem: string) => path.join(this.src.parent.path, getNewName(stem))

		const infoET = createElementTree(contentEl, {
			tag: 'ul',
			cls: 'info',
			children: [
				{
					tag: 'li',
					children: [
						{
							tag: 'span',
							text: 'Origin path',
						},
						{
							tag: 'span',
							text: this.src.path,
						}
					],
				},
				{
					tag: 'li',
					children: [
						{
							tag: 'span',
							text: 'New path',
						},
						{
							tag: 'span',
							text: getNewPath(stem),
						}
					],
				}
			]
		})

		const errorEl = contentEl.createDiv({ cls: 'error', attr: { style: 'display: none;' } })
		const finish = (action: 'rename' | 'cancel') => {
			if (this.settled) return
			if (action === 'rename' && !stem) {
				errorEl.innerText = 'Error: "New name" could not be empty'
				errorEl.style.display = 'block'
				return
			}
			this.settled = true
			this.finish({ action, name: action === 'rename' ? getNewName(stem) : undefined, applyToRemaining: this.applyToRemaining })
			this.close()
		}

		const nameSetting = new Setting(contentEl)
			.setName('New name')
			.setDesc('Input the new attachment name without its extension')
			.addText(text => text
				.setValue(stem)
				.onChange((value) => {
					stem = normalizeFilenameStem(value)
					infoET.children[1].children[1].el.innerText = getNewPath(stem)
				}
				))

		const nameInputEl = nameSetting.controlEl.children[0] as HTMLInputElement
		nameInputEl.focus()
		const nameInputState = lockInputMethodComposition(nameInputEl)
		nameInputEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !nameInputState.lock) {
				e.preventDefault()
				finish('rename')
			}
		})

		if (this.hasRemaining) {
			new Setting(contentEl)
				.setName('Apply to remaining files')
				.addToggle(toggle => toggle.setValue(false).onChange(value => { this.applyToRemaining = value }))
		}

		new Setting(contentEl)
			.addButton(button => button.setButtonText('Rename').onClick(() => finish('rename')))
			.addButton(button => button.setButtonText('Cancel').onClick(() => finish('cancel')))
	}

	onClose() {
		if (!this.settled) {
			this.settled = true
			this.finish({ action: 'cancel', applyToRemaining: this.applyToRemaining })
		}
		this.contentEl.empty()
		this.onCloseExtra()
	}
}

const imageNamePatternDesc = `
The pattern indicates how the new name should be generated.

Available variables:
- {{fileName}}: name of the active file, without ".md" extension.
- {{dirName}}: name of the directory which contains the document (the root directory of vault results in an empty variable).
- {{imageNameKey}}: this variable is read from the markdown file's frontmatter, from the same key "imageNameKey".
- {{DATE:$FORMAT}}: use "$FORMAT" to format the current date, "$FORMAT" must be a Moment.js format string, e.g. {{DATE:YYYY-MM-DD}}.

Here are some examples from pattern to image names (repeat in sequence), variables: fileName = "My note", imageNameKey = "foo":
- {{fileName}}: My note, My note-1, My note-2
- {{imageNameKey}}: foo, foo-1, foo-2
- {{imageNameKey}}-{{DATE:YYYYMMDD}}: foo-20220408, foo-20220408-1, foo-20220408-2
`

class SettingTab extends PluginSettingTab {
	plugin: PasteRenamePlugin;

	constructor(app: App, plugin: PasteRenamePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	async updateAttachmentTypes(field: 'images' | 'attachments', value: string) {
		const candidate = {
			...this.plugin.attachmentTypes,
			[field]: parseAttachmentTypeTextarea(value),
		}
		const result = parseAttachmentTypeConfig(candidate)
		if (result.ok === false) {
			new Notice(`Invalid attachment types: ${result.error}`)
			return
		}
		const revision = applyAttachmentTypeSnapshot(this.plugin.attachmentTypePersistence, result.value)
		this.plugin.attachmentTypes = cloneAttachmentTypeConfig(this.plugin.attachmentTypePersistence.current)
		try {
			await this.plugin.saveAttachmentTypes(this.plugin.attachmentTypes, revision)
		} catch (error) {
			this.plugin.attachmentTypes = cloneAttachmentTypeConfig(this.plugin.attachmentTypePersistence.current)
			new Notice(`Could not save attachment types: ${error}`)
		}
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Image name pattern')
			.setDesc(imageNamePatternDesc)
			.setClass('long-description-setting-item')
			.addText(text => text
				.setPlaceholder('{{imageNameKey}}')
				.setValue(this.plugin.settings.imageNamePattern)
				.onChange(async (value) => {
					this.plugin.settings.imageNamePattern = value;
					await this.plugin.saveSettings();
				}
			));

		new Setting(containerEl)
			.setName('Image output')
			.setDesc('Use centered HTML figures or preserve Obsidian Markdown embeds for configured image types.')
			.addDropdown(dropdown => dropdown
				.addOptions({ html: 'HTML figure', markdown: 'Markdown' })
				.setValue(this.plugin.settings.imageOutput)
				.onChange(async (value: 'html' | 'markdown') => {
					this.plugin.settings.imageOutput = value
					await this.plugin.saveSettings()
				}))

		new Setting(containerEl)
			.setName('Figure width')
			.setDesc('Integer percentage from 1 to 100; invalid values render at 80%.')
			.addText(text => text
				.setValue(String(this.plugin.settings.imageWidth))
				.onChange(async value => {
					const width = Number(value)
					if (Number.isFinite(width)) this.plugin.settings.imageWidth = width
					await this.plugin.saveSettings()
				}))

		new Setting(containerEl)
			.setName('Duplicate number at start (or end)')
			.setDesc(`If enabled, duplicate number will be added at the start as prefix for the image name, otherwise it will be added at the end as suffix for the image name.`)
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.dupNumberAtStart)
				.onChange(async (value) => {
					this.plugin.settings.dupNumberAtStart = value
					await this.plugin.saveSettings()
				}
				))

		new Setting(containerEl)
			.setName('Duplicate number delimiter')
			.setDesc(`The delimiter to generate the number prefix/suffix for duplicated names. For example, if the value is "-", the suffix will be like "-1", "-2", "-3", and the prefix will be like "1-", "2-", "3-". Only characters that are valid in file names are allowed.`)
			.addText(text => text
				.setValue(this.plugin.settings.dupNumberDelimiter)
				.onChange(async (value) => {
					this.plugin.settings.dupNumberDelimiter = sanitizer.delimiter(value);
					await this.plugin.saveSettings();
				}
			));

		new Setting(containerEl)
			.setName('Always add duplicate number')
			.setDesc(`If enabled, duplicate number will always be added to the image name. Otherwise, it will only be added when the name is duplicated.`)
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.dupNumberAlways)
				.onChange(async (value) => {
					this.plugin.settings.dupNumberAlways = value
					await this.plugin.saveSettings()
				}
				))

		new Setting(containerEl)
			.setName('Auto rename')
			.setDesc(`By default, the rename modal will always be shown to confirm before renaming, if this option is set, the image will be auto renamed after pasting.`)
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoRename)
				.onChange(async (value) => {
					this.plugin.settings.autoRename = value;
					await this.plugin.saveSettings();
				}
			));

		new Setting(containerEl)
			.setName('Handle all attachments')
			.setDesc(`Pasted images are handled when their extension is allowlisted. Enable this for other allowlisted attachments.`)
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.handleAllAttachments)
				.onChange(async (value) => {
					this.plugin.settings.handleAllAttachments = value;
					await this.plugin.saveSettings();
				}
			));

		new Setting(containerEl)
			.setName('Exclude extension pattern')
			.setDesc(`This option is only useful when "Handle all attachments" is enabled.
			Write a Regex pattern to exclude certain extensions from being handled. Only the first line will be used.`)
			.setClass('single-line-textarea')
			.addTextArea(text => text
				.setPlaceholder('docx?|xlsx?|pptx?|zip|rar')
				.setValue(this.plugin.settings.excludeExtensionPattern)
				.onChange(async (value) => {
					this.plugin.settings.excludeExtensionPattern = value;
					await this.plugin.saveSettings();
				}
			));

		new Setting(containerEl)
			.setName('Disable rename notice')
			.setDesc(`Turn off this option if you don't want to see the notice when renaming images.
			Note that Obsidian may display a notice when a link has changed, this option cannot disable that.`)
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.disableRenameNotice)
				.onChange(async (value) => {
					this.plugin.settings.disableRenameNotice = value;
					await this.plugin.saveSettings();
				}
			));

		new Setting(containerEl)
			.setName('Image extensions')
			.setDesc('Comma-separated allowlist. Leading dots are optional; entries are lowercased and deduplicated.')
			.addTextArea(text => text
				.setValue(this.plugin.attachmentTypes.images.join(', '))
				.onChange(value => this.updateAttachmentTypes('images', value)))

		new Setting(containerEl)
			.setName('Attachment extensions')
			.setDesc('Comma-separated allowlist for non-image attachments. Unknown extensions remain ignored.')
			.addTextArea(text => text
				.setValue(this.plugin.attachmentTypes.attachments.join(', '))
				.onChange(value => this.updateAttachmentTypes('attachments', value)))

		new Setting(containerEl)
			.setName('Attachment type defaults')
			.setDesc('Reset the editable allowlist and write the checked-in defaults to the plugin configuration file.')
			.addButton(button => button.setButtonText('Reset defaults').onClick(async () => {
				try {
					await this.plugin.resetAttachmentTypes()
					this.display()
				} catch (error) {
					new Notice(`Could not save attachment types: ${error}`)
				}
			}))
	}
}
