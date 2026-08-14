export interface MarkdownFenceState {
	marker: '`' | '~'
	length: number
}

export function advanceMarkdownFence(state: MarkdownFenceState | null, line: string): MarkdownFenceState | null {
	if (state) {
		return new RegExp(`^ {0,3}${state.marker}{${state.length},}\\s*$`).test(line) ? null : state
	}
	const opening = /^ {0,3}(`{3,}|~{3,})/.exec(line)
	return opening ? { marker: opening[1][0] as '`' | '~', length: opening[1].length } : null
}
