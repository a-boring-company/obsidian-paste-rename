import { describe, expect, it } from 'vitest'

import { advanceMarkdownDocumentContext, emptyMarkdownDocumentContext, markdownDocumentContextBefore } from '../src/markdown-context'

describe('bounded Markdown document context', () => {
	it('tracks document-start frontmatter without reopening it later', () => {
		const open = markdownDocumentContextBefore(['---', 'title: note'])
		expect(open.frontmatter).toBe(true)
		const closed = advanceMarkdownDocumentContext(open, '---')
		expect(closed.frontmatter).toBe(false)
		expect(markdownDocumentContextBefore(['---', 'title: note', '---', '---']).frontmatter).toBe(false)
	})

	it('tracks multiline comments and neutral top-level lines', () => {
		const open = markdownDocumentContextBefore(['<!--', 'comment'])
		expect(open.comment).toBe(true)
		expect(advanceMarkdownDocumentContext(open, '-->').comment).toBe(false)
		expect(advanceMarkdownDocumentContext(open, '--> <!-- reopened').comment).toBe(true)
		expect(markdownDocumentContextBefore(['<!-- one --> <!-- two']).comment).toBe(true)
		expect(advanceMarkdownDocumentContext(markdownDocumentContextBefore(['<!-- one --> <!-- two']), '-->').comment).toBe(false)
		expect(markdownDocumentContextBefore(['plain', '<!-- same line -->']).comment).toBe(false)
		expect(markdownDocumentContextBefore(['```html', 'figure']).fence).toEqual({ marker: '`', length: 3 })
		expect(emptyMarkdownDocumentContext().atDocumentStart).toBe(true)
	})

	it('opens a fence before scanning comment-looking info strings', () => {
		expect(markdownDocumentContextBefore(['```html <!-- -->']).fence).toEqual({ marker: '`', length: 3 })
		expect(markdownDocumentContextBefore(['```html <!-- -->']).comment).toBe(false)
	})
})
