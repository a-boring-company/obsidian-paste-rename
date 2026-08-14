import { describe, expect, it } from 'vitest'

import { attachmentTargetPathGroups, extractGeneratedDestination } from '../src/attachment-links'

describe('generated attachment links', () => {
	it('extracts destinations from wikilinks and non-embed generated links', () => {
		expect(extractGeneratedDestination('![[old.png]]')).toBe('old.png')
		expect(extractGeneratedDestination('[[old.png]]')).toBe('old.png')
		expect(extractGeneratedDestination('[old.png](old.png)')).toBe('old.png')
		expect(extractGeneratedDestination('old.png')).toBe('old.png')
		expect(extractGeneratedDestination('')).toBeNull()
	})

	it('derives old and current generated, relative, and vault-root candidates', () => {
		expect(attachmentTargetPathGroups('notes/topic.md', 'assets/old.png', 'assets/new.png', '[[old.png]]', '[new.png](new.png)'))
			.toEqual({
				old: ['old.png', '../assets/old.png', 'assets/old.png', '/assets/old.png'],
				current: ['new.png', '../assets/new.png', 'assets/new.png', '/assets/new.png'],
			})
	})

})
