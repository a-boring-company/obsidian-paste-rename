import { describe, expect, it } from 'vitest'

import {
	cacheEmbedOccurrences,
	cacheReferenceOccurrences,
	attachmentTargetDiscovered,
	groupCachedAttachments,
	mapCachedOccurrencesByTargetPath,
	retargetCachedOccurrences,
	replaceRetargetedCachedOccurrences,
	encodeMarkdownDestination,
	deriveRetargetDestinations,
} from '../src/batch-occurrences'

function embed(link: string, original: string, start: number) {
	const line = 0
	return {
		link,
		original,
		position: {
			start: { line, col: start, offset: start },
			end: { line, col: start + original.length, offset: start + original.length },
		},
	}
}

describe('cached embedded attachment occurrences', () => {
	it('maps sparse exact references only to requested target paths', () => {
		// These cached offsets represent references on note lines at least ten lines apart.
		const sparseLine = (line: number) => line * 100
		const occurrence = (link: string, original: string, start: number) => ({
			link,
			original,
			start,
			end: start + original.length,
			destinationStart: start + 3,
			destinationEnd: start + 3 + link.length,
		})
		const references = [
			occurrence('assets/animated.gif', '![[assets/animated.gif]]', sparseLine(0)),
			occurrence('assets/diagram.svg', '![diagram](assets/diagram.svg)', sparseLine(10)),
			occurrence('assets/hero.png', '![[assets/hero.png]]', sparseLine(20)),
			occurrence('assets/photo.jpeg', '![photo](assets/photo.jpeg)', sparseLine(30)),
			occurrence('assets/Caf%C3%A9.png', '![cafe](assets/Caf%C3%A9.png)', sparseLine(40)),
			occurrence('assets/文書.jpeg', '![[assets/文書.jpeg]]', sparseLine(50)),
			occurrence('assets/line.svg', '![line](assets/line.svg)', sparseLine(60)),
			occurrence('assets/hero.png', '![[assets/hero.png|duplicate]]', sparseLine(70)),
			occurrence('assets/raw Unicode/画像.gif', '![[assets/raw Unicode/画像.gif]]', sparseLine(80)),
			occurrence('assets/stale.png', '![[assets/stale.png]]', sparseLine(90)),
			occurrence('attachments/existing.jpeg', '![[attachments/existing.jpeg]]', sparseLine(100)),
		]
		const targetPaths = [
			'assets/animated.gif',
			'assets/diagram.svg',
			'assets/hero.png',
			'assets/photo.jpeg',
			'assets/Café.png',
			'assets/文書.jpeg',
			'assets/line.svg',
			'assets/raw Unicode/画像.gif',
		]
		const resolvedPaths = new Map([
			['assets/animated.gif', 'assets/animated.gif'],
			['assets/diagram.svg', 'assets/diagram.svg'],
			['assets/hero.png', 'assets/hero.png'],
			['assets/photo.jpeg', 'assets/photo.jpeg'],
			['assets/Caf%C3%A9.png', 'assets/Café.png'],
			['assets/文書.jpeg', 'assets/文書.jpeg'],
			['assets/line.svg', 'assets/line.svg'],
			['assets/raw Unicode/画像.gif', 'assets/raw Unicode/画像.gif'],
			['attachments/existing.jpeg', 'attachments/existing.jpeg'],
		])
		const resolveCalls: string[] = []
		const mapped = mapCachedOccurrencesByTargetPath(references, targetPaths, link => {
			resolveCalls.push(link)
			const path = resolvedPaths.get(link)
			return path ? { path } : null
		})

		expect(resolveCalls).toEqual(references.map(reference => reference.link))
		expect([...mapped.keys()]).toEqual(targetPaths)
		expect(mapped.get('assets/hero.png')?.map(reference => reference.start)).toEqual([sparseLine(20), sparseLine(70)])
		expect(mapped.get('assets/Café.png')?.map(reference => reference.original)).toEqual([
			'![cafe](assets/Caf%C3%A9.png)',
		])
		expect(mapped.get('assets/raw Unicode/画像.gif')?.[0].start).toBe(sparseLine(80))
		expect(mapped.has('assets/stale.png')).toBe(false)
		expect(mapped.has('attachments/existing.jpeg')).toBe(false)
	})

	it('groups exact cache occurrences by resolved file path', () => {
		const content = '![[old.png]]\n![[folder/old.png|Report]]'
		const first = embed('old.png', '![[old.png]]', 0)
		const second = embed('folder/old.png', '![[folder/old.png|Report]]', 13)
		const groups = groupCachedAttachments(content, [first, second], link =>
			link === 'old.png' ? { path: 'assets/old.png' } : { path: 'other/old.png' })

		expect(groups).toHaveLength(2)
		expect(groups[0].file.path).toBe('assets/old.png')
		expect(groups[1].file.path).toBe('other/old.png')
	})

	it('isolates a selected target among multiple discovered files and figures', () => {
		const groups = [
			{ file: { path: 'assets/one.png' } },
			{ file: { path: 'assets/two.png' } },
		]
		const resolve = (link: string) => link === 'figure.png' ? { path: 'assets/two.png' } : null
		expect(attachmentTargetDiscovered(groups, ['figure.png'], 'assets/one.png', resolve)).toBe(true)
		expect(attachmentTargetDiscovered(groups, ['figure.png'], 'assets/two.png', resolve)).toBe(true)
		expect(attachmentTargetDiscovered(groups, ['figure.png'], 'assets/missing.png', resolve)).toBe(false)
	})

	it('drops stale cache entries whose exact original no longer matches', () => {
		const stale = embed('old.png', '![[old.png]]', 0)
		expect(cacheEmbedOccurrences('![[new.png]]', [stale])).toEqual([])
		const invalid = embed('not-a-reference', 'not a reference', 0)
		expect(cacheEmbedOccurrences('not a reference', [invalid])).toEqual([])
	})

	it('maps cached positions on later lines and rejects positions past the document', () => {
		const content = 'prefix\n![[old.png]]'
		const later = embed('old.png', '![[old.png]]', 0)
		later.position.start.line = 1
		later.position.start.col = 0
		later.position.start.offset = content.indexOf('!')
		later.position.end.line = 1
		later.position.end.col = later.original.length
		later.position.end.offset = content.length
		expect(cacheEmbedOccurrences(content, [later])[0].start).toBe(content.indexOf('!'))
		const missing = embed('old.png', '![[old.png]]', 0)
		missing.position.start.line = 2
		missing.position.start.col = 0
		expect(cacheEmbedOccurrences(content, [missing])).toEqual([])
	})

	it('skips unresolved cached embeds while grouping', () => {
		const value = '![[missing.png]]'
		expect(groupCachedAttachments(value, [embed('missing.png', value, 0)], (): { path: string } | null => null)).toEqual([])
	})

	it('groups already mapped occurrences without remapping positions', () => {
		const value = '![[mapped.png]]'
		const mapped = cacheEmbedOccurrences(value, [embed('mapped.png', value, 0)])
		expect(groupCachedAttachments(value, mapped, link => ({ path: link }))).toEqual([{ file: { path: 'mapped.png' } }])
		expect(cacheReferenceOccurrences(value, [embed('mapped.png', value, 0), embed('mapped.png', value, 0)])).toHaveLength(1)
	})

	it('uses only exact provenance spans when duplicate counts change or content moves', () => {
		const old = '![[old.pdf]]\n![[old.pdf]]'
		const occurrences = cacheEmbedOccurrences(old, [
			embed('old.pdf', '![[old.pdf]]', 0),
			embed('old.pdf', '![[old.pdf]]', 13),
		])
		const overlapping = cacheReferenceOccurrences('![[old.pdf]]', [
			embed('old.pdf', '![[old.pdf]]', 0),
			embed('old.pdf', '[[old.pdf]]', 1),
		])
		const current = retargetCachedOccurrences(occurrences, { wiki: 'new.pdf', markdown: 'new.pdf' })
		expect(replaceRetargetedCachedOccurrences('![[old.pdf]]', occurrences, current)).toBe('![[new.pdf]]')
		expect(replaceRetargetedCachedOccurrences('prefix\n![[old.pdf]]', occurrences, current)).toBe('prefix\n![[old.pdf]]')
		expect(replaceRetargetedCachedOccurrences('![[old.pdf]]', overlapping, retargetCachedOccurrences(overlapping, { wiki: 'new.pdf', markdown: 'new.pdf' }))).toBe('![[new.pdf]]')
	})

	it('retargets only the final filename while preserving raw parents and syntax', () => {
		const content = [
			'![[folder/old.png|Report]]',
			'![Alt](folder/old.png "Title")',
			'![Alt](<folder/old.png>)',
		].join('\n')
		const originals = ['![[folder/old.png|Report]]', '![Alt](folder/old.png "Title")', '![Alt](<folder/old.png>)']
		const occurrences = cacheEmbedOccurrences(content, originals.map(original => embed('folder/old.png', original, content.indexOf(original))))
		const current = retargetCachedOccurrences(occurrences, {
			wiki: 'attachments/new (1).png',
			markdown: 'attachments/new%20%281%29.png',
		})
		expect(current.map(occurrence => occurrence.original)).toEqual([
			'![[attachments/new (1).png|Report]]',
			'![Alt](attachments/new%20%281%29.png "Title")',
			'![Alt](<attachments/new%20%281%29.png>)',
		])
		expect(replaceRetargetedCachedOccurrences(content, occurrences, current)).toBe([
			'![[attachments/new (1).png|Report]]',
			'![Alt](attachments/new%20%281%29.png "Title")',
			'![Alt](<attachments/new%20%281%29.png>)',
		].join('\n'))
		expect(replaceRetargetedCachedOccurrences(content, occurrences, [])).toBe(content)
		expect(retargetCachedOccurrences([{ ...occurrences[0], original: 'not a reference' }], { wiki: 'new.png', markdown: 'new.png' })[0].original).toBe('not a reference')
		expect(replaceRetargetedCachedOccurrences(content, occurrences, [{ ...current[0], original: 'not a reference' }])).toBe(content)
	})

	it('preserves fragments and returns current destination offsets', () => {
		const content = '![[old.png#^block|Report]]\n[Alt](old.png?download=1#page=2 "Title")'
		const originals = ['![[old.png#^block|Report]]', '[Alt](old.png?download=1#page=2 "Title")']
		const occurrences = cacheReferenceOccurrences(content, originals.map(original => embed('old.png', original, content.indexOf(original))))
		const current = retargetCachedOccurrences(occurrences, { wiki: 'folder/new.png', markdown: 'folder/new%20file.png' })
		expect(current.map(occurrence => occurrence.original)).toEqual([
			'![[folder/new.png#^block|Report]]',
			'[Alt](folder/new%20file.png?download=1#page=2 "Title")',
		])
		expect(current[0].destinationEnd - current[0].destinationStart).toBe('folder/new.png#^block'.length)
		expect(current[1].destinationEnd - current[1].destinationStart).toBe('folder/new%20file.png?download=1#page=2'.length)
		expect(current[0].end - current[0].start).toBe(current[0].original.length)
		const bare = cacheReferenceOccurrences('![[old.png^block]]', [embed('old.png', '![[old.png^block]]', 0)])
		const bareCurrent = retargetCachedOccurrences(bare, { wiki: 'new.png', markdown: 'new.png' })
		expect(bareCurrent[0].original).toBe('![[new.png^block]]')
	})

	it('encodes fallback Markdown destinations exactly once', () => {
		expect(encodeMarkdownDestination('folder/a b(1).png')).toBe('folder/a%20b%281%29.png')
		expect(encodeMarkdownDestination('../folder/already%20raw.png')).toBe('../folder/already%2520raw.png')
	})

	it('uses actual Markdown destinations and disambiguated wiki fallback', () => {
		expect(deriveRetargetDestinations('folder/new (1).png', '[new](folder/new%20%281%29.png)', '../folder/new (1).png')).toEqual({
			wiki: 'folder/new (1).png',
			markdown: 'folder/new%20%281%29.png',
		})
		expect(deriveRetargetDestinations('folder/new (1).png', '[[folder/new (1).png]]', '../folder/new (1).png')).toEqual({
			wiki: 'folder/new (1).png',
			markdown: '../folder/new%20%281%29.png',
		})
		expect(deriveRetargetDestinations('new.png', '[[new.png]]', 'new.png')).toEqual({
			wiki: 'new.png',
			markdown: 'new.png',
		})
	})

	it('updates only duplicate occurrences with matching prepared provenance', () => {
		const old = '![[old.pdf]]\n![[old.pdf]]'
		const oldOccurrences = cacheEmbedOccurrences(old, [
			embed('old.pdf', '![[old.pdf]]', 0),
			embed('old.pdf', '![[old.pdf]]', 13),
		])
		const current = retargetCachedOccurrences(oldOccurrences, { wiki: 'new.pdf', markdown: 'new.pdf' })
		expect(replaceRetargetedCachedOccurrences('![[old.pdf]]', oldOccurrences, current)).toBe('![[new.pdf]]')
		const three = `${old}\n![[old.pdf]]`
		expect(replaceRetargetedCachedOccurrences(three, oldOccurrences, current)).toBe('![[new.pdf]]\n![[new.pdf]]\n![[old.pdf]]')
		const deletedLive = '<!-- ![[old.pdf]] -->'
		expect(replaceRetargetedCachedOccurrences(deletedLive, oldOccurrences, current)).toBe(deletedLive)
	})

	it('rebases later duplicate occurrences when retargeted destinations change length', () => {
		const content = '![[old.png]]\n- ![[old.png]]'
		const oldOccurrences = cacheEmbedOccurrences(content, [
			embed('old.png', '![[old.png]]', 0),
			embed('old.png', '![[old.png]]', content.lastIndexOf('!')),
		])
		const longer = retargetCachedOccurrences(oldOccurrences, {
			wiki: 'assets/a-much-longer-name.png',
			markdown: 'assets/a-much-longer-name.png',
		})
		const longerContent = replaceRetargetedCachedOccurrences(content, oldOccurrences, longer)
		expect(longerContent.slice(longer[1].start, longer[1].end)).toBe(longer[1].original)

		const shorter = retargetCachedOccurrences(longer, { wiki: 'a.png', markdown: 'a.png' })
		const shorterContent = replaceRetargetedCachedOccurrences(longerContent, longer, shorter)
		expect(shorterContent.slice(shorter[1].start, shorter[1].end)).toBe(shorter[1].original)
	})

})
