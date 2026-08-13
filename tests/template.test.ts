import { describe, expect, it } from 'vitest'

import { expandTemplate, renderTemplate } from '../src/template'

describe('template expansion', () => {
	const data = { imageNameKey: 'key', fileName: 'note', dirName: 'notes', firstHeading: 'Heading' }
	const date = { format: (value: string) => value === 'YYYY' ? '2026' : 'DATE' }

	it('expands every occurrence of every supported variable', () => {
		expect(expandTemplate('{{fileName}}-{{fileName}}-{{DATE:YYYY}}-{{DATE:YYYY}}', data, undefined, date))
			.toBe('note-note-2026-2026')
	})

	it('expands every frontmatter occurrence and missing values to empty text', () => {
		expect(expandTemplate('{{frontmatter:alias}}/{{frontmatter:alias}}/{{frontmatter:missing}}', data, { alias: 'A' }, date))
			.toBe('A/A/')
	})

	it('returns token values literally without replacement-token or recursive expansion', () => {
		const literalData = {
			imageNameKey: '$&',
			fileName: '{{dirName}}',
			dirName: '{{fileName}}',
			firstHeading: '{{DATE:YYYY}}',
		}
		expect(expandTemplate('{{imageNameKey}}|{{fileName}}|{{dirName}}|{{firstHeading}}', literalData, { alias: '{{fileName}}' }, date))
			.toBe('$&|{{dirName}}|{{fileName}}|{{DATE:YYYY}}')
		expect(expandTemplate('{{frontmatter:alias}}', data, { alias: '$& {{fileName}}' }, date)).toBe('$& {{fileName}}')
	})

	it('does not read inherited frontmatter properties', () => {
		const inherited = Object.create({ toString: 'inherited-string', constructor: 'inherited-constructor', __proto__: 'inherited-proto' }) as Record<string, unknown>
		expect(expandTemplate('{{frontmatter:toString}}|{{frontmatter:constructor}}|{{frontmatter:__proto__}}', data, inherited, date)).toBe('||')
		expect(expandTemplate('{{frontmatter:alias}}', data, { alias: undefined }, date)).toBe('')
	})

	it('keeps the Obsidian wrapper compatible with the pure expansion', () => {
		const previousWindow = globalThis.window
		globalThis.window = { moment: () => date } as never
		expect(renderTemplate('{{fileName}}-{{DATE:YYYY}}', data)).toBe('note-2026')
		globalThis.window = previousWindow
	})
})
