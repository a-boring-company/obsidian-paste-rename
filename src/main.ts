import {
	App,
	Editor,
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
import type { CachedMetadata } from 'obsidian'

import { ImageBatchRenameModal } from './batch';
import { BatchEditorSession, advanceBatchEditorBaseline, BatchMetadataLedger, batchCommitEditorState, batchDiskContentAllowed, expectedBatchNativeContent, fullDocumentChange, hasBatchEditorOwnership, liveBatchAttachmentChange, prepareExactSourceSnapshot, replaceBatchAttachmentContent, replaceBatchFigureContent, rollbackBatchSourceWrite } from './batch-content';
import { attachmentTargetPathGroups, extractGeneratedDestination } from './attachment-links';
import { relativeAttachmentPath, renameInPlace } from './attachment-path';
import { AttachmentReferenceState, batchNativeLinkSyncDecision, classifyAttachmentReference, nativeLinkSyncDecision, replaceAttachmentReference } from './attachment-reference';
import { CachedAttachmentGroup, CachedEmbedOccurrence, attachmentTargetDiscovered, cacheEmbedOccurrences, cacheReferenceOccurrences, deriveRetargetDestinations, groupCachedAttachments, mapCachedOccurrencesByTargetPath, retargetCachedOccurrences } from './batch-occurrences';
import { AttachmentTypeUserSource, chooseAttachmentTypeConfig } from './attachment-type-files';
import { applyAttachmentTypeSnapshot, commitAttachmentTypeSnapshot, createAttachmentTypePersistence, reconcileAttachmentTypeFailure } from './attachment-type-state';
import {
	AttachmentTypeConfig,
	cloneAttachmentTypeConfig,
	DEFAULT_ATTACHMENT_TYPE_CONFIG,
	isEligibleAttachmentExtension,
	isImageExtension,
	parseAttachmentTypeConfig,
	parseAttachmentTypeTextarea,
} from './attachment-types';
import { cancelBurst, createBurstCancellation, CreateBurstDecision, ExactBurstMutationStatus, ExactBurstPreparation, isBurstCancelled, orchestrateCreateBurst, summarizeExactSourcePreparationFailure } from './burst';
import { isEligibleAttachmentCreate } from './create-eligibility';
import { BOUNDED_SEARCH_RADIUS, LineEdit, mapCursorAfterLineEdit, replaceNearCursorInText } from './embed-location';
import { renderFigure } from './figure';
import { normalizeFilenameStem } from './filename';
import { markdownDocumentContextBefore } from './markdown-context';
import { extractGeneratedFigurePaths } from './figure-document';
import { retryBounded } from './retry';
import { resolveImageOutput } from './settings-compat';
import { renderTemplate } from './template';
import { compareAndWriteVaultText, processVaultText } from './vault-text';
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
const FIGURE_RETRY_COUNT = 5
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

interface RenameFileResult {
	success: boolean
	edit: LineEdit | null
}

type BatchEditorReadiness = { ready: true } | { detached: true }

interface BatchSourceSnapshot {
	content: string
	embeds: CachedEmbedOccurrence[]
	references: CachedEmbedOccurrence[]
}

type BatchSourcePreparationFailure = 'capture' | 'read' | 'synchronize' | 'rollback' | 'cancelled'

interface BatchSourcePreparationResult {
	snapshot: BatchSourceSnapshot | null
	failure: BatchSourcePreparationFailure | null
}

interface ExactRenameBurstContext {
	sourceFile: TFile
	editorSession: BatchEditorSession<Editor, MarkdownView>
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
	metadataLedger = new BatchMetadataLedger()

	async onload() {
		const generation = this.cancellation.generation
		this.registerEvent(this.app.metadataCache.on('changed', (file, data, cache) => {
			this.metadataLedger.record(file.path, data, cache)
		}))
		this.registerEvent(this.app.vault.on('modify', file => this.metadataLedger.invalidate(file.path)))
		this.registerEvent(this.app.vault.on('delete', file => this.metadataLedger.invalidate(file.path)))
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.metadataLedger.invalidateRename(oldPath, file.path)))
		console.log(`Plugin loading: ${this.manifest.name} ${this.manifest.version} BUILD_ENV=${process.env.BUILD_ENV}`)
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
			void this.batchRenameAllImages().catch(error => {
				console.error('Could not batch rename images', error)
				new Notice('Could not batch rename images')
			})
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
		const taskById = new Map(tasks.map(task => [task.id, task]))
		await orchestrateCreateBurst(tasks, {
			prepareExact: () => this.prepareExactRenameBurst(tasks, generation),
			choose: (task, hasRemaining) => this.openRenameModal(task, hasRemaining, generation),
			applyBounded: (task, decision, notify) => this.applyRenameDecision(task, decision, taskById, generation, notify),
			refreshOccurrences: async (context, task) => {
				const prepared = await this.prepareBatchSourceExact(context.sourceFile, context.editorSession, generation)
				if (!prepared.snapshot || !this.isCurrent(generation)) return null
				return mapCachedOccurrencesByTargetPath(
					prepared.snapshot.references,
					[task.file.path],
					link => this.app.metadataCache.getFirstLinkpathDest(link, context.sourceFile.path),
				).get(task.file.path) ?? null
			},
			applyExact: (context, task, occurrences, decision, notify) => {
				if (decision.action === 'rename') return this.renameBatchAttachmentOutcome(
					task.file,
					decision.name,
					context.sourceFile,
					context.editorSession,
					generation,
					notify,
				)
				if (this.settings.imageOutput !== 'html' || !isImageExtension(task.file.extension, this.attachmentTypes)) return true
				return this.convertBatchAttachmentToFigure({ ...task, occurrences }, context.sourceFile, context.editorSession, generation)
			},
			isCurrent: () => this.isCurrent(generation),
			notify: message => { new Notice(message) },
		})
	}

	async prepareExactRenameBurst(tasks: RenameTask[], generation: number): Promise<ExactBurstPreparation<ExactRenameBurstContext>> {
		const sourcePath = tasks[0]?.sourcePath
		if (!sourcePath || tasks.some(task => task.sourcePath !== sourcePath || task.sourceFile.path !== sourcePath)) {
			return { failure: `Skipped ${tasks.length} attachments because their active note changed` }
		}
		const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath)
		if (!(sourceFile instanceof TFile)) {
			return { failure: `Skipped ${tasks.length} attachments because the active note is unavailable` }
		}
		const editorSession = this.getBatchEditorSession(sourceFile)
		if (!editorSession) {
			return { failure: `Skipped ${tasks.length} attachments because the active note editor is unavailable` }
		}
		const prepared = await this.prepareBatchSourceExact(sourceFile, editorSession, generation)
		if (!prepared.snapshot || !this.isCurrent(generation)) {
			return { failure: summarizeExactSourcePreparationFailure(tasks.length, prepared.failure ?? 'synchronize') }
		}
		return {
			context: { sourceFile, editorSession },
			occurrencesByPath: mapCachedOccurrencesByTargetPath(
				prepared.snapshot.references,
				tasks.map(task => task.file.path),
				link => this.app.metadataCache.getFirstLinkpathDest(link, sourceFile.path),
			),
		}
	}

	async convertBatchAttachmentToFigure(
		task: RenameTask & { occurrences: readonly CachedEmbedOccurrence[] },
		sourceFile: TFile,
		editorSession: BatchEditorSession<Editor, MarkdownView>,
		generation: number,
	): Promise<boolean> {
		if (!this.isCurrent(generation) || !this.isBatchEditorSessionBound(editorSession, sourceFile)) return false
		const capturedContent = editorSession.editor.getValue()
		const replacement = renderFigure({ src: task.file.path, stem: task.file.basename, width: this.settings.imageWidth })
		const nextContent = replaceBatchFigureContent(capturedContent, replacement, task.file.path, task.occurrences)
		if (nextContent === null) return false
		const change = fullDocumentChange(capturedContent, nextContent)
		if (!change) return true
		let writeResult: 'written' | 'conflict' | 'cancelled'
		try {
			writeResult = await compareAndWriteVaultText(
				this.app.vault,
				sourceFile,
				content => content === editorSession.baselineContent || content === capturedContent,
				() => this.isCurrent(generation) && this.isBatchEditorSessionBound(editorSession, sourceFile),
				nextContent,
				() => {
					if (!this.isCurrent(generation)
						|| !this.isBatchEditorSessionBound(editorSession, sourceFile)
						|| editorSession.editor.getValue() !== capturedContent) return false
					editorSession.editor.transaction({ changes: [change] })
					return true
				},
			)
		} catch (error) {
			if (this.isCurrent(generation)) {
				console.error('Could not save synchronized attachment figures', error)
			}
			return false
		}
		if (writeResult !== 'written') {
			return false
		}
		return advanceBatchEditorBaseline(editorSession, sourceFile.path, nextContent, editorSession.view.file?.path, editorSession.view.editor)
	}

	async applyRenameDecision(
		task: RenameTask,
		decision: CreateBurstDecision,
		taskById: Map<string, RenameTask>,
		generation = this.cancellation.generation,
		notify = true,
	) {
		if (!this.isCurrent(generation)) return
		if (decision.action === 'rename') {
			const result = await this.renameFile(task.file, decision.name, task.sourcePath, true, task.cursor, generation, notify)
			if (result.success && result.edit && this.isCurrent(generation)) this.updateTaskCursors(taskById, result.edit)
		} else if (this.settings.imageOutput === 'html' && isImageExtension(task.file.extension, this.attachmentTypes)) {
			const result = await this.replaceAttachmentReference(task.file, task.sourcePath, task.file.path, task.cursor, generation)
			if (result.edit && this.isCurrent(generation)) this.updateTaskCursors(taskById, result.edit)
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
		notify = true,
	): Promise<RenameFileResult> {
		const originPath = file.path
		const suffix = file.extension ? `.${file.extension}` : ''
		const rawStem = suffix && inputNewName.endsWith(suffix) ? inputNewName.slice(0, -suffix.length) : inputNewName
		const normalizedStem = normalizeFilenameStem(rawStem)
		if (!normalizedStem) {
			if (notify && this.isCurrent(generation)) new Notice('Failed to rename attachment: new name is empty')
			return { success: false, edit: null }
		}
		const normalizedName = suffix ? `${normalizedStem}${suffix}` : normalizedStem
		const originName = file.name
		const noOp = originName === normalizedName
		// deduplicate name
		const { name: newName } = noOp ? { name: normalizedName } : await this.deduplicateNewName(normalizedName, file)
		if (!this.isCurrent(generation)) return { success: false, edit: null }
		debugLog('deduplicated newName:', newName)
		const oldLinkText = this.app.fileManager.generateMarkdownLink(file, sourcePath)
		// File system operation: rename the file in its current parent directory.
		const newPath = renameInPlace(originPath, newName)
		if (!noOp) {
			try {
				if (!this.isCurrent(generation)) return { success: false, edit: null }
				await this.app.fileManager.renameFile(file, newPath)
			} catch (err) {
				if (notify && this.isCurrent(generation)) new Notice(`Failed to rename ${newName}: ${err}`)
				return { success: false, edit: null }
			}
		}
		if (!this.isCurrent(generation)) return { success: false, edit: null }

		if (!replaceCurrentLine) {
			return { success: true, edit: null }
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
		const diskState = await this.nativeDiskReferenceState(sourcePath, cursor, targetGroups, isImageExtension(file.extension, this.attachmentTypes), generation)
		if (!this.isCurrent(generation)) return { success: false, edit: null }
		const result = await this.replaceAttachmentReference(file, sourcePath, originPath, cursor, generation, targetGroups, newLinkText, diskState)
		if (!this.isCurrent(generation)) return { success: false, edit: null }

		if (notify && !this.settings.disableRenameNotice) {
			new Notice(`Renamed ${originName} to ${newName}`)
		}
		return { success: true, edit: result.edit }
	}

	referenceStateNearEditor(
		cursor: EditorPosition,
		lineCount: number,
		getLine: (line: number) => string,
		targetGroups: { old: readonly string[]; current: readonly string[] },
		image: boolean,
	): AttachmentReferenceState {
		let state: AttachmentReferenceState = 'none'
		replaceNearCursorInText(
			cursor,
			lineCount,
			(content, contentCursor) => {
				state = classifyAttachmentReference({
					content,
					cursor: contentCursor,
					targetPaths: targetGroups.old,
					currentTargetPaths: targetGroups.current,
					image,
				})
				return null
			},
			getLine,
		)
		return state
	}

	async nativeDiskReferenceState(
		sourcePath: string,
		cursor: EditorPosition,
		targetGroups: { old: readonly string[]; current: readonly string[] },
		image: boolean,
		generation: number,
	): Promise<AttachmentReferenceState | null> {
		const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath)
		if (!(sourceFile instanceof TFile)) return null
		let content: string
		try {
			content = await this.app.vault.read(sourceFile)
		} catch {
			return null
		}
		if (!this.isCurrent(generation)) return null
		const lines = content.split(/\r?\n/)
		return this.referenceStateNearEditor(cursor, lines.length, line => lines[line], targetGroups, image)
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
		nativeLinkSyncState: AttachmentReferenceState | null = 'old',
	): Promise<ReferenceReplacement> {
		if (!this.isCurrent(generation)) return { matched: false, edit: null }
		const currentPath = relativeAttachmentPath(sourcePath, file.path)
		const targetPaths = targetGroups.old
		const image = isImageExtension(file.extension, this.attachmentTypes)
		const asFigure = image && this.settings.imageOutput === 'html'
		const desiredLinkText = image && !newLinkText.startsWith('!') ? `!${newLinkText}` : newLinkText
		const replacementPath = extractGeneratedDestination(newLinkText) ?? currentPath
		const replacement = asFigure
			? renderFigure({ src: currentPath, stem: file.basename, width: this.settings.imageWidth })
			: desiredLinkText
		const figureImageLine = asFigure ? replacement.split('\n')[1] : ''
		const result = await retryBounded(FIGURE_RETRY_COUNT, async attempt => {
			if (!this.isCurrent(generation)) return null
			const liveEditor = this.getActiveEditor()
			if (!liveEditor || this.getActiveFile()?.path !== sourcePath) return null
			const lineCount = liveEditor.lineCount()
			if (nativeLinkSyncState !== 'old') {
				const editorState = this.referenceStateNearEditor(
					cursor,
					lineCount,
					line => liveEditor.getLine(line),
					targetGroups,
					image,
				)
				if (nativeLinkSyncDecision(nativeLinkSyncState, editorState) !== 'proceed') {
					if (attempt + 1 < FIGURE_RETRY_COUNT) {
						await new Promise(resolve => window.setTimeout(resolve, FIGURE_RETRY_DELAY_MS))
					}
					return null
				}
			}
			const anchorLine = Math.max(0, Math.min(cursor.line, lineCount - 1))
			const firstLine = Math.max(0, anchorLine - BOUNDED_SEARCH_RADIUS)
			const sliceStartLine = firstLine > 0 ? firstLine - 1 : 0
			const initialContext = markdownDocumentContextBefore(Array.from({ length: sliceStartLine }, (_, line) => liveEditor.getLine(line)))
			const edit = replaceNearCursorInText(
				cursor,
				lineCount,
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
					initialContext,
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
		const editorSession = this.getBatchEditorSession(activeFile)
		if (!editorSession) {
			new Notice('Could not capture the active note editor')
			return
		}
		const generation = this.cancellation.generation
		const modal = new ImageBatchRenameModal(
			this.app,
			() => this.scanBatchAttachments(activeFile, editorSession, generation),
			async (file: TFile, name: string) => {
				return this.renameBatchAttachment(file, name, activeFile, editorSession, generation)
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
		const editorSession = this.getBatchEditorSession(activeFile)
		if (!editorSession) {
			new Notice('Could not capture the active note editor')
			return
		}
		const generation = this.cancellation.generation
		const groups = await this.scanBatchAttachments(activeFile, editorSession, generation)
		if (!this.isCurrent(generation) || !groups) return
		for (const group of groups) {
			if (!this.isCurrent(generation)) return
			const file = group.file
			if (!isImageExtension(file.extension, this.attachmentTypes)) return

			// rename
			const { newName, isMeaningful }= this.generateNewName(file, activeFile)
			debugLog('generated newName:', newName, isMeaningful)
			if (!isMeaningful) {
				if (!this.isCurrent(generation)) return
				new Notice('Failed to batch rename images: the generated name is not meaningful')
				break;
			}

			if (!await this.renameBatchAttachment(file, newName, activeFile, editorSession, generation)) return
		}
	}

	async prepareBatchSource(
		sourceFile: TFile,
		session: BatchEditorSession<Editor, MarkdownView>,
		generation: number,
		notify = true,
	): Promise<BatchSourceSnapshot | null> {
		const prepared = await this.prepareBatchSourceExact(sourceFile, session, generation)
		if (prepared.snapshot || !this.isCurrent(generation)) return prepared.snapshot
		if (notify && prepared.failure === 'capture') new Notice('Could not capture the active note editor')
		else if (notify && prepared.failure === 'read') new Notice('Could not read the active note before batch rename')
		else if (notify && (prepared.failure === 'synchronize' || prepared.failure === 'rollback')) new Notice('Could not synchronize the active note before batch rename')
		return null
	}

	async prepareBatchSourceExact(
		sourceFile: TFile,
		session: BatchEditorSession<Editor, MarkdownView>,
		generation: number,
	): Promise<BatchSourcePreparationResult> {
		if (!this.isBatchEditorSessionBound(session, sourceFile)) return { snapshot: null, failure: 'capture' }
		if (!this.isCurrent(generation)) return { snapshot: null, failure: 'cancelled' }
		const snapshot = session.editor.getValue()
		const baselineContent = session.baselineContent
		let disk: string
		try {
			disk = await this.app.vault.read(sourceFile)
		} catch (error) {
			console.error('Could not read active note before batch rename', error)
			return { snapshot: null, failure: 'read' }
		}
		if (!this.isCurrent(generation) || !this.isBatchEditorSessionBound(session, sourceFile)) return { snapshot: null, failure: 'cancelled' }
		const snapshotFromCache = (cache: CachedMetadata): BatchSourceSnapshot => {
			const embeds = cacheEmbedOccurrences(snapshot, cache.embeds ?? [])
			const references = cacheReferenceOccurrences(snapshot, [...(cache.embeds ?? []), ...(cache.links ?? [])])
			return { content: snapshot, embeds, references }
		}
		const prepared = await prepareExactSourceSnapshot({
			snapshot,
			disk,
			isCurrent: () => this.isCurrent(generation) && this.isBatchEditorSessionBound(session, sourceFile),
			writeSnapshot: () => compareAndWriteVaultText(
				this.app.vault,
				sourceFile,
				content => content === baselineContent || content === snapshot,
				() => this.isCurrent(generation) && this.isBatchEditorSessionBound(session, sourceFile),
				snapshot,
			),
			readExactCache: () => this.metadataLedger.exact(sourceFile.path, snapshot),
			readDisk: () => this.app.vault.read(sourceFile),
			rollbackSnapshot: () => rollbackBatchSourceWrite(this.app.vault, sourceFile, snapshot, disk),
			advanceBaseline: () => advanceBatchEditorBaseline(session, sourceFile.path, snapshot, session.view.file?.path, session.view.editor),
			retries: FIGURE_RETRY_COUNT,
			wait: () => new Promise(resolve => window.setTimeout(resolve, FIGURE_RETRY_DELAY_MS)),
		})
		if (!prepared.value) {
			if (prepared.failure === 'synchronize') console.error('Could not synchronize active note before batch rename')
			return { snapshot: null, failure: prepared.failure }
		}
		return { snapshot: snapshotFromCache(prepared.value), failure: null }
	}

	async scanBatchAttachments(
		sourceFile: TFile,
		session: BatchEditorSession<Editor, MarkdownView>,
		generation: number,
	): Promise<CachedAttachmentGroup<TFile>[] | null> {
		const prepared = await this.prepareBatchSource(sourceFile, session, generation)
		if (!prepared || !this.isCurrent(generation)) return null
		const groups = groupCachedAttachments<TFile>(
			prepared.content,
			prepared.embeds,
			link => this.app.metadataCache.getFirstLinkpathDest(link, sourceFile.path),
		).filter(group => isEligibleAttachmentExtension(group.file.extension, this.attachmentTypes))
		const grouped = new Map(groups.map(group => [group.file.path, group]))
		for (const link of extractGeneratedFigurePaths(prepared.content)) {
			const file = this.app.metadataCache.getFirstLinkpathDest(link, sourceFile.path)
			if (file && isEligibleAttachmentExtension(file.extension, this.attachmentTypes) && !grouped.has(file.path)) grouped.set(file.path, { file })
		}
		return [...grouped.values()]
	}

	async renameBatchAttachmentOutcome(
		file: TFile,
		newName: string,
		sourceFile: TFile,
		editorSession: BatchEditorSession<Editor, MarkdownView>,
		generation = this.cancellation.generation,
		notify = true,
	): Promise<ExactBurstMutationStatus> {
		const prepared = await this.prepareBatchSource(sourceFile, editorSession, generation, notify)
		if (!prepared || !this.isCurrent(generation)) return 'not-applied'
		const freshGroups = groupCachedAttachments<TFile>(
			prepared.content,
			prepared.embeds,
			link => this.app.metadataCache.getFirstLinkpathDest(link, sourceFile.path),
		).filter(group => isEligibleAttachmentExtension(group.file.extension, this.attachmentTypes))
		const generatedPaths = extractGeneratedFigurePaths(prepared.content).filter(link => {
			const generatedFile = this.app.metadataCache.getFirstLinkpathDest(link, sourceFile.path)
			return generatedFile !== null && isEligibleAttachmentExtension(generatedFile.extension, this.attachmentTypes)
		})
		if (!attachmentTargetDiscovered(
			freshGroups,
			generatedPaths,
			file.path,
			link => this.app.metadataCache.getFirstLinkpathDest(link, sourceFile.path),
		)) {
			if (notify && this.isCurrent(generation)) new Notice(`Could not revalidate ${file.name} in the active note`)
			return 'not-applied'
		}
		const oldOccurrences = prepared.references.filter(occurrence =>
			this.app.metadataCache.getFirstLinkpathDest(occurrence.link, sourceFile.path)?.path === file.path)
		const oldPath = file.path
		const oldStem = file.basename
		const renameResult = await this.renameFile(file, newName, sourceFile.path, false, undefined, generation, notify)
		if (!renameResult.success) return file.path === oldPath ? 'not-applied' : 'renamed-but-unsynchronized'
		if (!this.isCurrent(generation)) return 'renamed-but-unsynchronized'
		if (file.path === oldPath) return 'success'
		if (!this.isCurrent(generation)) return 'renamed-but-unsynchronized'
		const oldRelativePath = relativeAttachmentPath(sourceFile.path, oldPath)
		const newRelativePath = relativeAttachmentPath(sourceFile.path, file.path)
		const newLinkText = this.app.fileManager.generateMarkdownLink(file, sourceFile.path)
		const wikiDestination = this.app.metadataCache.fileToLinktext(file, sourceFile.path, false)
		const markdownFallback = wikiDestination === file.name || wikiDestination === file.basename
			? file.name
			: relativeAttachmentPath(sourceFile.path, file.path)
		const currentOccurrences = retargetCachedOccurrences(oldOccurrences, deriveRetargetDestinations(wikiDestination, newLinkText, markdownFallback))
		const expectedNativeContent = expectedBatchNativeContent(prepared.content, oldOccurrences, currentOccurrences)
		const readiness = await this.waitForBatchEditorContent(editorSession, sourceFile, prepared.content, expectedNativeContent, oldOccurrences.length > 0, generation)
		if (!this.isCurrent(generation)) return 'renamed-but-unsynchronized'
		if (readiness === null) {
			if (notify && this.isCurrent(generation)) new Notice(`Renamed ${file.name}, but references could not be synchronized`)
			return 'renamed-but-unsynchronized'
		}
		if ('detached' in readiness) {
			if (!this.isCurrent(generation)) return 'renamed-but-unsynchronized'
			let contentRejected = false
			let processResult: 'written' | 'cancelled'
			try {
				processResult = await processVaultText(this.app.vault, sourceFile, content => {
					if (!batchDiskContentAllowed(content, prepared.content, expectedNativeContent)) {
						contentRejected = true
						return content
					}
					return replaceBatchAttachmentContent(
						content,
						oldRelativePath,
						newRelativePath,
						oldStem,
						file.basename,
						oldOccurrences,
						currentOccurrences,
					)
				}, () => this.isCurrent(generation))
			} catch (error) {
				if (this.isCurrent(generation)) {
					console.error('Could not save synchronized attachment references', error)
					if (notify) new Notice(`Renamed ${file.name}, but references could not be synchronized`)
				}
				return 'renamed-but-unsynchronized'
			}
			if (processResult === 'cancelled') return 'renamed-but-unsynchronized'
			if (contentRejected) {
				if (notify && this.isCurrent(generation)) new Notice(`Renamed ${file.name}, but references could not be synchronized`)
				return 'renamed-but-unsynchronized'
			}
			return this.isCurrent(generation) ? 'success' : 'renamed-but-unsynchronized'
		}
		if (!this.isCurrent(generation) || !this.isBatchEditorSessionBound(editorSession, sourceFile)) return 'renamed-but-unsynchronized'
		const capturedContent = editorSession.editor.getValue()
		if (capturedContent !== prepared.content && capturedContent !== expectedNativeContent) {
			if (notify && this.isCurrent(generation)) new Notice(`Renamed ${file.name}, but references could not be synchronized`)
			return 'renamed-but-unsynchronized'
		}
		const capturedNextContent = replaceBatchAttachmentContent(
			capturedContent,
			oldRelativePath,
			newRelativePath,
			oldStem,
			file.basename,
			oldOccurrences,
			currentOccurrences,
		)
		const capturedChange = liveBatchAttachmentChange(
			capturedContent,
			oldRelativePath,
			newRelativePath,
			oldStem,
			file.basename,
			oldOccurrences,
			currentOccurrences,
		)
		let writeResult: 'written' | 'conflict' | 'cancelled'
		try {
			writeResult = await compareAndWriteVaultText(
				this.app.vault,
				sourceFile,
				content => this.isCurrent(generation)
					&& this.isBatchEditorSessionBound(editorSession, sourceFile)
					&& editorSession.editor.getValue() === capturedContent
					&& batchDiskContentAllowed(content, prepared.content, expectedNativeContent),
				() => this.isCurrent(generation) && this.isBatchEditorSessionBound(editorSession, sourceFile),
				capturedNextContent,
				() => {
					if (!this.isCurrent(generation)
						|| !this.isBatchEditorSessionBound(editorSession, sourceFile)
						|| editorSession.editor.getValue() !== capturedContent) return false
					if (capturedChange) editorSession.editor.transaction({ changes: [capturedChange] })
					return true
				},
			)
		} catch (error) {
			if (this.isCurrent(generation)) {
				console.error('Could not save synchronized attachment references', error)
				if (notify) new Notice(`Renamed ${file.name}, but references could not be synchronized`)
			}
			return 'renamed-but-unsynchronized'
		}
		if (writeResult === 'cancelled') return 'renamed-but-unsynchronized'
		if (writeResult === 'conflict') {
			if (notify && this.isCurrent(generation)) new Notice(`Renamed ${file.name}, but references could not be synchronized`)
			return 'renamed-but-unsynchronized'
		}
		if (!this.isBatchEditorSessionBound(editorSession, sourceFile)) return 'renamed-but-unsynchronized'
		const latestContent = editorSession.editor.getValue()
		const commitState = batchCommitEditorState(capturedContent, capturedNextContent, latestContent)
		if (commitState === 'drifted') {
			if (notify && this.isCurrent(generation)) new Notice(`Renamed ${file.name}, but references could not be synchronized`)
			return 'renamed-but-unsynchronized'
		}
		if (commitState === 'captured') {
			if (capturedChange) editorSession.editor.transaction({ changes: [capturedChange] })
		}
		return advanceBatchEditorBaseline(editorSession, sourceFile.path, capturedNextContent, editorSession.view.file?.path, editorSession.view.editor)
			? 'success'
			: 'renamed-but-unsynchronized'
	}

	async renameBatchAttachment(
		file: TFile,
		newName: string,
		sourceFile: TFile,
		editorSession: BatchEditorSession<Editor, MarkdownView>,
		generation = this.cancellation.generation,
	): Promise<boolean> {
		return (await this.renameBatchAttachmentOutcome(file, newName, sourceFile, editorSession, generation, true)) === 'success'
	}

	async waitForBatchEditorContent(
		session: BatchEditorSession<Editor, MarkdownView>,
		sourceFile: TFile,
		baselineContent: string,
		expectedNativeContent: string,
		hasReferences: boolean,
		generation: number,
	): Promise<BatchEditorReadiness | null> {
		const ready = await retryBounded(FIGURE_RETRY_COUNT, async attempt => {
			if (!this.isCurrent(generation)) return null
			if (!this.isBatchEditorSessionBound(session, sourceFile)) return { detached: true as const }
			let diskContent: string
			try {
				diskContent = await this.app.vault.read(sourceFile)
			} catch {
				return null
			}
			if (!batchDiskContentAllowed(diskContent, baselineContent, expectedNativeContent)) return null
			if (!this.isCurrent(generation)) return null
			if (!this.isBatchEditorSessionBound(session, sourceFile)) return { detached: true as const }
			const editorContent = session.editor.getValue()
			const diskState = diskContent === baselineContent ? 'old' : diskContent === expectedNativeContent ? 'current' : null
			const editorState = editorContent === baselineContent ? 'old' : editorContent === expectedNativeContent ? 'current' : 'none'
			if (!hasReferences || batchNativeLinkSyncDecision(diskState, editorState, attempt + 1 === FIGURE_RETRY_COUNT) === 'proceed') return { ready: true as const }
			if (attempt + 1 < FIGURE_RETRY_COUNT) {
				await new Promise(resolve => window.setTimeout(resolve, FIGURE_RETRY_DELAY_MS))
				if (!this.isCurrent(generation)) return null
			}
			return null
		}, () => !this.isCurrent(generation))
		return ready
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
	getBatchEditorSession(file: TFile): BatchEditorSession<Editor, MarkdownView> | null {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView)
		return view?.file?.path === file.path ? { filePath: file.path, editor: view.editor, view, baselineContent: view.data } : null
	}
	isBatchEditorSessionBound(session: BatchEditorSession<Editor, MarkdownView>, sourceFile: TFile): boolean {
		return hasBatchEditorOwnership(session, sourceFile.path, session.view.file?.path, session.view.editor)
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
		this.metadataLedger.clear()
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

	attachmentTypesDefaultPath(): string {
		return `${this.manifest.dir}/attachment-types.default.json`
	}

	async loadAttachmentTypes(generation = this.cancellation.generation) {
		let user: AttachmentTypeUserSource
		try {
			const exists = await this.app.vault.adapter.exists(this.attachmentTypesPath())
			if (!this.isCurrent(generation)) return
			if (!exists) {
				user = { status: 'missing' }
			} else {
				try {
					user = { status: 'read', text: await this.app.vault.adapter.read(this.attachmentTypesPath()) }
					if (!this.isCurrent(generation)) return
				} catch {
					user = { status: 'unreadable' }
				}
			}
		} catch {
			user = { status: 'unreadable' }
		}
		if (!this.isCurrent(generation)) return

		let shippedText: string | null = null
		if (user.status === 'missing') {
			try {
				shippedText = await this.app.vault.adapter.read(this.attachmentTypesDefaultPath())
			} catch {
				shippedText = null
			}
			if (!this.isCurrent(generation)) return
		}

		const selection = chooseAttachmentTypeConfig(user, shippedText)
		this.attachmentTypes = cloneAttachmentTypeConfig(selection.config)
		this.attachmentTypePersistence.current = cloneAttachmentTypeConfig(this.attachmentTypes)
		commitAttachmentTypeSnapshot(this.attachmentTypePersistence, this.attachmentTypes)
		if (selection.invalidUserFile) {
			new Notice('Invalid attachment types; using defaults without overwriting the file')
			return
		}
		if (selection.unreadableUserFile) {
			new Notice('Could not read attachment types; using defaults without overwriting the file')
			return
		}
		if (selection.createUserFile) {
			try {
				await this.saveAttachmentTypes(this.attachmentTypes)
				if (this.isCurrent(generation)) new Notice('Attachment types file missing; created defaults')
			} catch (error) {
				if (this.isCurrent(generation)) new Notice(`Could not create attachment types: ${error}`)
			}
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
		const stored = await this.loadData()
		this.settings = Object.assign({}, DEFAULT_SETTINGS, stored)
		this.settings.imageOutput = resolveImageOutput(stored, DEFAULT_SETTINGS.imageOutput)
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

	async updateSetting<K extends keyof PluginSettings>(field: K, value: PluginSettings[K]): Promise<void> {
		this.plugin.settings[field] = value
		await this.plugin.saveSettings()
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
				.onChange(value => this.updateSetting('imageNamePattern', value)
			));

		new Setting(containerEl)
			.setName('Image output')
			.setDesc('Use centered HTML figures or preserve Obsidian Markdown embeds for configured image types.')
			.addDropdown(dropdown => dropdown
				.addOptions({ html: 'HTML figure', markdown: 'Markdown' })
				.setValue(this.plugin.settings.imageOutput)
				.onChange((value: 'html' | 'markdown') => this.updateSetting('imageOutput', value)))

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
				.onChange(value => this.updateSetting('dupNumberAtStart', value)))

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
				.onChange(value => this.updateSetting('dupNumberAlways', value)))

		new Setting(containerEl)
			.setName('Auto rename')
			.setDesc(`By default, the rename modal will always be shown to confirm before renaming, if this option is set, the image will be auto renamed after pasting.`)
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoRename)
				.onChange(value => this.updateSetting('autoRename', value)))

		new Setting(containerEl)
			.setName('Handle all attachments')
			.setDesc(`Pasted images are handled when their extension is allowlisted. Enable this for other allowlisted attachments.`)
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.handleAllAttachments)
				.onChange(value => this.updateSetting('handleAllAttachments', value)))

		new Setting(containerEl)
			.setName('Exclude extension pattern')
			.setDesc(`This option is only useful when "Handle all attachments" is enabled.
			Write a Regex pattern to exclude certain extensions from being handled. Only the first line will be used.`)
			.setClass('single-line-textarea')
			.addTextArea(text => text
				.setPlaceholder('docx?|xlsx?|pptx?|zip|rar')
				.setValue(this.plugin.settings.excludeExtensionPattern)
				.onChange(value => this.updateSetting('excludeExtensionPattern', value)))

		new Setting(containerEl)
			.setName('Disable rename notice')
			.setDesc(`Turn off this option if you don't want to see the notice when renaming images.
			Note that Obsidian may display a notice when a link has changed, this option cannot disable that.`)
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.disableRenameNotice)
				.onChange(value => this.updateSetting('disableRenameNotice', value)))

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
