import { describe, expect, it } from 'vitest'

import {
	BUILTIN_ATTACHMENT_EXTENSIONS,
	BUILTIN_IMAGE_EXTENSIONS,
	DEFAULT_ATTACHMENT_TYPE_CONFIG,
	isEligibleAttachmentExtension,
	parseAttachmentTypeConfig,
	isImageExtension,
	parseAttachmentTypeTextarea,
	cloneAttachmentTypeConfig,
} from '../src/attachment-types'

describe('attachment type configuration', () => {
	it('contains the complete built-in image and attachment sets', () => {
		expect(BUILTIN_IMAGE_EXTENSIONS).toEqual([
			'avif', 'bmp', 'gif', 'heic', 'heif', 'ico', 'jpeg', 'jpg', 'png', 'svg', 'tif', 'tiff', 'webp',
		])
		expect(BUILTIN_ATTACHMENT_EXTENSIONS).toEqual([
			'aac', 'avi', 'bz2', 'csv', 'doc', 'docx', 'epub', 'flac', 'gz', 'key', 'm4a', 'm4v', 'mkv', 'mobi',
			'mov', 'mp3', 'mp4', 'mpeg', 'mpg', 'numbers', 'odp', 'ods', 'odt', 'oga', 'ogg', 'ogv', 'opus',
			'pages', 'pdf', 'ppt', 'pptx', 'rar', 'rtf', 'tar', 'tbz2', 'tgz', 'txt', 'txz', 'wav', 'webm', 'xls',
			'xlsx', 'xz', '7z', 'zip',
		])
		expect(DEFAULT_ATTACHMENT_TYPE_CONFIG).toEqual({
			images: BUILTIN_IMAGE_EXTENSIONS,
			attachments: BUILTIN_ATTACHMENT_EXTENSIONS,
		})
	})

	it('parses and normalises JSON config entries', () => {
		expect(parseAttachmentTypeConfig('{"images":[".PNG", "jpg", "jpg"], "attachments":[" .PDF", ".pdf"]}'))
			.toEqual({ ok: true, value: { images: ['png', 'jpg'], attachments: ['pdf'] } })
	})

	it('reports invalid JSON and classifies image extensions', () => {
		const invalid = parseAttachmentTypeConfig('{')
		if (!('error' in invalid)) throw new Error('expected invalid JSON')
		expect(invalid.error).toContain('valid JSON')
		expect(isImageExtension('PNG')).toBe(true)
		expect(isImageExtension('.pdf')).toBe(false)
		expect(isImageExtension('bad ext')).toBe(false)
	})

	it('rejects malformed config shapes and entries', () => {
		const malformed: unknown[] = [null, [], '{}', '{"images":[],"attachments":null}', {
			images: ['png', 'bad ext'], attachments: [],
		}, { images: ['png', 4], attachments: [] }, { images: [''], attachments: [] }]
		for (const value of malformed) {
			const result = parseAttachmentTypeConfig(value)
			if (!('error' in result)) throw new Error('expected malformed config')
			expect(result.error).toBeTruthy()
		}
	})

	it('keeps unconfigured technical extensions ineligible', () => {
		const result = parseAttachmentTypeConfig({ images: ['png'], attachments: ['pdf'] })
		if (result.ok === false) throw new Error(result.error)
		expect(isEligibleAttachmentExtension('PNG', result.value)).toBe(true)
		expect(isEligibleAttachmentExtension('.pdf', result.value)).toBe(true)
		expect(isEligibleAttachmentExtension('exe', result.value)).toBe(false)
		expect(isEligibleAttachmentExtension('bad ext', result.value)).toBe(false)
	})

	it('parses empty allowlist textareas without empty entries', () => {
		expect(parseAttachmentTypeTextarea(' .PNG, , jpg, ')).toEqual(['.PNG', 'jpg'])
		expect(parseAttachmentTypeTextarea(' ,  ')).toEqual([])
	})

	it('clones allowlist snapshots before queued writes', () => {
		const original = { images: ['png'], attachments: ['pdf'] }
		const copy = cloneAttachmentTypeConfig(original)
		copy.images.push('jpg')
		expect(original.images).toEqual(['png'])
	})

})
