export const BUILTIN_IMAGE_EXTENSIONS = [
	'avif', 'bmp', 'gif', 'heic', 'heif', 'ico', 'jpeg', 'jpg', 'png', 'svg', 'tif', 'tiff', 'webp',
] as const

export const BUILTIN_ATTACHMENT_EXTENSIONS = [
	'aac', 'avi', 'bz2', 'csv', 'doc', 'docx', 'epub', 'flac', 'gz', 'key', 'm4a', 'm4v', 'mkv', 'mobi',
	'mov', 'mp3', 'mp4', 'mpeg', 'mpg', 'numbers', 'odp', 'ods', 'odt', 'oga', 'ogg', 'ogv', 'opus',
	'pages', 'pdf', 'ppt', 'pptx', 'rar', 'rtf', 'tar', 'tbz2', 'tgz', 'txt', 'txz', 'wav', 'webm', 'xls',
	'xlsx', 'xz', '7z', 'zip',
] as const

export interface AttachmentTypeConfig {
	images: string[]
	attachments: string[]
}

export const DEFAULT_ATTACHMENT_TYPE_CONFIG: AttachmentTypeConfig = {
	images: [...BUILTIN_IMAGE_EXTENSIONS],
	attachments: [...BUILTIN_ATTACHMENT_EXTENSIONS],
}

export function cloneAttachmentTypeConfig(config: AttachmentTypeConfig): AttachmentTypeConfig {
	return { images: [...config.images], attachments: [...config.attachments] }
}

export type AttachmentTypeConfigResult =
	| { ok: true; value: AttachmentTypeConfig }
	| { ok: false; error: string }

function normaliseExtension(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const extension = value.trim().toLowerCase().replace(/^\.+/, '')
	return /^[a-z0-9]+$/.test(extension) ? extension : null
}

function normaliseExtensionList(value: unknown, field: string): string[] | string {
	if (!Array.isArray(value)) return `${field} must be an array of strings`
	const result: string[] = []
	for (const entry of value) {
		const extension = normaliseExtension(entry)
		if (!extension) return `${field} contains an invalid extension`
		if (!result.includes(extension)) result.push(extension)
	}
	return result
}

export function parseAttachmentTypeConfig(input: unknown): AttachmentTypeConfigResult {
	let value: unknown = input
	if (typeof value === 'string') {
		try {
			value = JSON.parse(value)
		} catch {
			return { ok: false, error: 'Attachment type config is not valid JSON' }
		}
	}
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return { ok: false, error: 'Attachment type config must be an object' }
	}
	const record = value as Record<string, unknown>
	const images = normaliseExtensionList(record.images, 'images')
	if (typeof images === 'string') return { ok: false, error: images }
	const attachments = normaliseExtensionList(record.attachments, 'attachments')
	if (typeof attachments === 'string') return { ok: false, error: attachments }
	return { ok: true, value: { images, attachments } }
}

export function parseAttachmentTypeTextarea(value: string): string[] {
	return value.split(',').map(entry => entry.trim()).filter(Boolean)
}

export function isEligibleAttachmentExtension(
	extension: unknown,
	config: AttachmentTypeConfig = DEFAULT_ATTACHMENT_TYPE_CONFIG,
): boolean {
	const normalised = normaliseExtension(extension)
	if (!normalised) return false
	return config.images.includes(normalised) || config.attachments.includes(normalised)
}

export function isImageExtension(extension: unknown, config: AttachmentTypeConfig = DEFAULT_ATTACHMENT_TYPE_CONFIG): boolean {
	const normalised = normaliseExtension(extension)
	return normalised !== null && config.images.includes(normalised)
}
