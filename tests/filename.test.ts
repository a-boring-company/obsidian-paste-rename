import { describe, expect, it } from 'vitest'

import { normalizeFilenameStem } from '../src/filename'

describe('filename normalisation', () => {
	it('creates a readable ASCII stem', () => {
		expect(normalizeFilenameStem('Đọc Chậm & Test')).toBe('Doc_Cham_Test')
	})

	it('decomposes accents, removes non-ASCII and unsafe punctuation', () => {
		expect(normalizeFilenameStem('Café 日本 <x> \\"quote\\" / path')).toBe('Cafe_x_quote_path')
	})

	it('collapses separators and trims them', () => {
		expect(normalizeFilenameStem(' -- hello___world -- ')).toBe('hello_world')
	})

})
