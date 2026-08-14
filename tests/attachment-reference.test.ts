import { describe, expect, it } from 'vitest'

import { classifyAttachmentReference, nativeLinkSyncDecision, replaceAttachmentReference } from '../src/attachment-reference'
import { markdownDocumentContextBefore } from '../src/markdown-context'

describe('attachment reference replacement', () => {
	it('classifies the anchored reference as old, current, or absent', () => {
		expect(classifyAttachmentReference({
			content: '![[old.png]]', cursor: 5, targetPaths: ['old.png'], currentTargetPaths: ['new.png'], image: true,
		})).toBe('old')
		expect(classifyAttachmentReference({
			content: '![[new.png]]', cursor: 5, targetPaths: ['old.png'], currentTargetPaths: ['new.png'], image: true,
		})).toBe('current')
		expect(classifyAttachmentReference({
			content: '![[new.pdf]]', cursor: 5, targetPaths: ['old.pdf'], currentTargetPaths: ['new.pdf'], image: false,
		})).toBe('current')
		expect(classifyAttachmentReference({
			content: 'no matching reference', cursor: 5, targetPaths: ['old.png'], currentTargetPaths: ['new.png'], image: true,
		})).toBe('none')
	})

	it('allows only proven disk states to proceed after native rename', () => {
		expect(nativeLinkSyncDecision('current', 'old')).toBe('wait')
		expect(nativeLinkSyncDecision('current', 'none')).toBe('abort')
		expect(nativeLinkSyncDecision('current', 'current')).toBe('proceed')
		expect(nativeLinkSyncDecision('old', 'old')).toBe('proceed')
		expect(nativeLinkSyncDecision('none', 'old')).toBe('proceed')
		expect(nativeLinkSyncDecision('none', 'current')).toBe('proceed')
		expect(nativeLinkSyncDecision('none', 'none')).toBe('abort')
		expect(nativeLinkSyncDecision(null, 'old')).toBe('abort')
		expect(nativeLinkSyncDecision(null, 'current')).toBe('abort')
	})

	it('allows an unsaved editor old reference when disk has not flushed it', () => {
		const diskState = classifyAttachmentReference({
			content: 'note text without the new embed', cursor: 5, targetPaths: ['old.png'], currentTargetPaths: ['new.png'], image: true,
		})
		const editorState = classifyAttachmentReference({
			content: '![[old.png]]', cursor: 5, targetPaths: ['old.png'], currentTargetPaths: ['new.png'], image: true,
		})
		expect(diskState).toBe('none')
		expect(editorState).toBe('old')
		expect(nativeLinkSyncDecision(diskState, editorState)).toBe('proceed')
		expect(replaceAttachmentReference({
			content: '![[old.png]]', cursor: 5, targetPaths: ['old.png'], currentTargetPaths: ['new.png'],
			replacement: '<figure>new</figure>', replacementPath: 'new.png', image: true, asFigure: true,
		})?.text).toBe('<figure>new</figure>')
	})

	it('manually converts an old wikilink to HTML when alwaysUpdateLinks is false', () => {
		const result = replaceAttachmentReference({
			content: 'before ![[old.png]] after', cursor: 18,
			targetPaths: ['old.png', '../assets/old.png', '/assets/old.png', 'new.png'],
			replacement: '<figure>new</figure>', replacementPath: 'new.png', image: true, asFigure: true,
		})
		expect(result?.text).toBe('before ![[new.png]] after')
	})

	it('keeps Markdown containers while updating only their exact destination', () => {
		const replacement = '<figure>\n<img src="new.png">\n</figure>'
		const replace = (content: string) => replaceAttachmentReference({
			content, cursor: Math.max(0, content.indexOf('old.png')), targetPaths: ['old.png'], replacement,
			replacementPath: 'new.png', image: true, asFigure: true,
		})?.text
		expect(replace('> ![[old.png]]')).toBe('> ![[new.png]]')
		expect(replace('- ![[old.png]]')).toBe('- ![[new.png]]')
		expect(replace('12. ![[old.png]]')).toBe('12. ![[new.png]]')
		expect(replace('> - ![[old.png]]')).toBe('> - ![[new.png]]')
		expect(replace('> > ![[old.png]]')).toBe('> > ![[new.png]]')
		expect(replace('    ![[old.png]]')).toBe('    ![[new.png]]')
		expect(replace('```\n![[old.png]]\n```')).toBe('```\n![[new.png]]\n```')
		expect(replace('- ![Alt](old.png "Title")')).toBe('- ![Alt](new.png "Title")')
		expect(replace('> ![[old.png|Report]]')).toBe('> ![[new.png|Report]]')
		expect(replace('- before ![[old.png|Report]] after')).toBe('- before ![[new.png|Report]] after')
		expect(replaceAttachmentReference({
			content: '- ![[new.png|Report]]', cursor: 8, targetPaths: ['old.png'], currentTargetPaths: ['new.png'],
			replacement, replacementPath: 'new.png', image: true, asFigure: true,
		})?.matched).toBe(true)
		expect(replaceAttachmentReference({
			content: '> ![Alt](new.png "Title")', cursor: 8, targetPaths: ['old.png'], currentTargetPaths: ['new.png'],
			replacement, replacementPath: 'new.png', image: true, asFigure: true,
		})?.matched).toBe(true)
	})

	it('keeps trailing same-line content in the list container', () => {
		const result = replaceAttachmentReference({
			content: '- before ![[old.png]] after', cursor: 12, targetPaths: ['old.png'],
			replacement: '<figure>\n<img src="new.png">\n</figure>', replacementPath: 'new.png', image: true, asFigure: true,
		})
		expect(result?.text).toBe('- before ![[new.png]] after')
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

	it('updates an indented candidate without converting it to HTML', () => {
		const content = '    - ![[old.png]]'
		expect(replaceAttachmentReference({
			content, cursor: content.indexOf('!'), targetPaths: ['old.png'],
			replacement: '<figure>new</figure>', replacementPath: 'new.png', image: true, asFigure: true,
		})?.text).toBe('    - ![[new.png]]')
	})

	it('converts a top-level embed after a closed fence', () => {
		const content = '```\ncode\n```\n![[old.png]]'
		const result = replaceAttachmentReference({
			content, cursor: content.indexOf('old.png'), targetPaths: ['old.png'],
			replacement: '<figure>new</figure>', image: true, asFigure: true,
		})
		expect(result?.text).toBe('```\ncode\n```\n<figure>new</figure>')
	})

	it('keeps frontmatter and multiline comment references as Markdown', () => {
		const replacement = '<figure>new</figure>'
		expect(replaceAttachmentReference({
			content: '---\n![[old.png]]\n---', cursor: 9, targetPaths: ['old.png'], replacement,
			replacementPath: 'new.png', image: true, asFigure: true,
		})?.text).toBe('---\n![[new.png]]\n---')
		expect(replaceAttachmentReference({
			content: '<!--\n![[old.png]]\n-->', cursor: 9, targetPaths: ['old.png'], replacement,
			replacementPath: 'new.png', image: true, asFigure: true,
		})?.text).toBe('<!--\n![[new.png]]\n-->')
		expect(replaceAttachmentReference({
			content: '---\n![[new.png|Report]]\n---', cursor: 9, targetPaths: ['old.png'], currentTargetPaths: ['new.png'], replacement,
			replacementPath: 'new.png', image: true, asFigure: true,
		})?.matched).toBe(true)
		expect(replaceAttachmentReference({
			content: '<!--\n![Alt](new.png "Title")\n-->', cursor: 10, targetPaths: ['old.png'], currentTargetPaths: ['new.png'], replacement,
			replacementPath: 'new.png', image: true, asFigure: true,
		})?.matched).toBe(true)
	})

	it('carries frontmatter and comment context into a bounded slice', () => {
		const replacement = '<figure>new</figure>'
		const frontmatter = markdownDocumentContextBefore(['---', ...Array.from({ length: 8 }, (_, index) => `meta: ${index}`)])
		const comment = markdownDocumentContextBefore(['<!--', ...Array.from({ length: 8 }, (_, index) => `comment ${index}`)])
		expect(replaceAttachmentReference({
			content: '![[old.png]]', cursor: 3, initialContext: frontmatter, targetPaths: ['old.png'], replacement,
			replacementPath: 'new.png', image: true, asFigure: true,
		})?.text).toBe('![[new.png]]')
		expect(replaceAttachmentReference({
			content: '![[new.png|Report]]', cursor: 3, initialContext: comment, targetPaths: ['old.png'], currentTargetPaths: ['new.png'], replacement,
			replacementPath: 'new.png', image: true, asFigure: true,
		})?.matched).toBe(true)
		const fenced = markdownDocumentContextBefore(['```html <!-- -->', ...Array.from({ length: 8 }, (_, index) => `line ${index}`)])
		expect(replaceAttachmentReference({
			content: '![[old.png]]', cursor: 3, initialContext: fenced, targetPaths: ['old.png'], replacement,
			replacementPath: 'new.png', image: true, asFigure: true,
		})?.text).toBe('![[new.png]]')
		expect(replaceAttachmentReference({
			content: '![[new.png|Report]]', cursor: 3, initialContext: fenced, targetPaths: ['old.png'], currentTargetPaths: ['new.png'], replacement,
			replacementPath: 'new.png', image: true, asFigure: true,
		})?.matched).toBe(true)
	})

	it('keeps trailing top-level content below a block figure', () => {
		const result = replaceAttachmentReference({
			content: '![[old.png]] after', cursor: 5, targetPaths: ['old.png'],
			replacement: '<figure>new</figure>', replacementPath: 'new.png', image: true, asFigure: true,
		})
		expect(result?.text).toBe('<figure>new</figure>\n after')
	})

	it('uses the preceding fence state for bounded old and current references', () => {
		const initialContext = markdownDocumentContextBefore(['```html', ...Array.from({ length: 8 }, (_, index) => `line ${index}`)])
		const old = replaceAttachmentReference({
			content: '![[old.png]]', cursor: 3, initialContext, targetPaths: ['old.png'],
			replacement: '<figure>new</figure>', replacementPath: 'new.png', image: true, asFigure: true,
		})
		const current = replaceAttachmentReference({
			content: '![[new.png|Report]]', cursor: 3, initialContext, targetPaths: ['old.png'], currentTargetPaths: ['new.png'],
			replacement: '<figure>new</figure>', replacementPath: 'new.png', image: true, asFigure: true,
		})
		expect(old?.text).toBe('![[new.png]]')
		expect(current).toEqual({ text: '![[new.png|Report]]', start: 0, end: 19, matched: true })
	})

	it('converts a bounded candidate after the preceding fence closes', () => {
		const initialContext = markdownDocumentContextBefore(['```html', ...Array.from({ length: 8 }, (_, index) => `line ${index}`)])
		const result = replaceAttachmentReference({
			content: '```\n![[old.png]]', cursor: 7, initialContext, targetPaths: ['old.png'],
			replacement: '<figure>new</figure>', image: true, asFigure: true,
		})
		expect(result?.text).toBe('```\n<figure>new</figure>')
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
		expect(figure?.text).toBe('<img src="new.png" alt="new"> ![[new.png]]')
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
