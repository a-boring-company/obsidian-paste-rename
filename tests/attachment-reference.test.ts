import { describe, expect, it } from 'vitest'

import { batchNativeLinkSyncDecision, classifyAttachmentReference, nativeLinkSyncDecision, replaceAttachmentReference, replaceCachedAttachmentReferences } from '../src/attachment-reference'
import type { CachedEmbedOccurrence } from '../src/batch-occurrences'
import { markdownDocumentContextBefore } from '../src/markdown-context'

describe('attachment reference replacement', () => {
	const occurrence = (content: string, original: string, link = 'assets/old.png'): CachedEmbedOccurrence => {
		const start = content.indexOf(original)
		return {
			link,
			original,
			start,
			end: start + original.length,
			destinationStart: start + original.indexOf(link),
			destinationEnd: start + original.indexOf(link) + link.length,
		}
	}

	it('rejects stale cached spans instead of searching for another matching reference', () => {
		const content = '![[assets/old.png]]\n![[assets/old.png]]'
		const stale = { ...occurrence(content, '![[assets/old.png]]'), start: 1, end: 1 + '![[assets/old.png]]'.length }
		expect(replaceCachedAttachmentReferences({
			content,
			replacement: '<figure>new</figure>', replacementPath: 'assets/new.png', image: true, asFigure: true,
		}, [stale])).toBeNull()
	})

	it('converts multiple exact top-level references without changing unrelated duplicates', () => {
		const content = [
			'![[assets/old.png]]',
			'![[assets/other.png]]',
			'![[assets/old.png]]',
		].join('\n')
		const first = occurrence(content, '![[assets/old.png]]')
		const secondStart = content.lastIndexOf('![[assets/old.png]]')
		const second = { ...first, start: secondStart, end: secondStart + first.original.length, destinationStart: secondStart + first.destinationStart - first.start, destinationEnd: secondStart + first.destinationEnd - first.start }
		const result = replaceCachedAttachmentReferences({
			content,
			replacement: '<figure>new</figure>', replacementPath: 'assets/new.png', image: true, asFigure: true,
		}, [first, second])
		expect(result?.text).toContain('<figure>new</figure>')
		expect(result?.text.match(/<figure>new<\/figure>/g)).toHaveLength(2)
		expect(result?.text).toContain('![[assets/other.png]]')
	})

	it('uses the generated destination when no explicit replacement path is supplied', () => {
		const content = '![[assets/old.png]]'
		const cached = occurrence(content, '![[assets/old.png]]')
		expect(replaceCachedAttachmentReferences({
			content, replacement: '![[assets/new.png]]', image: true, asFigure: false,
		}, [cached])?.text).toBe('![[assets/new.png]]')
		expect(replaceCachedAttachmentReferences({
			content, replacement: '', image: true, asFigure: false,
		}, [cached])?.text).toBe('![[]]')
	})

	it.each([
		['shortest wikilink', '![[image.png]]', '![[image.png]]'],
		['relative Markdown', '![image](../assets/image.png)', '![image](../assets/image.png)'],
		['absolute wikilink', '![[/assets/image.png]]', '![[/assets/image.png]]'],
	] as const)('preserves the generated %s destination', (_label, content, expected) => {
		expect(replaceAttachmentReference({
			content,
			cursor: 0,
			targetPaths: ['image.png', '../assets/image.png', '/assets/image.png'],
			replacement: expected,
			replacementPath: expected.includes('(') ? '../assets/image.png' : expected.slice(expected.indexOf('[[') + 2, expected.indexOf(']]')),
			image: true,
			asFigure: false,
		})?.text).toBe(expected)
	})

	it('recognizes an exact no-op and rejects overlapping cached provenance', () => {
		const content = '![[assets/old.png]]'
		const cached = occurrence(content, '![[assets/old.png]]')
		expect(replaceCachedAttachmentReferences({
			content, replacement: '![[assets/old.png]]', replacementPath: 'assets/old.png', image: true, asFigure: false,
		}, [cached])).toMatchObject({ text: content, matched: true })
		expect(replaceCachedAttachmentReferences({
			content, replacement: '![[assets/new.png]]', replacementPath: 'assets/new.png', image: true, asFigure: false,
		}, [cached, cached])).toBeNull()
	})

	it('rejects malformed, offset-stale, and non-image cached references', () => {
		expect(replaceCachedAttachmentReferences({ content: 'plain text', replacement: 'new', image: true, asFigure: false }, [{
			link: 'plain text', original: 'plain text', start: 0, end: 10, destinationStart: 0, destinationEnd: 10,
		}])).toBeNull()
		const content = '![[assets/old.png]]'
		const cached = occurrence(content, '![[assets/old.png]]')
		expect(replaceCachedAttachmentReferences({ content, replacement: 'new', image: true, asFigure: false }, [{
			...cached, destinationStart: cached.destinationStart + 1,
		}])).toBeNull()
		const nonImage = occurrence('[[assets/old.png]]', '[[assets/old.png]]')
		expect(replaceCachedAttachmentReferences({ content: '[[assets/old.png]]', replacement: 'new', image: true, asFigure: false }, [nonImage])).toBeNull()
	})
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

	it.each([
		['current', 'old', 'wait'],
		['current', 'none', 'abort'],
		['current', 'current', 'proceed'],
		['old', 'old', 'proceed'],
		['none', 'old', 'proceed'],
		['none', 'current', 'proceed'],
		['none', 'none', 'abort'],
		[null, 'old', 'abort'],
		[null, 'current', 'abort'],
	] as const)('allows disk=%s and editor=%s to resolve as %s', (disk, editor, expected) => {
		expect(nativeLinkSyncDecision(disk, editor)).toBe(expected)
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

	it.each([
		['current', 'old', undefined, 'wait'],
		['current', 'old', false, 'wait'],
		['current', 'old', true, 'proceed'],
		['current', 'current', undefined, 'proceed'],
		['current', 'none', undefined, 'abort'],
		['none', 'none', undefined, 'abort'],
		[null, 'old', undefined, 'abort'],
		['old', 'old', undefined, 'proceed'],
	] as const)('resolves disk=%s editor=%s final=%s as %s', (disk, editor, finalAttempt, expected) => {
		expect(batchNativeLinkSyncDecision(disk, editor, finalAttempt)).toBe(expected)
	})

	it('manually converts an old wikilink to HTML when alwaysUpdateLinks is false', () => {
		const result = replaceAttachmentReference({
			content: 'before ![[old.png]] after', cursor: 18,
			targetPaths: ['old.png', '../assets/old.png', '/assets/old.png', 'new.png'],
			replacement: '<figure>new</figure>', replacementPath: 'new.png', image: true, asFigure: true,
		})
		expect(result?.text).toBe('before ![[new.png]] after')
	})

	it.each([
		['> ![[old.png]]', '> ![[new.png]]'],
		['- ![[old.png]]', '- ![[new.png]]'],
		['12. ![[old.png]]', '12. ![[new.png]]'],
		['> - ![[old.png]]', '> - ![[new.png]]'],
		['> > ![[old.png]]', '> > ![[new.png]]'],
		['    ![[old.png]]', '    ![[new.png]]'],
		['```\n![[old.png]]\n```', '```\n![[new.png]]\n```'],
		['- ![Alt](old.png "Title")', '- ![Alt](new.png "Title")'],
		['> ![[old.png|Report]]', '> ![[new.png|Report]]'],
		['- before ![[old.png|Report]] after', '- before ![[new.png|Report]] after'],
	] as const)('keeps container destination exact for %s', (content, expected) => {
		const replacement = '<figure>\n<img src="new.png">\n</figure>'
		const result = replaceAttachmentReference({
			content, cursor: Math.max(0, content.indexOf('old.png')), targetPaths: ['old.png'], replacement,
			replacementPath: 'new.png', image: true, asFigure: true,
		})
		expect(result?.text).toBe(expected)
	})

	it.each([
		['- ![[new.png|Report]]', 8],
		['> ![Alt](new.png "Title")', 8],
	] as const)('recognizes current container reference %s', (content, cursor) => {
		const replacement = '<figure>\n<img src="new.png">\n</figure>'
		expect(replaceAttachmentReference({
			content, cursor, targetPaths: ['old.png'], currentTargetPaths: ['new.png'],
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

	it.each([
		['LF before following embed', '![[old.png]]\n![[doc.pdf]]', '<figure>new</figure>\n\n![[doc.pdf]]'],
		['CRLF before following embed', '![[old.png]]\r\n![[doc.pdf]]', '<figure>new</figure>\r\n\r\n![[doc.pdf]]'],
		['inline embed', '![[old.png]] ![[doc.pdf]]', '<figure>new</figure>\n\n ![[doc.pdf]]'],
		['inline text', '![[old.png]] after', '<figure>new</figure>\n\n after'],
		['inline text after a preceding CRLF', 'before\r\n![[old.png]] after', 'before\r\n<figure>new</figure>\r\n\r\n after'],
		['inline text after the latest mixed-ending line', 'first\nbefore\r\n![[old.png]] after', 'first\nbefore\r\n<figure>new</figure>\r\n\r\n after'],
		['inline text before a line ending', '![[old.png]] after\n![[doc.pdf]]', '<figure>new</figure>\n\n after\n![[doc.pdf]]'],
		['existing blank separator', '![[old.png]]\n\n![[doc.pdf]]', '<figure>new</figure>\n\n![[doc.pdf]]'],
		['whitespace-only blank separator', '![[old.png]]\n  \n![[doc.pdf]]', '<figure>new</figure>\n  \n![[doc.pdf]]'],
		['bare EOF', '![[old.png]]', '<figure>new</figure>'],
		['terminal LF EOF', '![[old.png]]\n', '<figure>new</figure>\n'],
		['terminal CRLF EOF', '![[old.png]]\r\n', '<figure>new</figure>\r\n'],
		['trailing whitespace', '![[old.png]]   ', '<figure>new</figure>   '],
	] as const)('preserves the figure boundary for %s', (_label, content, expected) => {
		const result = replaceAttachmentReference({
			content, cursor: 5, targetPaths: ['old.png'],
			replacement: '<figure>new</figure>', replacementPath: 'new.png', image: true, asFigure: true,
		})
		expect(result?.text).toBe(expected)
	})

	it('keeps replacement offsets stable beside the following burst item', () => {
		const result = replaceAttachmentReference({
			content: '![[old.png]]\n![[doc.pdf]]', cursor: 5, targetPaths: ['old.png'],
			replacement: '<figure>new</figure>', replacementPath: 'new.png', image: true, asFigure: true,
		})
		expect(result).toMatchObject({ start: 0, end: 12, replacementText: '<figure>new</figure>\n' })
	})

	it('preserves the image marker in Markdown mode when alwaysUpdateLinks is false', () => {
		const result = replaceAttachmentReference({
			content: '![old.png](old.png)', cursor: 10, targetPaths: ['old.png', '../old.png', '/old.png'],
			replacement: '![new.png](new.png)', image: true, asFigure: false,
		})
		expect(result?.text).toBe('![old.png](new.png)')
	})

	it.each([
		['![[old.pdf|Report]]', '[[new.pdf|Report]]', '![[new.pdf|Report]]'],
		['[[old.pdf|Report]]', '[[new.pdf|Report]]', '[[new.pdf|Report]]'],
		['![Report](old.pdf "Title")', '[Report](new.pdf "Title")', '![Report](new.pdf "Title")'],
		['[Report](old.pdf "Title")', '[Report](new.pdf "Title")', '[Report](new.pdf "Title")'],
	] as const)('updates non-image destination in %s', (content, replacement, expected) => {
		expect(replaceAttachmentReference({
			content, cursor: 5, targetPaths: ['old.pdf'], replacement, replacementPath: 'new.pdf', image: false, asFigure: false,
		})?.text).toBe(expected)
	})

	it.each([
		['![[new.pdf|Report]]', 5, '[[new.pdf|Report]]'],
		['![Report](new.pdf "Title")', 5, '[Report](new.pdf "Title")'],
	] as const)('recognizes current embedded non-image reference %s', (content, cursor, replacement) => {
		expect(replaceAttachmentReference({
			content, cursor, targetPaths: ['old.pdf'], currentTargetPaths: ['new.pdf'],
			replacement, replacementPath: 'new.pdf', image: false, asFigure: false,
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
