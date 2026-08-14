import { advanceMarkdownFence, MarkdownFenceState } from './markdown-fence'

export interface MarkdownDocumentContext {
	fence: MarkdownFenceState | null
	frontmatter: boolean
	comment: boolean
	atDocumentStart: boolean
}

export function emptyMarkdownDocumentContext(): MarkdownDocumentContext {
	return { fence: null, frontmatter: false, comment: false, atDocumentStart: true }
}

function isFrontmatterEnd(line: string): boolean {
	return line.trim() === '---' || line.trim() === '...'
}

function scanHtmlCommentState(initial: boolean, line: string): boolean {
	let open = initial
	for (const token of line.match(/<!--|-->/g) ?? []) open = token === '<!--'
	return open
}

export function advanceMarkdownDocumentContext(
	state: MarkdownDocumentContext,
	line: string,
): MarkdownDocumentContext {
	if (state.frontmatter) {
		return { ...state, frontmatter: !isFrontmatterEnd(line), atDocumentStart: false }
	}
	if (state.atDocumentStart && line.trim() === '---') {
		return { ...state, frontmatter: true, atDocumentStart: false }
	}
	if (state.fence) {
		return { ...state, fence: advanceMarkdownFence(state.fence, line), atDocumentStart: false }
	}
	if (state.comment) {
		return { ...state, comment: scanHtmlCommentState(true, line), atDocumentStart: false }
	}
	const startedFence = advanceMarkdownFence(null, line)
	if (startedFence) {
		return { ...state, fence: startedFence, atDocumentStart: false }
	}
	return { ...state, comment: scanHtmlCommentState(false, line), atDocumentStart: false }
}

export function markdownDocumentContextBefore(lines: readonly string[]): MarkdownDocumentContext {
	return lines.reduce(advanceMarkdownDocumentContext, emptyMarkdownDocumentContext())
}
