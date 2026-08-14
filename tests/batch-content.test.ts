import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { advanceBatchEditorBaseline, BatchMetadataLedger, batchCommitEditorState, batchDiskContentAllowed, expectedBatchNativeContent, fingerprintUtf16Sha256, fullDocumentChange, hasBatchEditorOwnership } from '../src/batch-content'
import { liveBatchAttachmentChange } from '../src/batch-content'
import { cacheEmbedOccurrences, retargetCachedOccurrences } from '../src/batch-occurrences'
import { renderFigure } from '../src/figure'
import { compareAndWriteVaultText } from '../src/vault-text'

function cachedEmbed(content: string, original: string) {
	const start = content.indexOf(original)
	return cacheEmbedOccurrences(content, [{
		link: original.includes('old.pdf') ? 'old.pdf' : 'old.png',
		original,
		position: {
			start: { line: content.slice(0, start).split('\n').length - 1, col: start - content.lastIndexOf('\n', start - 1) - 1, offset: start },
			end: { line: content.slice(0, start).split('\n').length - 1, col: start - content.lastIndexOf('\n', start - 1) - 1 + original.length, offset: start + original.length },
		},
	}])
}

function nodeUtf16Sha256(value: string): string {
	const bytes = Buffer.alloc(value.length * 2)
	for (let index = 0; index < value.length; index++) bytes.writeUInt16BE(value.charCodeAt(index), index * 2)
	return createHash('sha256').update(bytes).digest('hex')
}

function deterministicCodeUnits(length: number): string {
	let seed = 0x12345678
	const units: string[] = []
	for (let index = 0; index < length; index++) {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
		units.push(String.fromCharCode(seed & 0xffff))
	}
	return units.join('')
}

