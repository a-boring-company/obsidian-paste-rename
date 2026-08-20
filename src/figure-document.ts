import { pathsEqual } from './embeds'
import { renderFigure } from './figure'
import { advanceMarkdownDocumentContext, emptyMarkdownDocumentContext } from './markdown-context'

function decodeHtmlAttribute(value: string): string {
	const entities: Record<string, string> = {
		amp: '&',
		lt: '<',
		gt: '>',
		quot: '"',
		'#39': "'",
	}
	return value.replace(/&(amp|lt|gt|quot|#39);/g, (_, entity: string) => entities[entity])
}

function decodeGeneratedFigureSource(value: string): string | null {
	try {
		return decodeURIComponent(decodeHtmlAttribute(value))
	} catch {
		return null
	}
}

interface LineRecord {
	text: string
	start: number
	end: number
}

interface GeneratedFigureBlock {
	start: number
	end: number
	source: string
	alt: string
	caption: string
	width: number
	text: string
}

function splitLines(value: string): LineRecord[] {
	const records: LineRecord[] = []
	const pattern = /([^\r\n]*)(\r\n|\n|\r|$)/g
	let match: RegExpExecArray | null
	while ((match = pattern.exec(value)) !== null) {
		if (!match[0]) break
		records.push({ text: match[1], start: match.index, end: match.index + match[1].length })
	}
	return records
}

function figureAt(lines: LineRecord[], index: number, value: string): GeneratedFigureBlock | null {
	if (index + 3 >= lines.length || lines[index].text !== '<figure style="text-align: center;">' || lines[index + 3].text !== '</figure>') return null
	const image = /^<img src="([^"]+)" alt="([^"]*)" style="width: ([1-9]\d?|100)%;">$/.exec(lines[index + 1].text)
	const caption = /^<figcaption><b>Figure<\/b>\. ([^<]*)\.<\/figcaption>$/.exec(lines[index + 2].text)
	if (!image || !caption) return null
	return {
		start: lines[index].start,
		end: lines[index + 3].end,
		source: image[1],
		alt: image[2],
		caption: caption[1],
		width: Number(image[3]),
		text: value.slice(lines[index].start, lines[index + 3].end),
	}
}

function stemFromPath(path: string): string {
	const segments = path.split('/')
	const basename = segments[segments.length - 1]
	const extensionStart = basename.lastIndexOf('.')
	return extensionStart > 0 ? basename.slice(0, extensionStart) : basename
}

function isOwnedGeneratedFigure(block: GeneratedFigureBlock, expectedPath?: string, expectedStem?: string): boolean {
	const decodedPath = decodeGeneratedFigureSource(block.source)
	if (!decodedPath || decodedPath.endsWith('/') || (expectedPath !== undefined && !pathsEqual(decodedPath, expectedPath))) return false
	const stem = stemFromPath(decodedPath)
	if (expectedStem !== undefined && stem !== expectedStem) return false
	if (decodeHtmlAttribute(block.alt) !== stem || decodeHtmlAttribute(block.caption) !== stem.replace(/_/g, ' ')) return false
	const lineEnding = block.text.includes('\r\n') ? '\r\n' : '\n'
	return renderFigure({ src: decodedPath, stem, width: block.width }).replace(/\n/g, lineEnding) === block.text
}

function generatedFigures(value: string): GeneratedFigureBlock[] {
	const lines = splitLines(value)
	const blocks: GeneratedFigureBlock[] = []
	let context = emptyMarkdownDocumentContext()
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index].text
		const nextContext = advanceMarkdownDocumentContext(context, line)
		const contextStarted = !context.frontmatter && nextContext.frontmatter
			|| context.fence === null && nextContext.fence !== null
			|| !context.comment && nextContext.comment
		if (context.frontmatter || context.fence !== null || context.comment || contextStarted) {
			context = nextContext
			continue
		}
		if (/^(?: {4}|\t)/.test(line)) {
			context = nextContext
			continue
		}
		const block = figureAt(lines, index, value)
		context = nextContext
		if (block) {
			blocks.push(block)
			index += 3
		}
	}
	return blocks
}

export function extractGeneratedFigurePaths(value: string): string[] {
	const paths: string[] = []
	for (const block of generatedFigures(value)) {
		const path = decodeGeneratedFigureSource(block.source)
		if (path !== null && isOwnedGeneratedFigure(block) && !paths.includes(path)) paths.push(path)
	}
	return paths
}

export function replaceGeneratedFigures(
	value: string,
	oldPath: string,
	newPath: string,
	oldStem: string,
	newStem: string,
): string {
	const replacements: Array<{ start: number; end: number; text: string }> = []
	for (const block of generatedFigures(value)) {
		if (!isOwnedGeneratedFigure(block, oldPath, oldStem)) continue
		const lineEnding = block.text.includes('\r\n') ? '\r\n' : '\n'
		replacements.push({
			start: block.start,
			end: block.end,
			text: renderFigure({ src: newPath, stem: newStem, width: block.width }).replace(/\n/g, lineEnding),
		})
	}
	let result = value
	for (let index = replacements.length - 1; index >= 0; index--) {
		const replacement = replacements[index]
		result = `${result.slice(0, replacement.start)}${replacement.text}${result.slice(replacement.end)}`
	}
	return result
}
