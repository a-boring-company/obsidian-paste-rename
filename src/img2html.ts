/**
 * HTML Image Tag Generation
 * Converts image file references to centered HTML image tags with figure captions
 * Extracted from obsidian-img2html plugin
 */

export interface Html2ImgConfig {
	imageWidth: string
	includeAlt: boolean
	useCustomPath: boolean
	customPath: string
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildImgWidthAttrs(widthRaw: string): { widthAttr: string; styleAttr: string } {
	const width = (widthRaw ?? '').trim()
	if (!width) return { widthAttr: '', styleAttr: '' }
	// The HTML <img> width attribute expects an integer pixel value.
	// For percentages/px/auto/etc, use CSS style instead.
	if (/^\d+$/.test(width)) {
		return { widthAttr: ` width="${escapeHtml(width)}"`, styleAttr: '' }
	}
	return { widthAttr: '', styleAttr: ` style="width: ${escapeHtml(width)};"` }
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
}

function trimTrailingSlashes(p: string): string {
	return p.replace(/\/+$/, '')
}

/**
 * Generate HTML image tag with centered layout
 * @param fileName - Image file name (with extension)
 * @param imagePath - Full path to image in vault
 * @param imageDir - Directory containing the image
 * @param config - Configuration for HTML generation
 * @returns HTML string
 */
export function createHtmlImgTag(
	fileName: string,
	imagePath: string,
	imageDir: string,
	config: Html2ImgConfig
): string {
	const { imageWidth, includeAlt, useCustomPath, customPath } = config

	// Determine src attribute
	let srcRaw: string
	if (useCustomPath && customPath) {
		// Use caller-specified path (relative or absolute) and avoid duplicate slashes
		const base = trimTrailingSlashes(customPath)
		srcRaw = `${base}/${fileName}`
	} else if (imagePath) {
		// Prefer the provided path when not using a custom base
		srcRaw = imagePath
	} else if (imageDir) {
		const dir = trimTrailingSlashes(imageDir)
		srcRaw = dir ? `${dir}/${fileName}` : fileName
	} else {
		// Default: use only filename (same directory as current file)
		srcRaw = fileName
	}

	const src = escapeHtml(srcRaw)

	// Generate figure caption from filename
	const figureCaption = escapeHtml(imageNameToFigureCaption(fileName))

	// Build alt attribute
	const altAttr = includeAlt ? ` alt="${escapeHtml(fileName)}"` : ''

	const { widthAttr, styleAttr } = buildImgWidthAttrs(imageWidth)

	// Generate HTML with centered layout
	const html = `<figure style="text-align: center;">
<img src="${src}"${widthAttr}${styleAttr}${altAttr}>
<figcaption><b>Figure</b>. ${figureCaption}</figcaption>
</figure>`

	return html
}

/**
 * Convert image filename to figure caption
 * Replaces underscores with spaces, removes extension, adds period
 * @param fileName - Image file name (e.g., "image_1234_test.jpg")
 * @returns Caption text (e.g., "image 1234 test.")
 */
export function imageNameToFigureCaption(fileName: string): string {
	// Remove extension
	const nameWithoutExt = fileName.replace(/(?<!^)\.[^/.]+$/, '')
	// Replace underscores with spaces
	const caption = nameWithoutExt.replace(/_/g, ' ')
	// Add period at the end
	return `${caption}.`
}

/**
 * Extract the target path from an Obsidian embed string.
 *
 * Supported formats:
 * - Wikilink embed: ![[path/to/file.png]] or ![[path/to/file.png|300]]
 * - Markdown embed: ![alt](path/to/file.png) or ![alt](<path with spaces.png>)
 */
export function extractObsidianEmbedPath(embed: string): string | null {
	const wikilink = embed.match(/^!\[\[([\s\S]+)\]\]$/)
	if (wikilink) {
		const inner = wikilink[1]
		const target = inner.split('|')[0].trim()
		return target || null
	}

	const markdown = embed.match(/^!\[[^\]]*\]\(([^)]+)\)$/)
	if (markdown) {
		let target = markdown[1].trim()
		if (target.startsWith('<')) {
			const end = target.indexOf('>')
			if (end >= 0) {
				target = target.slice(1, end).trim()
			}
		}
		return target || null
	}

	return null
}

/**
 * Replace Obsidian image embeds in a line with centered HTML <figure> output.
 *
 * This is intentionally a pure string transform so it can be unit-tested.
 */
export function replaceImageEmbedsWithHtml(
	line: string,
	fileName: string,
	imageDir: string,
	config: Html2ImgConfig
): { replacedLine: string; didReplace: boolean } {
	const flexibleFileName = escapeRegExp(fileName).replace(/ /g, '(?: |%20)')
	const embedPattern = new RegExp(
		`!\\[\\[[^\\]]*${flexibleFileName}[^\\]]*\\]\\]|!\\[[^\\]]*\\]\\([^)]*${flexibleFileName}[^)]*\\)`,
		'g'
	)

	const replacedLine = line.replace(embedPattern, (embed) => {
		const imagePathFromEmbed = extractObsidianEmbedPath(embed) || ''
		return createHtmlImgTag(fileName, imagePathFromEmbed, imageDir, config)
	})

	return {
		replacedLine,
		didReplace: replacedLine !== line,
	}
}
