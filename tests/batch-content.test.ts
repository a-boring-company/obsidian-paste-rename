import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { advanceBatchEditorBaseline, BatchMetadataLedger, batchCommitEditorState, batchDiskContentAllowed, expectedBatchNativeContent, fingerprintUtf16Sha256, fullDocumentChange, hasBatchEditorOwnership, prepareExactSourceSnapshot, replaceBatchFigureContent, rollbackBatchSourceWrite } from '../src/batch-content'
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

	it('rejects figure conversion when exact provenance is unavailable', () => {
		expect(replaceBatchFigureContent('unchanged', '<figure>new</figure>', 'assets/new.png', [])).toBeNull()
		expect(replaceBatchFigureContent('![[assets/old.png]]', '<figure>new</figure>', 'assets/new.png', [{
			link: 'assets/old.png', original: '![[assets/old.png]]', start: 1, end: 20, destinationStart: 4, destinationEnd: 19,
		}])).toBeNull()
	})

	it('rolls back an interim exact-source write after cache preparation fails', async () => {
		let disk = 'editor baseline'
		let baselineAdvances = 0
		let writes = 0
		let cachePolls = 0
		const file = {} as import('obsidian').TFile
		const vault = {
			process: async (_file: unknown, transform: (content: string) => string) => { disk = transform(disk); return disk },
			read: async (_file: unknown) => disk,
		}
		const result = await prepareExactSourceSnapshot({
			snapshot: 'editor snapshot',
			disk: 'editor baseline',
			isCurrent: () => true,
			writeSnapshot: async () => {
				writes += 1
				return compareAndWriteVaultText(vault, file, content => content === 'editor baseline', () => true, 'editor snapshot')
			},
			readExactCache: (): null => {
				cachePolls += 1
				return null
			},
			readDisk: async () => disk,
			rollbackSnapshot: () => rollbackBatchSourceWrite(vault, file, 'editor snapshot', 'editor baseline'),
			advanceBaseline: () => {
				baselineAdvances += 1
				return true
			},
			retries: 2,
			wait: async () => {},
		})

		expect(result).toEqual({ value: null, failure: 'synchronize' })
		expect(writes).toBe(1)
		expect(cachePolls).toBe(2)
		expect(disk).toBe('editor baseline')
		expect(baselineAdvances).toBe(0)
	})

	it('returns the exact cached snapshot and advances the baseline only after disk agreement', async () => {
		let baselineAdvances = 0
		const cache = { fingerprint: 'exact' }
		const result = await prepareExactSourceSnapshot({
			snapshot: 'same',
			disk: 'same',
			isCurrent: () => true,
			writeSnapshot: async () => { throw new Error('must not write an unchanged snapshot') },
			readExactCache: () => cache,
			readDisk: async () => 'same',
			rollbackSnapshot: async () => false,
			advanceBaseline: () => { baselineAdvances += 1; return true },
		})
		expect(result).toEqual({ value: cache, failure: null })
		expect(baselineAdvances).toBe(1)
	})

	it('returns cancellation before any exact-source write when the generation is stale', async () => {
		let writes = 0
		const result = await prepareExactSourceSnapshot({
			snapshot: 'snapshot',
			disk: 'baseline',
			isCurrent: () => false,
			writeSnapshot: async () => { writes += 1; return 'written' as const },
			readExactCache: (): null => null,
			readDisk: async () => 'snapshot',
			rollbackSnapshot: async () => true,
			advanceBaseline: () => true,
		})
		expect(result).toEqual({ value: null, failure: 'cancelled' })
		expect(writes).toBe(0)
	})

	it.each([
		['conflict', 'synchronize'],
		['cancelled', 'cancelled'],
	] as const)('returns %s write failure without attempting rollback', async (writeResult, failure) => {
		let rollbacks = 0
		const result = await prepareExactSourceSnapshot({
			snapshot: 'snapshot',
			disk: 'baseline',
			isCurrent: () => true,
			writeSnapshot: async () => writeResult,
			readExactCache: (): null => null,
			readDisk: async () => 'snapshot',
			rollbackSnapshot: async () => { rollbacks += 1; return true },
			advanceBaseline: () => true,
		})
		expect(result).toEqual({ value: null, failure })
		expect(rollbacks).toBe(0)
	})

	it('returns synchronization failure when the interim source write throws', async () => {
		let rollbacks = 0
		const result = await prepareExactSourceSnapshot({
			snapshot: 'snapshot',
			disk: 'baseline',
			isCurrent: () => true,
			writeSnapshot: async () => { throw new Error('write failed') },
			readExactCache: (): null => null,
			readDisk: async () => 'snapshot',
			rollbackSnapshot: async () => { rollbacks += 1; return true },
			advanceBaseline: () => true,
		})
		expect(result).toEqual({ value: null, failure: 'synchronize' })
		expect(rollbacks).toBe(1)
	})

	it('returns synchronization when a rejected write left the original disk snapshot', async () => {
		let rollbacks = 0
		const result = await prepareExactSourceSnapshot({
			snapshot: 'snapshot',
			disk: 'baseline',
			isCurrent: () => true,
			writeSnapshot: async () => { throw new Error('write rejected before persistence') },
			readExactCache: (): null => null,
			readDisk: async () => 'baseline',
			rollbackSnapshot: async () => { rollbacks += 1; return true },
			advanceBaseline: () => true,
		})
		expect(result).toEqual({ value: null, failure: 'synchronize' })
		expect(rollbacks).toBe(0)
	})

	it.each([
		['unknown', async (): Promise<string> => 'external'],
		['unreadable', async (): Promise<string> => { throw new Error('read failed') }],
	] as const)('returns rollback when a rejected write is %s to verify', async (_label, readDisk) => {
		let rollbacks = 0
		const result = await prepareExactSourceSnapshot({
			snapshot: 'snapshot',
			disk: 'baseline',
			isCurrent: () => true,
			writeSnapshot: async () => { throw new Error('write rejected') },
			readExactCache: (): null => null,
			readDisk,
			rollbackSnapshot: async () => { rollbacks += 1; return true },
			advanceBaseline: () => true,
		})
		expect(result).toEqual({ value: null, failure: 'rollback' })
		expect(rollbacks).toBe(0)
	})

	it('returns rollback when a rejected applied write cannot be restored', async () => {
		let rollbacks = 0
		const result = await prepareExactSourceSnapshot({
			snapshot: 'snapshot',
			disk: 'baseline',
			isCurrent: () => true,
			writeSnapshot: async () => { throw new Error('write rejected after persistence') },
			readExactCache: (): null => null,
			readDisk: async () => 'snapshot',
			rollbackSnapshot: async () => { rollbacks += 1; return false },
			advanceBaseline: () => true,
		})
		expect(result).toEqual({ value: null, failure: 'rollback' })
		expect(rollbacks).toBe(1)
	})

	it('rolls back when cancellation happens immediately after the interim write', async () => {
		let checks = 0
		let rollbacks = 0
		const result = await prepareExactSourceSnapshot({
			snapshot: 'snapshot',
			disk: 'baseline',
			isCurrent: () => ++checks === 1,
			writeSnapshot: async () => 'written',
			readExactCache: (): null => null,
			readDisk: async () => 'snapshot',
			rollbackSnapshot: async () => { rollbacks += 1; return true },
			advanceBaseline: () => true,
		})
		expect(result).toEqual({ value: null, failure: 'cancelled' })
		expect(rollbacks).toBe(1)
	})

	it('rejects a cached snapshot when the disk never reaches the same fingerprint', async () => {
		let waits = 0
		const result = await prepareExactSourceSnapshot({
			snapshot: 'snapshot',
			disk: 'snapshot',
			isCurrent: () => true,
			writeSnapshot: async () => 'written',
			readExactCache: () => ({ fingerprint: 'exact' }),
			readDisk: async () => 'different',
			rollbackSnapshot: async () => false,
			advanceBaseline: () => true,
			retries: 2,
			wait: async () => { waits += 1 },
		})
		expect(result).toEqual({ value: null, failure: 'synchronize' })
		expect(waits).toBe(1)
	})

	it('rolls back when the editor drifts while reading the post-cache disk snapshot', async () => {
		let current = true
		let rollbacks = 0
		const result = await prepareExactSourceSnapshot({
			snapshot: 'snapshot',
			disk: 'baseline',
			isCurrent: () => true,
			isSnapshotCurrent: () => current,
			writeSnapshot: async () => 'written',
			readExactCache: () => ({ fingerprint: 'exact' }),
			readDisk: async () => { current = false; return 'snapshot' },
			rollbackSnapshot: async () => { rollbacks += 1; return true },
			advanceBaseline: () => true,
		})

		expect(result).toEqual({ value: null, failure: 'cancelled' })
		expect(rollbacks).toBe(1)
	})

	it('continues polling when cache or disk reads fail and reports a baseline failure', async () => {
		let cacheReads = 0
		const result = await prepareExactSourceSnapshot({
			snapshot: 'same',
			disk: 'same',
			isCurrent: () => true,
			writeSnapshot: async () => 'written',
			readExactCache: () => {
				cacheReads += 1
				if (cacheReads === 1) throw new Error('cache unavailable')
				return { fingerprint: 'exact' }
			},
			readDisk: async () => { throw new Error('disk unavailable') },
			rollbackSnapshot: async () => false,
			advanceBaseline: () => false,
			retries: 2,
			wait: async () => {},
		})
		expect(result).toEqual({ value: null, failure: 'synchronize' })
		expect(cacheReads).toBe(2)
	})

	it('cancels after an exact cache match if the generation changes before commit', async () => {
		let checks = 0
		const result = await prepareExactSourceSnapshot({
			snapshot: 'same',
			disk: 'same',
			isCurrent: () => ++checks < 3,
			writeSnapshot: async () => 'written',
			readExactCache: () => ({ fingerprint: 'exact' }),
			readDisk: async () => 'same',
			rollbackSnapshot: async () => false,
			advanceBaseline: () => true,
		})
		expect(result).toEqual({ value: null, failure: 'cancelled' })
	})

	it('reports cancellation when the baseline cannot advance after exact cache agreement', async () => {
		const result = await prepareExactSourceSnapshot({
			snapshot: 'same',
			disk: 'same',
			isCurrent: () => true,
			writeSnapshot: async () => 'written',
			readExactCache: () => ({ fingerprint: 'exact' }),
			readDisk: async () => 'same',
			rollbackSnapshot: async () => false,
			advanceBaseline: () => false,
		})
		expect(result).toEqual({ value: null, failure: 'cancelled' })
	})

	it('reports rollback when a written snapshot cannot be restored', async () => {
		const result = await prepareExactSourceSnapshot({
			snapshot: 'snapshot',
			disk: 'baseline',
			isCurrent: () => true,
			writeSnapshot: async () => 'written',
			readExactCache: (): null => null,
			readDisk: async () => 'snapshot',
			rollbackSnapshot: async () => { throw new Error('rollback unavailable') },
			advanceBaseline: () => true,
			retries: 1,
		})
		expect(result).toEqual({ value: null, failure: 'rollback' })
	})

	it('stops polling when the generation changes between exact-cache attempts', async () => {
		let checks = 0
		const result = await prepareExactSourceSnapshot({
			snapshot: 'same',
			disk: 'same',
			isCurrent: () => ++checks === 1,
			writeSnapshot: async () => 'written',
			readExactCache: (): null => null,
			readDisk: async () => 'same',
			rollbackSnapshot: async () => false,
			advanceBaseline: () => true,
			retries: 2,
			wait: async () => {},
		})
		expect(result).toEqual({ value: null, failure: 'cancelled' })
	})

	it('returns cancellation when the final exact-cache attempt observes a stale generation', async () => {
		let checks = 0
		const result = await prepareExactSourceSnapshot({
			snapshot: 'same',
			disk: 'same',
			isCurrent: () => ++checks < 3,
			writeSnapshot: async () => 'written',
			readExactCache: (): null => null,
			readDisk: async () => 'same',
			rollbackSnapshot: async () => false,
			advanceBaseline: () => true,
			retries: 1,
		})
		expect(result).toEqual({ value: null, failure: 'cancelled' })
	})

	it('returns synchronization failure when the polling delay rejects', async () => {
		const result = await prepareExactSourceSnapshot({
			snapshot: 'same',
			disk: 'same',
			isCurrent: () => true,
			writeSnapshot: async () => 'written',
			readExactCache: (): null => null,
			readDisk: async () => 'same',
			rollbackSnapshot: async () => false,
			advanceBaseline: () => true,
			retries: 2,
			wait: async () => { throw new Error('timer failed') },
		})
		expect(result).toEqual({ value: null, failure: 'synchronize' })
	})

	it('reports rollback failure when the guarded source write cannot be restored', async () => {
	const file = {} as import('obsidian').TFile
		const unchangedVault = {
			process: async (_file: unknown, transform: (content: string) => string) => transform('unchanged'),
			read: async (_file: unknown) => 'different',
		}
		expect(await rollbackBatchSourceWrite(unchangedVault, file, 'snapshot', 'baseline')).toBe(false)
		const throwingVault = {
			process: async (_file: unknown, _transform: (content: string) => string): Promise<string> => { throw new Error('write failed') },
			read: async (_file: unknown) => 'snapshot',
		}
		expect(await rollbackBatchSourceWrite(throwingVault, file, 'snapshot', 'baseline')).toBe(false)
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
		for (let index = 0; index < 10000; index++) ledger.record(`notes/${index}.md`, `content-${index}\uD800`, cache)
		expect(ledger.exact('notes/0.md', 'content-0\uD800')).toBe(cache)
		expect(ledger.exact('notes/9999.md', 'content-9999\uD800')).toBe(cache)
		expect(ledger.exact('notes/10000.md', 'content-10000\uD800')).toBeNull()
		expect(ledger.exact('notes/9999.md', 'stale')).toBeNull()

		const largeNote = deterministicCodeUnits(2 * 1024 * 1024)
		const largeFingerprint = fingerprintUtf16Sha256(largeNote)
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
