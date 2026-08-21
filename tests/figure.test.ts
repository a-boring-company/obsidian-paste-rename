import { describe, expect, it } from 'vitest'

import { renderFigure } from '../src/figure'

describe('figure rendering', () => {
	it('renders the exact centered figure block with a percentage width', () => {
		expect(renderFigure({ src: 'assets/image_1.png', stem: 'image_1', width: 50 })).toBe(`<figure style="text-align: center;">
<img src="assets/image_1.png" alt="image_1" style="width: 50%;">
<figcaption><b>Figure</b>. image 1.</figcaption>
</figure>`)
	})

	it('defaults invalid widths to 80 percent', () => {
		for (const width of [undefined, 0, -1, 101, 1.5, Number.NaN]) {
			expect(renderFigure({ src: 'image.png', stem: 'image', width })).toContain('style="width: 80%;"')
		}
	})

	it('escapes attributes and caption text', () => {
		const rendered = renderFigure({ src: 'x" onerror="bad&x', stem: 'x_<unsafe>', width: 100 })
		expect(rendered).toContain('src="x%22%20onerror%3D%22bad%26x"')
		expect(rendered).toContain('alt="x_&lt;unsafe&gt;"')
		expect(rendered).toContain('<figcaption><b>Figure</b>. x &lt;unsafe&gt;.</figcaption>')
	})

	it('encodes each raw relative source path segment before HTML escaping', () => {
		const rendered = renderFigure({ src: 'folder/100%/café & "x" #?.png', stem: 'caption' })
		expect(rendered).toContain('src="folder/100%25/caf%C3%A9%20%26%20%22x%22%20%23%3F.png"')
		expect(renderFigure({ src: 'folder/my%20image.png', stem: 'caption' })).toContain('src="folder/my%2520image.png"')
		expect(renderFigure({ src: '.././assets/parent file.png', stem: 'parent file' })).toContain('src=".././assets/parent%20file.png"')
		expect(renderFigure({ src: 'folder/bad%name.png', stem: 'bad' })).toContain('src="folder/bad%25name.png"')
	})

	it.each([
		['image.png', 'image.png', 'png'],
		['assets/image.png', 'assets/image.png', 'png'],
		['notes/image.png', 'notes/image.png', 'png'],
		['notes/current/image.svg', 'notes/current/image.svg', 'svg'],
		['assets/raw %/Đọc image.gif', 'assets/raw%20%25/%C4%90%E1%BB%8Dc%20image.gif', 'gif'],
		['assets/photo 100%.jpeg', 'assets/photo%20100%25.jpeg', 'jpeg'],
	] as const)('renders the canonical raw vault path once for %s', (rawPath, encodedPath, extension) => {
		const rendered = renderFigure({ src: rawPath, stem: `image.${extension}` })
		expect(rendered).toContain(`src="${encodedPath}"`)
	})
})