describe('batch source content', () => {
	it('creates a guarded full-document transaction range', () => {
		expect(fullDocumentChange('one\ntwo', 'one\nthree')).toEqual({
		from: { line: 0, ch: 0 }, to: { line: 1, ch: 3 }, text: 'one\nthree',
	})
		expect(fullDocumentChange('same', 'same')).toBeNull()
	})

	it('updates a stale figure after native maintenance changes another live-editor link', () => {
		const oldFigure = renderFigure({ src: 'assets/old.png', stem: 'old' })
		const newFigure = renderFigure({ src: 'assets/new.png', stem: 'new' })
		const current = `![[assets/new.pdf|Report]]\n${oldFigure}`
		const change = liveBatchAttachmentChange(current, 'assets/old.png', 'assets/new.png', 'old', 'new')

		expect(change).not.toBeNull()
		expect(change?.text).toBe(`![[assets/new.pdf|Report]]\n${newFigure}`)
	})

	it('recomputes against the latest editor text before applying the transaction', () => {
		const oldFigure = renderFigure({ src: 'assets/old.png', stem: 'old' })
		const newFigure = renderFigure({ src: 'assets/new.png', stem: 'new' })
		const latestEditor = `ordinary text changed during rename\n${oldFigure}`
		const change = liveBatchAttachmentChange(latestEditor, 'assets/old.png', 'assets/new.png', 'old', 'new')
		expect(change?.text).toBe(`ordinary text changed during rename\n${newFigure}`)
	})

	it('updates old embedded destinations together with generated figures', () => {
		const oldFigure = renderFigure({ src: 'assets/old.png', stem: 'old' })
		const newFigure = renderFigure({ src: 'assets/new.png', stem: 'new' })
		const current = `![[assets/old.pdf|Report]]\n${oldFigure}`
		const oldOccurrences = cachedEmbed(current, '![[assets/old.pdf|Report]]')
		const change = liveBatchAttachmentChange(current, 'assets/old.png', 'assets/new.png', 'old', 'new', oldOccurrences, retargetCachedOccurrences(oldOccurrences, { wiki: 'assets/new.pdf', markdown: 'assets/new.pdf' }))

		expect(change?.text).toBe(`![[assets/new.pdf|Report]]\n${newFigure}`)
	})

	it('accepts only the captured baseline or exact native-link variant', () => {
		const baseline = '![[assets/old.pdf|Report]]'
		const oldOccurrences = cachedEmbed(baseline, baseline)
		const currentOccurrences = retargetCachedOccurrences(oldOccurrences, { wiki: 'assets/new.pdf', markdown: 'assets/new.pdf' })
		const nativeCurrent = expectedBatchNativeContent(baseline, oldOccurrences, currentOccurrences)
		expect(nativeCurrent).toBe('![[assets/new.pdf|Report]]')
		expect(batchDiskContentAllowed(baseline, baseline, nativeCurrent)).toBe(true)
		expect(batchDiskContentAllowed(nativeCurrent, baseline, nativeCurrent)).toBe(true)
		expect(batchDiskContentAllowed('EXTERNAL EDIT\n' + nativeCurrent, baseline, nativeCurrent)).toBe(false)
	})

	it('fingerprints exact UTF-16 units and retains every metadata event', () => {
		const cache = {} as import('obsidian').CachedMetadata
		const samples = ['', 'plain ASCII', 'emoji 😀', '\uD800', '\uDC00', 'a\uD800b\uDC00', '\u0000\r\n']
		for (const sample of samples) expect(fingerprintUtf16Sha256(sample)).toBe(nodeUtf16Sha256(sample))
		for (const length of [27, 28, 31, 32, 55, 56, 63, 64]) {
			const sample = deterministicCodeUnits(length)
			expect(fingerprintUtf16Sha256(sample)).toBe(nodeUtf16Sha256(sample))
		}
		for (const length of [257, 4097]) {
			const sample = deterministicCodeUnits(length)
			expect(fingerprintUtf16Sha256(sample)).toBe(nodeUtf16Sha256(sample))
		}

		const ledger = new BatchMetadataLedger()
		const start = performance.now()
		for (let index = 0; index < 10000; index++) ledger.record(`notes/${index}.md`, `content-${index}\uD800`, cache)
		const elapsedMs = performance.now() - start
		console.info(`BatchMetadataLedger 10k-event benchmark: ${elapsedMs.toFixed(2)}ms`)
		expect(Number.isFinite(elapsedMs)).toBe(true)
		expect(ledger.exact('notes/0.md', 'content-0\uD800')).toBe(cache)
		expect(ledger.exact('notes/9999.md', 'content-9999\uD800')).toBe(cache)
		expect(ledger.exact('notes/10000.md', 'content-10000\uD800')).toBeNull()
		expect(ledger.exact('notes/9999.md', 'stale')).toBeNull()

		const largeNote = deterministicCodeUnits(2 * 1024 * 1024)
		const largeStart = performance.now()
		const largeFingerprint = fingerprintUtf16Sha256(largeNote)
		const largeElapsedMs = performance.now() - largeStart
		console.info(`BatchMetadataLedger 2MiB-note fingerprint benchmark: ${largeElapsedMs.toFixed(2)}ms`)
		expect(Number.isFinite(largeElapsedMs)).toBe(true)
		expect(largeFingerprint).toBe(nodeUtf16Sha256(largeNote))

		const invalidated = new BatchMetadataLedger()
		invalidated.record('notes/source.md', 'same', cache)
		invalidated.invalidate('notes/source.md')
		expect(invalidated.exact('notes/source.md', 'same')).toBeNull()
		invalidated.record('notes/source.md', 'same', cache)
		invalidated.invalidateRename('notes/source.md', 'notes/renamed.md')
		expect(invalidated.exact('notes/source.md', 'same')).toBeNull()
		invalidated.record('notes/renamed.md', 'same', cache)
		invalidated.clear()
		expect(invalidated.exact('notes/renamed.md', 'same')).toBeNull()
	})

	it('preserves Markdown image labels and titles while updating the destination', () => {
		const current = '![Report](assets/old.pdf "Title")'
		const oldOccurrences = cachedEmbed(current, current)
		const change = liveBatchAttachmentChange(current, 'assets/old.png', 'assets/new.png', 'old', 'new', oldOccurrences, retargetCachedOccurrences(oldOccurrences, { wiki: 'assets/new.pdf', markdown: 'assets/new.pdf' }))

		expect(change?.text).toBe('![Report](assets/new.pdf "Title")')
	})

	it('uses an actual generated shortest link for wiki destinations', () => {
		const change = liveBatchAttachmentChange(
			'![[old.png|Report]]', 'assets/old.png', 'assets/new.png', 'old', 'new',
			cachedEmbed('![[old.png|Report]]', '![[old.png|Report]]'),
			retargetCachedOccurrences(cachedEmbed('![[old.png|Report]]', '![[old.png|Report]]'), { wiki: 'new.png', markdown: 'new.png' }),
		)
		expect(change?.text).toBe('![[new.png|Report]]')
	})

	it('keeps the captured source editor bound when focus switches files', () => {
		const sessionEditor = {}
		const sessionView = { filePath: 'notes/source.md', editor: sessionEditor }
		expect(hasBatchEditorOwnership(
			{ filePath: 'notes/source.md', editor: sessionEditor, view: sessionView, baselineContent: '' },
			'notes/source.md', sessionView.filePath, sessionView.editor,
		)).toBe(true)
		expect(hasBatchEditorOwnership(
			{ filePath: 'notes/source.md', editor: sessionEditor, view: sessionView, baselineContent: '' },
			'notes/source.md', 'notes/other.md', {},
		)).toBe(false)
		expect(hasBatchEditorOwnership(null, 'notes/source.md', sessionView.filePath, sessionView.editor)).toBe(false)
	})

	it('keeps the proven baseline after metadata timeout for a new session unsaved edit', async () => {
		const firstEditor = {}
		const view = { filePath: 'notes/source.md', editor: firstEditor, data: 'target 1' }
		const firstSession = { filePath: 'notes/source.md', editor: firstEditor, view, baselineContent: view.data }
		expect(advanceBatchEditorBaseline(firstSession, 'notes/source.md', 'target 1 renamed', view.filePath, view.editor)).toBe(true)
		const secondEditor = {}
		view.editor = secondEditor
		const secondSession = { filePath: 'notes/source.md', editor: secondEditor, view, baselineContent: view.data }
		let disk = view.data
		const vault = { process: async (_file: unknown, transform: (content: string) => string) => disk = transform(disk) }
		expect(await compareAndWriteVaultText(vault, {} as import('obsidian').TFile, content => content === secondSession.baselineContent || content === 'target 2', () => true, 'target 2')).toBe('written')
		expect(disk).toBe('target 2')
	})

	it('does not mutate data on a rebound view while still advancing the plugin baseline', () => {
		const editor = {}
		const view = { filePath: 'notes/source.md', editor, data: 'old' }
		const session = { filePath: 'notes/source.md', editor, view, baselineContent: 'old' }
		view.filePath = 'notes/other.md'
		view.editor = {}
		expect(advanceBatchEditorBaseline(session, 'notes/source.md', 'new', view.filePath, view.editor)).toBe(false)
		expect(session.baselineContent).toBe('new')
		expect(view.data).toBe('old')
	})

	it('updates an owned view after the caller records a post-transform cancellation', () => {
		const editor = {}
		const view = { filePath: 'notes/source.md', editor, data: 'old' }
		const session = { filePath: 'notes/source.md', editor, view, baselineContent: 'old' }
		expect(advanceBatchEditorBaseline(session, 'notes/source.md', 'written', view.filePath, view.editor)).toBe(true)
		expect(session.baselineContent).toBe('written')
		expect(view.data).toBe('written')
	})

	it('classifies only exact captured or committed editor snapshots after a vault commit', () => {
		expect(batchCommitEditorState('old', 'new', 'old')).toBe('captured')
		expect(batchCommitEditorState('old', 'new', 'new')).toBe('committed')
		expect(batchCommitEditorState('old', 'new', 'user edit')).toBe('drifted')
	})

	it('rebases a still-bound session after an external reload', () => {
		const editor = {}
		const view = { filePath: 'notes/source.md', editor, data: 'old' }
		const session = { filePath: 'notes/source.md', editor, view, baselineContent: 'old' }
		expect(advanceBatchEditorBaseline(session, 'notes/source.md', 'reloaded', view.filePath, view.editor)).toBe(true)
		expect(session.baselineContent).toBe('reloaded')
		expect(view.data).toBe('reloaded')
	})
})
