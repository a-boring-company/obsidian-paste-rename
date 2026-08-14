import { describe, expect, it } from 'vitest'
import type { TFile } from 'obsidian'

import { compareAndWriteVaultText, processVaultText } from '../src/vault-text'

type ProcessVault = {
	process: (_file: unknown, transform: (value: string) => string) => Promise<string>
}

function singleSnapshotVault(snapshot: string, onResult?: (value: string) => void): ProcessVault {
	return {
		process: async (_file, transform) => {
			const result = transform(snapshot)
			onResult?.(result)
			return result
		},
	}
}

describe('atomic vault text updates', () => {
	it('writes the requested text for either exact allowed process snapshot', async () => {
		for (const snapshot of ['baseline', 'native']) {
			let written = ''
			const vault = singleSnapshotVault(snapshot, value => { written = value })
			expect(await compareAndWriteVaultText(vault, {} as TFile, value => value === 'baseline' || value === 'native', () => true, 'next')).toBe('written')
			expect(written).toBe('next')
		}
	})

	it('rejects an external process snapshot without overwriting it', async () => {
		let transformed = ''
		const vault = singleSnapshotVault('external', value => { transformed = value })
		expect(await compareAndWriteVaultText(vault, {} as TFile, value => value === 'baseline' || value === 'native', () => true, 'next')).toBe('conflict')
		expect(transformed).toBe('external')
	})

	it('persists a dirty editor snapshot only from the captured view data baseline', async () => {
		const viewData = 'view baseline'
		let written = ''
		const vault = singleSnapshotVault(viewData, value => { written = value })
		expect(await compareAndWriteVaultText(vault, {} as TFile, value => value === viewData, () => true, 'editor snapshot')).toBe('written')
		expect(written).toBe('editor snapshot')
	})

	it('runs the synchronous editor reconciliation before the committed text is returned', async () => {
		let editor = 'captured'
		let written = ''
		const vault: ProcessVault = {
			process: async (_file, transform) => {
				written = transform('baseline')
				editor += ' user edit'
				return written
			},
		}
		const result = await compareAndWriteVaultText(
			vault,
			{} as TFile,
			value => value === 'baseline',
			() => true,
			'committed',
			() => {
				expect(editor).toBe('captured')
				editor = 'committed'
				return true
			},
		)
		expect(result).toBe('written')
		expect(written).toBe('committed')
		expect(editor).toBe('committed user edit')
	})

	it('leaves the exact editor reconciliation dirty when process fails afterward', async () => {
		let editor = 'captured'
		const vault: ProcessVault = {
			process: async (_file, transform) => {
				transform('baseline')
				throw new Error('process failed after editor update')
			},
		}
		await expect(compareAndWriteVaultText(
			vault,
			{} as TFile,
			value => value === 'baseline',
			() => true,
			'committed',
			() => {
				editor = 'committed'
				return true
			},
		)).rejects.toThrow('process failed after editor update')
		expect(editor).toBe('committed')
	})

	it('rejects the write when synchronous editor reconciliation loses ownership', async () => {
		let transformed = ''
		const vault: ProcessVault = {
			process: async (_file, transform) => {
				transformed = transform('baseline')
				return transformed
			},
		}
		expect(await compareAndWriteVaultText(vault, {} as TFile, value => value === 'baseline', () => true, 'committed', () => false)).toBe('conflict')
		expect(transformed).toBe('baseline')
	})

	it('accepts an autosaved desired snapshot and advances the known baseline for the next edit', async () => {
		let baseline = 'target 1 on disk'
		let disk = baseline
		const vault: ProcessVault = {
			process: async (_file, transform) => { disk = transform(disk); return disk },
		}
		expect(await compareAndWriteVaultText(vault, {} as TFile, content => content === baseline || content === 'target 1 figure', () => true, 'target 1 figure')).toBe('written')
		baseline = disk
		expect(baseline).toBe('target 1 figure')
		expect(await compareAndWriteVaultText(vault, {} as TFile, content => content === baseline || content === 'target 2 edit', () => true, 'target 2 edit')).toBe('written')
		expect(disk).toBe('target 2 edit')
	})

	it('does not overwrite an external disk edit during dirty preflight', async () => {
		const viewData = 'view baseline'
		let written = ''
		const vault: ProcessVault = {
			process: async (_file, transform) => written = transform('external edit'),
		}
		expect(await compareAndWriteVaultText(vault, {} as TFile, value => value === viewData, () => true, 'editor snapshot')).toBe('conflict')
		expect(written).toBe('external edit')
	})

	it('cancels before process and writes nothing', async () => {
		let called = false
		const vault: ProcessVault = {
			process: async (_file, transform) => { called = true; return transform('baseline') },
		}
		expect(await compareAndWriteVaultText(vault, {} as TFile, () => true, () => false, 'next')).toBe('cancelled')
		expect(called).toBe(false)
	})

	it('cancels inside process without changing the current content', async () => {
		let current = true
		let written = ''
		const vault: ProcessVault = {
			process: async (_file, transform) => { current = false; written = transform('baseline'); return written },
		}
		expect(await compareAndWriteVaultText(vault, {} as TFile, () => true, () => current, 'next')).toBe('cancelled')
		expect(written).toBe('baseline')
	})

	it('propagates process failures for the caller to report', async () => {
		const vault: ProcessVault = {
			process: async (): Promise<string> => { throw new Error('process failed') },
		}
		await expect(compareAndWriteVaultText(vault, {} as TFile, () => true, () => true, 'next')).rejects.toThrow('process failed')
	})

	it('runs detached transforms atomically with the same cancellation guard', async () => {
		let current = true
		let written = ''
		const vault: ProcessVault = {
			process: async (_file, transform) => { written = transform('baseline'); return written },
		}
		expect(await processVaultText(vault, {} as TFile, value => `${value}!`, () => current)).toBe('written')
		expect(written).toBe('baseline!')
		current = false
		expect(await processVaultText(vault, {} as TFile, value => `${value}?`, () => current)).toBe('cancelled')
		expect(written).toBe('baseline!')
		current = true
		const cancellingVault: ProcessVault = {
			process: async (_file, transform) => { current = false; written = transform('baseline'); return written },
		}
		expect(await processVaultText(cancellingVault, {} as TFile, value => `${value}?`, () => current)).toBe('cancelled')
		expect(written).toBe('baseline')
	})
})
