export interface EmbedPath {
	kind: 'wiki' | 'markdown'
	path: string
}

export interface ReferencePath extends EmbedPath {
	image: boolean
	start: number
	end: number
	destinationStart: number
	destinationEnd: number
}

function findDelimitedEnd(value: string, start: number, opening: string, closing: string): number {
	let depth = 0
	for (let index = start; index < value.length; index++) {
		if (value[index] === '\\') {
			index++
			continue
		}
		if (value[index] === opening) {
			depth++
		} else if (value[index] === closing) {
			depth--
			if (depth === 0) return index
		}
	}
	return -1
}

function findQuotedEnd(value: string, start: number, quote: string): number {
	for (let index = start + 1; index < value.length; index++) {
		if (value[index] === '\\') {
			index++
			continue
		}
		if (value[index] === quote) return index
	}
	return -1
}

function findParenthesizedTitleEnd(value: string, start: number): number {
	for (let index = start + 1; index < value.length; index++) {
		if (value[index] === '\\' && isEscapedPunctuation(value, index)) {
			index++
			continue
		}
		if (value[index] === '(') return -1
		if (value[index] === ')') return index
	}
	return -1
}


function hasLineEnding(value: string): boolean {
	return value.includes('\n') || value.includes('\r')
}

function hasBlankLine(value: string): boolean {
	return /(?:\r\n|\r|\n)[ \t]*(?:\r\n|\r|\n)/.test(value)
}

function isEscapedPunctuation(value: string, index: number): boolean {
	return index + 1 < value.length && /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(value[index + 1])
}

function skipWhitespace(value: string, start: number): number {
	let index = start
	while (index < value.length && /[ \t\r\n]/.test(value[index])) index++
	return index
}

function validTitleTail(value: string, start: number): boolean {
	if (start >= value.length) return true
	if (!/[ \t\r\n]/.test(value[start])) return false
	if (hasBlankLine(value.slice(start))) return false
	const titleStart = skipWhitespace(value, start)
	if (titleStart === value.length) return true
	const marker = value[titleStart]
	if (marker !== '"' && marker !== "'" && marker !== '(') return false
	const titleEnd = marker === '(' ? findParenthesizedTitleEnd(value, titleStart) : findQuotedEnd(value, titleStart, marker)
	return titleEnd >= 0 && value.slice(titleEnd + 1).trim() === ''
}

interface MarkdownDestination {
	path: string
	start: number
	end: number
}

function parseMarkdownDestination(raw: string): MarkdownDestination | null {
	const start = skipWhitespace(raw, 0)
	if (start >= raw.length) return null
	if (hasBlankLine(raw.slice(0, start))) return null
	if (raw[start] === '<') {
		let index = start + 1
		for (; index < raw.length; index++) {
			const character = raw[index]
			if (character === '\\' && isEscapedPunctuation(raw, index)) {
				index++
				continue
			}
			if (character === '<' || hasLineEnding(character)) return null
			if (character === '>') break
		}
		if (index >= raw.length || index === start + 1) return null
		const path = raw.slice(start + 1, index)
		if (!path.trim() || !validTitleTail(raw, index + 1)) return null
		return { path, start: start + 1, end: index }
	}
	let index = start
	let depth = 0
	for (; index < raw.length; index++) {
		const character = raw[index]
		if (character === '\\') {
			if (isEscapedPunctuation(raw, index)) {
				index++
				continue
			}
			continue
		}
		if (character === '(') {
			depth++
			continue
		}
		if (character === ')' && depth > 0) {
			depth--
			continue
		}
		if (character === ' ' || character === '\t' || character === '\r' || character === '\n') break
	}
	if (index === start || depth !== 0 || !validTitleTail(raw, index)) return null
	return { path: raw.slice(start, index), start, end: index }
}

function parseReferenceAt(value: string, start: number): ReferencePath | null {
	const image = value[start] === '!'
	const open = image ? start + 1 : start
	if (value[open] !== '[') return null
	if (value[open + 1] === '[') {
		const close = value.indexOf(']]', open + 2)
		if (close < 0) return null
		const rawPath = value.slice(open + 2, close)
		const separator = rawPath.indexOf('|')
		const path = (separator < 0 ? rawPath : rawPath.slice(0, separator)).trim()
		if (!path) return null
		const destinationStart = open + 2 + (rawPath.length - rawPath.trimStart().length)
		return { kind: 'wiki', path, image, start, end: close + 2, destinationStart, destinationEnd: destinationStart + path.length }
	}
	const altEnd = findDelimitedEnd(value, open, '[', ']')
	if (altEnd < 0 || value[altEnd + 1] !== '(') return null
	for (let close = altEnd + 2; close < value.length; close++) {
		if (value[close] === '\\') {
			close++
			continue
		}
		if (value[close] !== ')') continue
		const destination = parseMarkdownDestination(value.slice(altEnd + 2, close))
		if (!destination) continue
		return {
			kind: 'markdown', path: destination.path, image, start, end: close + 1,
			destinationStart: altEnd + 2 + destination.start, destinationEnd: altEnd + 2 + destination.end,
		}
	}
	return null
}

export function extractReferencePath(reference: string): ReferencePath | null {
	const match = parseReferenceAt(reference, 0)
	return match && match.start === 0 && match.end === reference.length ? match : null
}

export function findReferenceOccurrences(value: string): ReferencePath[] {
	const occurrences: ReferencePath[] = []
	for (let index = 0; index < value.length; index++) {
		const reference = parseReferenceAt(value, index)
		if (reference && hasFilename(reference.path)) {
			occurrences.push(reference)
			index = reference.end - 1
		}
	}
	return occurrences
}

function decodePath(path: string): string {
	try {
		return decodeURIComponent(path)
	} catch {
		return path
	}
}

function unescapeMarkdownPunctuation(path: string): string {
	return path.replace(/\\([!"#$%&'()*+,./:;<=>?@[\\\]^_`{|}~-])/g, '$1')
}

function logicalPath(path: string): string {
	return decodePath(unescapeMarkdownPunctuation(path))
}

export function pathsEqual(actual: string, expected: string): boolean {
	return logicalPath(actual) === logicalPath(expected)
}

function hasFilename(path: string): boolean {
	const decoded = logicalPath(path)
	return decoded.length > 0 && !decoded.endsWith('/') && decoded.split('/').pop() !== ''
}
