import { describe, expect, it } from 'vitest'

import { replaceAttachmentReference } from '../src/attachment-reference'

describe('attachment reference replacement', () => {
	it('manually converts an old wikilink to HTML when alwaysUpdateLinks is false', () => {
		const result = replaceAttachmentReference({
			content: 'before ![[old.png]] after', cursor: 18,
			targetPaths: ['old.png', '../assets/old.png', '/assets/old.png', 'new.png'],
			replacement: '<figure>new</figure>', image: true, asFigure: true,
		})
		expect(result?.text).toBe('before \n<figure>new</figure>\n after')
	})

	it('preserves the image marker in Markdown mode when alwaysUpdateLinks is false', () => {
		const result = replaceAttachmentReference({
			content: '![old.png](old.png)', cursor: 10, targetPaths: ['old.png', '../old.png', '/old.png'],
			replacement: '![new.png](new.png)', image: true, asFigure: false,
		})
		expect(result?.text).toBe('![old.png](new.png)')
	})

	it('updates embedded and non-embedded non-image wiki and Markdown references', () => {
		expect(replaceAttachmentReference({
			content: '![[old.pdf|Report]]', cursor: 5, targetPaths: ['old.pdf'],
			replacement: '[[new.pdf|Report]]', replacementPath: 'new.pdf', image: false, asFigure: false,
		})?.text).toBe('![[new.pdf|Report]]')
		expect(replaceAttachmentReference({
			content: '[[old.pdf|Report]]', cursor: 5, targetPaths: ['old.pdf'],
			replacement: '[[new.pdf|Report]]', replacementPath: 'new.pdf', image: false, asFigure: false,
		})?.text).toBe('[[new.pdf|Report]]')
		expect(replaceAttachmentReference({
			content: '![Report](old.pdf "Title")', cursor: 5, targetPaths: ['old.pdf'],
			replacement: '[Report](new.pdf "Title")', replacementPath: 'new.pdf', image: false, asFigure: false,
		})?.text).toBe('![Report](new.pdf "Title")')
		expect(replaceAttachmentReference({
			content: '[Report](old.pdf "Title")', cursor: 5, targetPaths: ['old.pdf'],
			replacement: '[Report](new.pdf "Title")', replacementPath: 'new.pdf', image: false, asFigure: false,
		})?.text).toBe('[Report](new.pdf "Title")')
	})

	it('recognizes current embedded non-image references after rename', () => {
		expect(replaceAttachmentReference({
			content: '![[new.pdf|Report]]', cursor: 5, targetPaths: ['old.pdf'], currentTargetPaths: ['new.pdf'],
			replacement: '[[new.pdf|Report]]', replacementPath: 'new.pdf', image: false, asFigure: false,
		})?.matched).toBe(true)
		expect(replaceAttachmentReference({
			content: '![Report](new.pdf "Title")', cursor: 5, targetPaths: ['old.pdf'], currentTargetPaths: ['new.pdf'],
			replacement: '[Report](new.pdf "Title")', replacementPath: 'new.pdf', image: false, asFigure: false,
		})?.matched).toBe(true)
	})

	it('recognizes an already-updated image reference without changing it', () => {
		const result = replaceAttachmentReference({
			content: '![new.png](new.png)', cursor: 0, targetPaths: ['old.png'], currentTargetPaths: ['new.png'],
			replacement: '![new.png](new.png)', replacementPath: 'new.png',
			image: true, asFigure: false,
		})
		expect(result).toEqual({ text: '![new.png](new.png)', start: 0, end: 19, matched: true })
	})

	it('recognizes an already-updated non-image reference without changing it', () => {
		const result = replaceAttachmentReference({
			content: '[[new.pdf|Report]]', cursor: 0, targetPaths: ['old.pdf'], currentTargetPaths: ['new.pdf'],
			replacement: '[[new.pdf|Report]]', image: false, asFigure: false,
		})
		expect(result?.matched).toBe(true)
	})

	it('falls back to the literal replacement when it is not a generated link', () => {
		const result = replaceAttachmentReference({
			content: '[[old.pdf]]', cursor: 0, targetPaths: ['old.pdf'],
			replacement: '', image: false, asFigure: false,
		})
		expect(result?.text).toBe('[[]]')
	})

	it('treats already-updated Markdown and non-image links as success when alwaysUpdateLinks is true', () => {
		const markdown = replaceAttachmentReference({
			content: '![new.png](new.png)', cursor: 0, targetPaths: ['old.png'], currentTargetPaths: ['new.png'],
			replacement: '![new.png](new.png)', image: true, asFigure: false,
		})
		const attachment = replaceAttachmentReference({
			content: '[[new.pdf]]', cursor: 0, targetPaths: ['old.pdf'], currentTargetPaths: ['new.pdf'],
			replacement: '[[new.pdf]]', image: false, asFigure: false,
		})
		expect(markdown?.matched).toBe(true)
		expect(attachment?.matched).toBe(true)
	})

	it('treats an already converted figure as success', () => {
		const result = replaceAttachmentReference({
			content: '<img src="new.png" alt="new">', cursor: 0, targetPaths: ['new.png'],
			replacement: '<figure>new</figure>', image: true, asFigure: true,
			figureImageLine: '<img src="new.png" alt="new">',
		})
		expect(result).toEqual({ text: '<img src="new.png" alt="new">', start: 0, end: 29, matched: true })
		expect(replaceAttachmentReference({
			content: '![new.png](new.png)', cursor: 0, targetPaths: ['old.png'], currentTargetPaths: ['new.png'],
			replacement: '<figure>new</figure>', image: true, asFigure: true,
		}).text).toBe('<figure>new</figure>')
	})

	it('falls back to exact text only after image-path candidates miss', () => {
		expect(replaceAttachmentReference({
			content: 'plain text', cursor: 0, targetPaths: ['missing.png'],
			replacement: '[[new.png]]', image: true, asFigure: false,
		})).toBeNull()
		expect(replaceAttachmentReference({
			content: 'plain text', cursor: 0, targetPaths: ['missing.png'],
			replacement: '[[new.pdf]]', image: true, asFigure: true,
		})).toBeNull()
	})

	it('replaces only the anchored destination while preserving aliases, labels, and titles', () => {
		expect(replaceAttachmentReference({
			content: '[[old.pdf|Report]] [[new.pdf|Unrelated]]', cursor: 5, targetPaths: ['old.pdf'],
			replacement: 'new.pdf', image: false, asFigure: false,
		})?.text).toBe('[[new.pdf|Report]] [[new.pdf|Unrelated]]')
		expect(replaceAttachmentReference({
			content: '[Report](../assets/old.pdf "Title") [Unrelated](../assets/new.pdf)', cursor: 4,
			targetPaths: ['../assets/old.pdf', 'old.pdf', '/assets/old.pdf'],
			replacement: '../assets/new.pdf', image: false, asFigure: false,
		})?.text).toBe('[Report](../assets/new.pdf "Title") [Unrelated](../assets/new.pdf)')
	})

	it('chooses by full occurrence span across old, current, and figure candidates', () => {
		const old = replaceAttachmentReference({
			content: '![a very long label that contains the cursor](old.png) ![new](new.png)', cursor: 12,
			targetPaths: ['old.png'], currentTargetPaths: ['new.png'], replacement: '![new](new.png)',
			replacementPath: 'new.png', image: true, asFigure: false,
		})
		expect(old?.text).toBe('![a very long label that contains the cursor](new.png) ![new](new.png)')

		const figure = replaceAttachmentReference({
			content: '<img src="new.png" alt="new"> ![[old.png]]', cursor: 40,
			targetPaths: ['old.png'], currentTargetPaths: ['new.png'], replacement: '<figure>old</figure>',
			replacementPath: 'new.png', image: true, asFigure: true, figureImageLine: '<img src="new.png" alt="new">',
		})
		expect(figure?.text).toBe('<img src="new.png" alt="new"> \n<figure>old</figure>')
		const overlapping = replaceAttachmentReference({
			content: '[[new.pdf]]', cursor: 0, targetPaths: ['new.pdf'], currentTargetPaths: ['new.pdf'],
			replacement: 'other.pdf', replacementPath: 'other.pdf', image: false, asFigure: false,
		})
		expect(overlapping?.text).toBe('[[other.pdf]]')
		const second = replaceAttachmentReference({
			content: '[[old.pdf|first]] before [[old.pdf|second]]', cursor: 40, targetPaths: ['old.pdf'],
			replacement: 'new.pdf', image: false, asFigure: false,
		})
		expect(second?.text).toBe('[[old.pdf|first]] before [[new.pdf|second]]')
	})

	it('parses and replaces a multiline title within the bounded content', () => {
		const result = replaceAttachmentReference({
			content: 'before\n![alt](image.png\n"title\nmore")\nafter', cursor: 14,
			targetPaths: ['image.png'], replacement: '![alt](new.png)', replacementPath: 'new.png', image: true, asFigure: false,
		})
		expect(result?.text).toBe('before\n![alt](new.png\n"title\nmore")\nafter')
		expect(result?.start).toBe(14)
		expect(result?.end).toBe(23)
	})

	it('maps a destination-only edit to later same-line cursors', () => {
		const content = '[First](old.png) [Second](old.png)'
		const first = replaceAttachmentReference({
			content, cursor: 5, targetPaths: ['old.png'], replacement: '[First](new-long.png)',
			replacementPath: 'new-long.png', image: false, asFigure: false,
		})
		expect(first?.start).toBe(8)
		expect(first?.end).toBe(15)
		expect(first?.replacementText).toBe('new-long.png')
	})
})
