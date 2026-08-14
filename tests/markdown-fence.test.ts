import { describe, expect, it } from 'vitest'

import { advanceMarkdownFence, MarkdownFenceState } from '../src/markdown-fence'

describe('bounded Markdown fence state', () => {
	it('tracks top-level openers, matching closes, and later openers', () => {
		let state = advanceMarkdownFence(null, '```html')
		state = advanceMarkdownFence(state, 'inside')
		state = advanceMarkdownFence(state, '```')
		state = advanceMarkdownFence(state, '~~~')
		expect(state).toEqual({ marker: '~', length: 3 })
		expect(advanceMarkdownFence(null, '   ```')).toEqual({ marker: '`', length: 3 })
		expect(advanceMarkdownFence({ marker: '`', length: 3 }, '  ````')).toBeNull()
	})

	it('keeps non-closing lines and rejects four-space openers', () => {
		const state: MarkdownFenceState = { marker: '`', length: 3 }
		expect(advanceMarkdownFence(state, '~~~')).toEqual(state)
		expect(advanceMarkdownFence(null, '    ```')).toBeNull()
		expect(advanceMarkdownFence(advanceMarkdownFence(null, '```'), 'inside')).toEqual(state)
	})
})
