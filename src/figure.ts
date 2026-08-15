interface FigureOptions {
	src: string
	stem: string
	width?: number
}

export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
}

function validWidth(width: number | undefined): number {
	return width !== undefined && Number.isInteger(width) && width > 0 && width <= 100 ? width : 80
}

function encodeRelativePath(path: string): string {
	return path.split('/').map(segment => segment === '.' || segment === '..' || segment === '' ? segment : encodeURIComponent(segment)).join('/')
}

export function renderFigure(options: FigureOptions): string {
	const caption = options.stem.replace(/_/g, ' ')
	const width = validWidth(options.width)
	return `<figure style="text-align: center;">\n<img src="${escapeHtml(encodeRelativePath(options.src))}" alt="${escapeHtml(options.stem)}" style="width: ${width}%;">\n<figcaption><b>Figure</b>. ${escapeHtml(caption)}.</figcaption>\n</figure>`
}
