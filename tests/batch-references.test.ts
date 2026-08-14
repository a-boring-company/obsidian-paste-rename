import { describe, expect, it } from 'vitest'

import { collectBatchReferenceLinks } from '../src/batch-references'
import { extractGeneratedFigurePaths } from '../src/figure-document'
import { renderFigure } from '../src/figure'

describe('generated figure batch references', () => {
	it('extracts and decodes only the plugin figure source markup', () => {
		const figure = renderFigure({ src: '../assets/café & image.png', stem: 'café & image' })
		expect(extractGeneratedFigurePaths(`before\n${figure}\nafter`)).toEqual(['../assets/café & image.png'])
		expect(extractGeneratedFigurePaths('<img src="assets/not-a-figure.png">')).toEqual([])
	})

	it('decodes HTML entities and URL escapes while ignoring malformed sources', () => {
		const figure = `<figure style="text-align: center;">\n<img src="assets/a%26b%20file.png" alt="a&amp;b file" style="width: 80%;">\n<figcaption><b>Figure</b>. a&amp;b file.</figcaption>\n</figure>`
		const malformed = `<figure style="text-align: center;">\n<img src="assets/%bad.png" alt="bad" style="width: 80%;">\n<figcaption><b>Figure</b>. bad.</figcaption>\n</figure>`
		expect(extractGeneratedFigurePaths(`${figure}\n${malformed}`)).toEqual(['assets/a&b file.png'])
	})

	it('combines and deduplicates metadata and figure references', () => {
		const figure = renderFigure({ src: 'assets/image.png', stem: 'image' })
		expect(collectBatchReferenceLinks(['assets/image.png', 'other.pdf', 'assets/image.png'], figure))
			.toEqual(['assets/image.png', 'other.pdf'])
	})

	it('does not discover figures inside frontmatter, code, indentation, or comments', () => {
		const figure = renderFigure({ src: 'assets/hidden.png', stem: 'hidden' })
		const document = [
			'---', figure, '---',
			'```html', figure, '```',
			figure.split('\n').map(line => `    ${line}`).join('\n'),
			`<!--\n${figure}\n-->`,
		].join('\n')
		expect(extractGeneratedFigurePaths(document)).toEqual([])
	})

	it('uses the CommonMark 0-to-3-space fence boundary', () => {
		const figure = renderFigure({ src: 'assets/exposed.png', stem: 'exposed' })
		expect(extractGeneratedFigurePaths(['```html', figure, '   ```', figure].join('\n'))).toEqual(['assets/exposed.png'])
		expect(extractGeneratedFigurePaths(['   ```html', figure, '   ```'].join('\n'))).toEqual([])
		expect(extractGeneratedFigurePaths(['```html', figure, '    ```', figure].join('\n'))).toEqual([])
		expect(extractGeneratedFigurePaths(['    ```html', figure, '    ```'].join('\n'))).toEqual(['assets/exposed.png'])
	})

})
