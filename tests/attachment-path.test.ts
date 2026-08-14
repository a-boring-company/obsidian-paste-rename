import { describe, expect, it } from 'vitest'

import { attachmentPathCandidates, relativeAttachmentPath, renameInPlace } from '../src/attachment-path'

describe('attachment paths', () => {
	it('provides generated, note-relative, and vault-root path candidates', () => {
		expect(attachmentPathCandidates('notes/topic.md', 'assets/image.png', ['image.png', 'assets/image.png']))
			.toEqual(['image.png', 'assets/image.png', '../assets/image.png', '/assets/image.png'])
		expect(attachmentPathCandidates('notes/topic.md', 'notes/../image.png')).toEqual(['../image.png', 'image.png', '/image.png'])
		expect(attachmentPathCandidates('topic.md', '')).toEqual([])
		expect(() => attachmentPathCandidates('topic.md', '../outside.png')).toThrow('vault')
	})

	it('renames in the existing parent directory only', () => {
		expect(renameInPlace('assets/original.png', 'renamed.png')).toBe('assets/renamed.png')
		expect(renameInPlace('original.png', 'renamed.png')).toBe('renamed.png')
	})

	it('computes a relative attachment path from the source note', () => {
		expect(relativeAttachmentPath('notes/topic.md', 'notes/image.png')).toBe('image.png')
		expect(relativeAttachmentPath('notes/topic.md', 'assets/image.png')).toBe('../assets/image.png')
		expect(relativeAttachmentPath('notes/deep/topic.md', 'notes/image.png')).toBe('../image.png')
		expect(relativeAttachmentPath('topic.md', 'image.png')).toBe('image.png')
		expect(relativeAttachmentPath('', 'image.png')).toBe('image.png')
		expect(relativeAttachmentPath('topic.md', '')).toBe('')
	})

	it('rejects relative paths that escape the vault', () => {
		expect(() => relativeAttachmentPath('../topic.md', 'image.png')).toThrow('vault')
		expect(() => relativeAttachmentPath('topic.md', '../image.png')).toThrow('vault')
	})

	it('rejects a new name that can escape the existing directory', () => {
		expect(() => renameInPlace('assets/original.png', '../renamed.png')).toThrow('filename')
		expect(() => renameInPlace('assets/original.png', 'nested/renamed.png')).toThrow('filename')
	})

})
