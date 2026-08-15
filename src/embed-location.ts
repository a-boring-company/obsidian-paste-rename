export interface LineReplacement {
	text: string
	start: number
	end: number
	matched?: boolean
	replacementText?: string
}

export interface LineEdit extends LineReplacement {
	line: number
	endLine: number
	endCh: number
}

interface TextCursor {
	line: number
	ch: number
}

export const BOUNDED_SEARCH_RADIUS = 8

function lineStartOffsets(lines: readonly string[]): number[] {
	const offsets: number[] = []
	let offset = 0
	for (const line of lines) {
		offsets.push(offset)
		offset += line.length + 1
	}
	return offsets
}

function positionFromOffset(content: string, offset: number): TextCursor {
	const prefix = content.slice(0, offset)
	const lines = prefix.split('\n')
	return { line: lines.length - 1, ch: lines[lines.length - 1].length }
}

export function replaceNearCursorInText(
	cursor: TextCursor,
	lineCount: number,
	replacer: (content: string, cursor: number) => LineReplacement | null,
	getLine: (line: number) => string,
	radius = BOUNDED_SEARCH_RADIUS,
): LineEdit | null {
	if (lineCount <= 0) return null
	const line = Math.max(0, Math.min(cursor.line, lineCount - 1))
	const firstLine = Math.max(0, line - radius)
	const lastLine = Math.min(lineCount - 1, line + radius)
	const beforeLines = firstLine > 0 ? [getLine(firstLine - 1)] : []
	const mainLines = Array.from({ length: lastLine - firstLine + 1 }, (_, index) => getLine(firstLine + index))
	const afterLines = lastLine + 1 < lineCount ? [getLine(lastLine + 1)] : []
	const lines = [...beforeLines, ...mainLines, ...afterLines]
	const offsets = lineStartOffsets(lines)
	const content = lines.join('\n')
	const anchorStart = beforeLines.length
	const anchorEnd = anchorStart + mainLines.length - 1
	const lineCursor = Math.max(0, Math.min(cursor.ch, mainLines[line - firstLine].length))
	const replacement = replacer(content, offsets[anchorStart + line - firstLine] + lineCursor)
	if (!replacement || (replacement.text === content && !replacement.matched)) return null
	const start = positionFromOffset(content, replacement.start)
	const end = positionFromOffset(content, replacement.end)
	if (start.line < anchorStart || start.line > anchorEnd) return null
	const replacementText = replacement.replacementText ?? replacement.text
	return {
		text: replacementText,
		start: start.ch,
		end: end.ch,
		line: firstLine + start.line - anchorStart,
		endLine: firstLine + end.line - anchorStart,
		endCh: end.ch,
		...(replacement.matched ? { matched: true } : {}),
	}
}

export function mapCursorAfterLineEdit(cursor: TextCursor, edit: Pick<LineEdit, 'line' | 'start' | 'end' | 'endLine' | 'endCh' | 'text'>): TextCursor {
	const endLine = edit.endLine
	const endCh = edit.endCh
	const replacementLines = edit.text.split('\n')
	const replacementEnd = { line: edit.line + replacementLines.length - 1, ch: replacementLines[replacementLines.length - 1].length }
	if (cursor.line < edit.line || (cursor.line === edit.line && cursor.ch <= edit.start)) return cursor
	if (cursor.line > endLine || (cursor.line === endLine && cursor.ch > endCh)) {
		if (cursor.line === endLine) return { line: replacementEnd.line, ch: replacementEnd.ch + cursor.ch - endCh }
		return { line: cursor.line + replacementEnd.line - endLine, ch: cursor.ch }
	}
	return replacementEnd
}
