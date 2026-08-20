import { describe, expect, it } from 'vitest'

import { extractGeneratedFigurePaths, replaceGeneratedFigures } from '../src/figure-document'
import { renderFigure } from '../src/figure'

describe('generated figure document replacement', () => {
	it('updates every canonical matching figure while preserving each width', () => {
		const first = renderFigure({ src: 'assets/old.png', stem: 'old', width: 40 })
		const second = renderFigure({ src: 'assets/old.png', stem: 'old', width: 90 })
		const replacement = `${renderFigure({ src: 'assets/new.png', stem: 'new', width: 40 })}\n${renderFigure({ src: 'assets/new.png', stem: 'new', width: 90 })}`
		expect(replaceGeneratedFigures(`${first}\n${second}`, 'assets/old.png', 'assets/new.png', 'old', 'new')).toBe(replacement)
	})

	it('does not specially match a legacy note-relative figure for a canonical path', () => {
		const legacy = renderFigure({ src: '../assets/old.png', stem: 'old' })
		expect(replaceGeneratedFigures(legacy, 'assets/old.png', 'assets/new.png', 'old', 'new')).toBe(legacy)
	})

	it('keeps literal percent identity distinct from a decoded space', () => {
		const spaceFigure = renderFigure({ src: 'assets/raw folder/image.png', stem: 'image' })
		const percentFigure = renderFigure({ src: 'assets/raw%20folder/image.png', stem: 'image' })

		expect(replaceGeneratedFigures(spaceFigure, 'assets/raw%20folder/image.png', 'assets/new.png', 'image', 'new')).toBe(spaceFigure)
		expect(replaceGeneratedFigures(percentFigure, 'assets/raw folder/image.png', 'assets/new.png', 'image', 'new')).toBe(percentFigure)
	})

	it('matches canonical figures with CRLF line endings', () => {
		const oldFigure = renderFigure({ src: 'assets/old.png', stem: 'old' }).replace(/\n/g, '\r\n')
		const newFigure = renderFigure({ src: 'assets/new.png', stem: 'new' }).replace(/\n/g, '\r\n')
		expect(replaceGeneratedFigures(oldFigure, 'assets/old.png', 'assets/new.png', 'old', 'new')).toBe(newFigure)
	})

	it('ignores manually changed markup and non-generated HTML', () => {
		const canonical = renderFigure({ src: 'assets/old.png', stem: 'old', width: 80 })
		const manual = canonical.replace('alt="old"', 'alt="Manual label"')
		const manualCaption = canonical.replace('Figure</b>. old.', 'Figure</b>. Manual label.')
		const nonGenerated = '<figure><img src="assets/old.png" alt="old"></figure>'
		const malformedImage = canonical.replace('width: 80%;', 'width: 0%;')
		const malformedSource = canonical.replace('assets/old.png', 'assets/%bad.png')
		const otherSource = renderFigure({ src: 'assets/other.png', stem: 'other' })
		expect(replaceGeneratedFigures(`${manual}\n${manualCaption}\n${nonGenerated}\n${malformedImage}\n${malformedSource}\n${otherSource}`, 'assets/old.png', 'assets/new.png', 'old', 'new'))
			.toBe(`${manual}\n${manualCaption}\n${nonGenerated}\n${malformedImage}\n${malformedSource}\n${otherSource}`)
		expect(replaceGeneratedFigures(canonical, 'assets/old.png', 'assets/new.png', 'wrong', 'new')).toBe(canonical)
	})

	it('handles literal percent characters in a canonical path safely', () => {
		const figure = renderFigure({ src: 'assets/%bad.png', stem: '%bad' })
		expect(extractGeneratedFigurePaths(figure)).toEqual(['assets/%bad.png'])
	})

	it('owns production figures with raw special-character stems', () => {
		const oldFigure = renderFigure({ src: 'assets/Đọc & 100%.png', stem: 'Đọc & 100%' })
		const newFigure = renderFigure({ src: 'assets/renamed.png', stem: 'renamed' })
		expect(extractGeneratedFigurePaths(oldFigure)).toEqual(['assets/Đọc & 100%.png'])
		expect(replaceGeneratedFigures(oldFigure, 'assets/Đọc & 100%.png', 'assets/renamed.png', 'Đọc & 100%', 'renamed')).toBe(newFigure)
	})

	it('handles extensionless and punctuation stems without changing raw ownership', () => {
		const extensionless = renderFigure({ src: 'assets/README', stem: 'README' })
		const unusable = renderFigure({ src: 'assets/!!!.png', stem: '!!!' })
		expect(extractGeneratedFigurePaths(`${extensionless}\n${unusable}`)).toEqual(['assets/README', 'assets/!!!.png'])
	})

	it('excludes frontmatter, fenced code, indented code, and HTML comments', () => {
		const figure = renderFigure({ src: 'assets/old.png', stem: 'old' })
		const document = [
			'---', figure, '---',
			'```html', figure, '```',
			figure.split('\n').map(line => `    ${line}`).join('\n'),
			`<!--\n${figure}\n-->`,
		].join('\n')
		expect(replaceGeneratedFigures(document, 'assets/old.png', 'assets/new.png', 'old', 'new')).toBe(document)
	})

	it('ignores owned figures inside Markdown containers', () => {
		const figure = renderFigure({ src: 'assets/old.png', stem: 'old' })
		const quote = figure.split('\n').map(line => `> ${line}`).join('\n')
		const list = figure.split('\n').map((line, index) => index === 0 ? `- ${line}` : `  ${line}`).join('\n')
		const quoteList = figure.split('\n').map((line, index) => index === 0 ? `> - ${line}` : `>   ${line}`).join('\n')
		const nestedList = ['- parent', ...figure.split('\n').map((line, index) => index === 0 ? `    - ${line}` : `      ${line}`), ...figure.split('\n').map((line, index) => index === 0 ? `    - ${line}` : `      ${line}`)].join('\n')
		const nestedQuoteList = ['> - parent', ...figure.split('\n').map((line, index) => index === 0 ? `>     - ${line}` : `>       ${line}`)].join('\n')
		const content = [quote, list, quoteList, nestedList, nestedQuoteList, list].join('\n')
		expect(extractGeneratedFigurePaths(content)).toEqual([])
		expect(replaceGeneratedFigures(content, 'assets/old.png', 'assets/new.png', 'old', 'new')).toBe(content)
	})

	it('does not discover supported-looking figures inside fenced code', () => {
		const figure = renderFigure({ src: 'assets/old.png', stem: 'old' })
		const quote = figure.split('\n').map(line => `> ${line}`).join('\n')
		const fenced = ['```html', quote, '```'].join('\n')
		expect(extractGeneratedFigurePaths(fenced)).toEqual([])
	})

	it('keeps comment-looking fence info strings fenced for discovery and replacement', () => {
		const figure = renderFigure({ src: 'assets/old.png', stem: 'old' })
		const fenced = ['```html <!-- -->', figure, '```', figure].join('\n')
		const replacement = ['```html <!-- -->', figure, '```', renderFigure({ src: 'assets/new.png', stem: 'new' })].join('\n')
		expect(extractGeneratedFigurePaths(fenced)).toEqual(['assets/old.png'])
		expect(replaceGeneratedFigures(fenced, 'assets/old.png', 'assets/new.png', 'old', 'new')).toBe(replacement)
	})
})
