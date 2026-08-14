import { describe, expect, it } from 'vitest'

import { extractGeneratedFigurePaths, replaceGeneratedFigures } from '../src/figure-document'
import { renderFigure } from '../src/figure'

describe('generated figure document replacement', () => {
	it('updates every canonical matching figure while preserving each width', () => {
		const first = renderFigure({ src: '../assets/old.png', stem: 'old', width: 40 })
		const second = renderFigure({ src: '../assets/old.png', stem: 'old', width: 90 })
		const replacement = `${renderFigure({ src: '../assets/new.png', stem: 'new', width: 40 })}\n${renderFigure({ src: '../assets/new.png', stem: 'new', width: 90 })}`
		expect(replaceGeneratedFigures(`${first}\n${second}`, '../assets/old.png', '../assets/new.png', 'old', 'new')).toBe(replacement)
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

	it('accepts only safe legacy source encodings when discovering and replacing figures', () => {
		const legacy = '<figure style="text-align: center;">\n<img src="assets/a b.png" alt="a b" style="width: 80%;">\n<figcaption><b>Figure</b>. a b.</figcaption>\n</figure>'
		const entity = '<figure style="text-align: center;">\n<img src="assets/a&amp;b.png" alt="a&amp;b" style="width: 80%;">\n<figcaption><b>Figure</b>. a&amp;b.</figcaption>\n</figure>'
		expect(extractGeneratedFigurePaths(`${legacy}\n${entity}`)).toEqual(['assets/a b.png', 'assets/a&b.png'])
		expect(replaceGeneratedFigures(`${legacy}\n${entity}`, 'assets/a b.png', 'assets/new.png', 'a b', 'new'))
			.toContain('src="assets/new.png"')
		expect(replaceGeneratedFigures(`${legacy}\n${entity}`, 'assets/a&b.png', 'assets/entity-new.png', 'a&b', 'entity-new'))
			.toContain('src="assets/entity-new.png"')
	})

	it('handles literal percent characters in a legacy path safely', () => {
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
})
