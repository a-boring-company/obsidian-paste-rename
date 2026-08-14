import { Modal, TFile, App, Notice, Setting } from 'obsidian';

import {
	path, createElementTree, debugLog, lockInputMethodComposition,
} from './utils';
import { normalizeFilenameStem } from './filename';
import { CachedAttachmentGroup } from './batch-occurrences';
import { beginBatchScan, canRenameBatch, createBatchScanState, invalidateBatchScan, isCurrentBatchScan, publishBatchScan, BatchScanState } from './batch-scan-state';

interface State {
	namePattern: string
	extPattern: string
	nameReplace: string
	renameTasks: RenameTask[]
}

interface RenameTask {
	file: TFile
	name: string
}

type scanFuncType = () => Promise<CachedAttachmentGroup<TFile>[] | null>
type renameFuncType = (file: TFile, name: string) => Promise<boolean>

export class ImageBatchRenameModal extends Modal {
	scanFunc: scanFuncType
	renameFunc: renameFuncType
	onCloseExtra: () => void
	state: State
	scanState: BatchScanState = createBatchScanState()
	requestErrorEl: HTMLElement | null = null
	renameAllButtonEl: HTMLButtonElement | null = null

	constructor(app: App, scanFunc: scanFuncType, renameFunc: renameFuncType, onClose: () => void) {
		super(app);
		this.scanFunc = scanFunc
		this.renameFunc = renameFunc
		this.onCloseExtra = onClose

		this.state = {
			namePattern: '',
			extPattern: '',
			nameReplace: '',
			renameTasks: [],
		}
	}

	onOpen() {
		this.containerEl.addClass('image-rename-modal')
		const { contentEl, titleEl } = this;
		titleEl.setText('Batch rename embedded attachments')

		const namePatternSetting = new Setting(contentEl)
			.setName('Name pattern')
			.setDesc('Please input the name pattern to match files (regex)')
			.addText(text => text
				.setValue(this.state.namePattern)
				.onChange(async (value) => {
					this.state.namePattern = value
				}
				))
		const npInputEl = namePatternSetting.controlEl.children[0] as HTMLInputElement
		npInputEl.focus()
		const npInputState = lockInputMethodComposition(npInputEl)
		npInputEl.addEventListener('keydown', async (e) => {
			if (e.key === 'Enter' && !npInputState.lock) {
				e.preventDefault()
				if (!this.state.namePattern) {
					errorEl.innerText = 'Error: "Name pattern" could not be empty'
					errorEl.style.display = 'block'
					return
				}
				void this.matchImageNames(tbodyEl)
			}
		})

		const extPatternSetting = new Setting(contentEl)
			.setName('Extension pattern')
			.setDesc('Please input the extension pattern to match files (regex)')
			.addText(text => text
				.setValue(this.state.extPattern)
				.onChange(async (value) => {
					this.state.extPattern = value
				}
				))
		const extInputEl = extPatternSetting.controlEl.children[0] as HTMLInputElement
		extInputEl.addEventListener('keydown', async (e) => {
			if (e.key === 'Enter') {
				e.preventDefault()
				void this.matchImageNames(tbodyEl)
			}
		})

		const nameReplaceSetting = new Setting(contentEl)
			.setName('Name replace')
			.setDesc('Please input the string to replace the matched name (use $1, $2 for regex groups)')
			.addText(text => text
				.setValue(this.state.nameReplace)
				.onChange(async (value) => {
					this.state.nameReplace = value
				}
				))

		const nrInputEl = nameReplaceSetting.controlEl.children[0] as HTMLInputElement
		const nrInputState = lockInputMethodComposition(nrInputEl)
		nrInputEl.addEventListener('keydown', async (e) => {
			if (e.key === 'Enter' && !nrInputState.lock) {
				e.preventDefault()
				void this.matchImageNames(tbodyEl)
			}
		})


		const matchedContainer = contentEl.createDiv({
			cls: 'matched-container',
		})
		const tableET = createElementTree(matchedContainer, {
			tag: 'table',
			children: [
				{
					tag: 'thead',
					children: [
						{
							tag: 'tr',
							children: [
								{
									tag: 'td',
									text: 'Original path',
								},
								{
									tag: 'td',
									text: 'Renamed Name',
								}
							]
						}
					]
				},
				{
					tag: 'tbody',
				}
			]
		})
		const tbodyEl = tableET.children[1].el

		const errorEl = contentEl.createDiv({
			cls: 'error',
			attr: {
				style: 'display: none;',
			}
		})
		this.requestErrorEl = errorEl

		new Setting(contentEl)
			.addButton(button => {
				this.renameAllButtonEl = button.buttonEl
				button.setDisabled(true)
				button
					.setButtonText('Rename all')
					.setClass('mod-cta')
					.onClick(() => {
						if (!canRenameBatch(this.scanState)) return
						new ConfirmModal(
							this.app,
							'Confirm rename all',
							`Are you sure? This will rename all the ${this.state.renameTasks.length} attachments matched by the pattern.`,
							() => {
								void this.renameAll().catch(error => {
									console.error('Could not rename attachments', error)
									new Notice('Could not rename attachments')
								})
								this.close()
							}
						).open()
					})
			})
			.addButton(button => {
				button
					.setButtonText('Cancel')
					.onClick(() => { this.close() })
			})
	}

