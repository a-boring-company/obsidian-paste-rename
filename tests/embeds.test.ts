import { describe, expect, it } from 'vitest'

import { extractReferencePath, findReferenceOccurrences, pathsEqual } from '../src/embeds'

describe('CommonMark attachment reference parsing', () => {
	it('extracts wiki and Markdown references with logical destinations', () => {
		expect(extractReferencePath('![[folder/image.png|300]]')).toMatchObject({ kind: 'wiki', image: true, path: 'folder/image.png' })
		expect(extractReferencePath('[Report](<folder/file.pdf> "Title")')).toMatchObject({ kind: 'markdown', image: false, path: 'folder/file.pdf' })
		expect(extractReferencePath('![alt](folder/my%20image.png "title")')).toMatchObject({ kind: 'markdown', image: true, path: 'folder/my%20image.png' })
		expect(extractReferencePath('![a\\]lt](folder/my\\(image\\).png)')).toMatchObject({ path: 'folder/my\\(image\\).png' })
		expect(extractReferencePath('![alt](<folder/my\\>image.png>)')).toMatchObject({ path: 'folder/my\\>image.png' })
		expect(extractReferencePath('![alt](folder/image_(1).png)')).toMatchObject({ path: 'folder/image_(1).png' })
		expect(extractReferencePath('![outer [inner] alt](folder/image.png)')).toMatchObject({ path: 'folder/image.png' })
		expect(extractReferencePath('![alt](folder/file\\name.png)')).toMatchObject({ path: 'folder/file\\name.png' })
		expect(pathsEqual('folder/my\\(image\\).png', 'folder/my(image).png')).toBe(true)
		expect(pathsEqual('bad%name.png', 'bad%name.png')).toBe(true)
	})

	it('accepts nonblank whitespace before destinations and within titles', () => {
		expect(extractReferencePath('![alt](\nimage.png)')).toMatchObject({ path: 'image.png' })
		expect(extractReferencePath('![alt](image.png\n"title")')).toMatchObject({ path: 'image.png' })
		expect(extractReferencePath('![alt](<image.png>\n"title")')).toMatchObject({ path: 'image.png' })
		expect(extractReferencePath('![alt](image.png "title\nmore")')).toMatchObject({ path: 'image.png' })
	})

	it('rejects blank lines before a destination', () => {
		expect(extractReferencePath('![alt](\n\nimage.png)')).toBeNull()
		expect(extractReferencePath('![alt]( \t\n \n image.png)')).toBeNull()
	})

	it('rejects nested or malformed parenthesized titles and blank-line tails', () => {
		for (const input of [
			'![alt]()',
			'![alt](image.png nope)',
			'![alt](image.png "unterminated)',
			'![alt](<>)',
			'![alt](<image.png)',
			'![[unclosed',
			'![alt(x.png)',
			'![alt](image.png (title (nested)))',
			'![alt](image.png "title\n\nmore")',
			'![alt](image.png\n\n"title")',
			'![alt](image.png "title")\n\n',
			'![alt](<image.png>"title")',
			'![alt](<folder/<image.png>)',
			'![alt](<image.png\n>)',
		]) expect(extractReferencePath(input)).toBeNull()
		expect(extractReferencePath('![alt](image.png (title\\) still))')).toMatchObject({ path: 'image.png' })
		expect(extractReferencePath('![alt](image.png (title\\(escaped\\)))')).toMatchObject({ path: 'image.png' })
		expect(extractReferencePath('![alt](image.png   )')).toMatchObject({ path: 'image.png' })
		expect(extractReferencePath('![alt](image.png "title\\"more")')).toMatchObject({ path: 'image.png' })
	})

	it('finds only complete production references and preserves occurrence spans', () => {
		const value = 'before ![[one.png]] and [two](two.pdf) after ![three](three.png)'
		const occurrences = findReferenceOccurrences(value)
		expect(occurrences.map(reference => reference.path)).toEqual(['one.png', 'two.pdf', 'three.png'])
		expect(value.slice(occurrences[1].start, occurrences[1].end)).toBe('[two](two.pdf)')
		expect(findReferenceOccurrences('![bad](image.png (nested (title)))')).toEqual([])
	})
})
