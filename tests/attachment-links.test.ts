import { describe, expect, it } from 'vitest'

import { attachmentTargetPathGroups, extractGeneratedDestination, imageLinkText } from '../src/attachment-links'

describe('generated attachment links', () => {
	it('extracts destinations from wikilinks and non-embed generated links', () => {
		expect(extractGeneratedDestination('![[old.png]]')).toBe('old.png')
		expect(extractGeneratedDestination('[[old.png]]')).toBe('old.png')
		expect(extractGeneratedDestination('[old.png](old.png)')).toBe('old.png')
		expect(extractGeneratedDestination('old.png')).toBe('old.png')
		expect(extractGeneratedDestination('')).toBeNull()
	})

	it('adds the image marker only when generated Markdown omitted it', () => {
		expect(imageLinkText('![old.png](old.png)')).toBe('![old.png](old.png)')
		expect(imageLinkText('[old.png](old.png)')).toBe('![old.png](old.png)')
	})

	it('derives old and current generated, relative, and vault-root candidates', () => {
		expect(attachmentTargetPathGroups('notes/topic.md', 'assets/old.png', 'assets/new.png', '[[old.png]]', '[new.png](new.png)'))
			.toEqual({
				old: ['old.png', '../assets/old.png', 'assets/old.png', '/assets/old.png'],
				current: ['new.png', '../assets/new.png', 'assets/new.png', '/assets/new.png'],
			})
	})

})
