export const noticeMessages: string[] = []

export class App {}
export class Editor {}
export class EditorPosition {}
export class HeadingCache {}
export class MarkdownView {}
export class FrontMatterCache {}

export class TAbstractFile {}

export class TFile extends TAbstractFile {
	path: string
	parent: { path: string; name: string }
	stat = { ctime: Date.now(), mtime: Date.now(), size: 0 }

	constructor(filePath: string) {
		super()
		this.path = filePath
		this.parent = { path: '', name: '' }
		this.setPath(filePath)
	}

	get name() { return this.path.slice(this.path.lastIndexOf('/') + 1) }
	get extension() { return this.name.includes('.') ? this.name.slice(this.name.lastIndexOf('.') + 1) : '' }
	get basename() { return this.extension ? this.name.slice(0, -(this.extension.length + 1)) : this.name }

	setPath(filePath: string) {
		this.path = filePath
		const parentPath = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : ''
		this.parent = { path: parentPath, name: parentPath.slice(parentPath.lastIndexOf('/') + 1) }
	}
}

export class Plugin {
	app: unknown
	manifest: unknown

	constructor(app: unknown, manifest: unknown) {
		this.app = app
		this.manifest = manifest
	}
}

export class Modal {
	app: unknown

	constructor(app: unknown) { this.app = app }
}

export class PluginSettingTab {
	constructor(_app: unknown, _plugin: unknown) {}
}

export class Setting {}

export class Notice {
	constructor(message: string) { noticeMessages.push(message) }
}