	onClose() {
		invalidateBatchScan(this.scanState)
		this.requestErrorEl = null
		this.renameAllButtonEl = null
		const { contentEl } = this;
		contentEl.empty();
		this.onCloseExtra()
	}

	reportMatchError(message: string, error: unknown) {
		console.error(message, error)
		if (this.requestErrorEl) {
			this.requestErrorEl.innerText = message
			this.requestErrorEl.style.display = 'block'
		}
		new Notice(message)
	}

	async renameAll() {
		debugLog('renameAll', this.state)
		for (const task of this.state.renameTasks) {
			if (!await this.renameFunc(task.file, task.name)) break
		}
	}

	async matchImageNames(tbodyEl: HTMLElement) {
		const token = beginBatchScan(this.scanState)
		this.state.renameTasks = []
		tbodyEl.empty()
		if (this.renameAllButtonEl) this.renameAllButtonEl.disabled = true
		if (this.requestErrorEl) {
			this.requestErrorEl.innerText = ''
			this.requestErrorEl.style.display = 'none'
		}
		const state = { ...this.state }
		try {
			const groups = await this.scanFunc()
			if (!isCurrentBatchScan(this.scanState, token) || !groups) return

			const namePatternRegex = new RegExp(state.namePattern, 'g')
			const extPatternRegex = new RegExp(state.extPattern)
			const renameTasks: RenameTask[] = []
			groups.forEach(group => {
				const file = group.file
				// match ext (only if extPattern is not empty)
				if (state.extPattern) {
					const m0 = extPatternRegex.exec(file.extension)
					if (!m0) return
				}

				// match stem
				const stem = file.basename
				namePatternRegex.lastIndex = 0
				const m1 = namePatternRegex.exec(stem)
				if (!m1) return

				let renamedName = file.name
				if (state.nameReplace) {
					namePatternRegex.lastIndex = 0
					renamedName = normalizeFilenameStem(stem.replace(namePatternRegex, state.nameReplace))
					renamedName = `${renamedName}.${file.extension}`
				}
				renameTasks.push({
					file,
					name: renamedName,
				})

				createElementTree(tbodyEl, {
				tag: 'tr',
				children: [
					{
						tag: 'td',
						children: [
							{
								tag: 'span',
								text: file.name,
							},
							{
								tag: 'div',
								text: file.path,
								attr: {
									class: 'file-path',
								}
							}
						]
					},
					{
						tag: 'td',
						children: [
							{
								tag: 'span',
								text: renamedName,
							},
							{
								tag: 'div',
								text: path.join(file.parent.path, renamedName),
								attr: {
									class: 'file-path',
								}
							}
						]
					}
				]

				})
			})

			const published = publishBatchScan(this.scanState, renameTasks.length)
			if (this.renameAllButtonEl) this.renameAllButtonEl.disabled = !published
			if (published) {
				debugLog('new renameTasks', renameTasks)
				this.state.renameTasks = renameTasks
			}
		} catch (error) {
			if (!isCurrentBatchScan(this.scanState, token)) return
			this.state.renameTasks = []
			if (this.renameAllButtonEl) this.renameAllButtonEl.disabled = true
			tbodyEl.empty()
			const message = error instanceof SyntaxError ? 'Invalid rename pattern' : 'Could not read attachments'
			this.reportMatchError(message, error)
		}
	}
}


class ConfirmModal extends Modal {
	title: string
	message: string
	onConfirm: () => void

	constructor(app: App, title: string, message: string, onConfirm: () => void) {
		super(app);
		this.title = title
		this.message = message
		this.onConfirm = onConfirm
	}

	onOpen(): void {
		const { contentEl, titleEl } = this;
		titleEl.setText(this.title)
		contentEl.createEl('p', {
			text: this.message,
		})

		new Setting(contentEl)
			.addButton(button => {
				button
					.setButtonText('Yes')
					.setClass('mod-warning')
					.onClick(() => {
						this.onConfirm()
						this.close()
					})
			})
			.addButton(button => {
				button
					.setButtonText('No')
					.onClick(() => { this.close() })
			})
	}
}
