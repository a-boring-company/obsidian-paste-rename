import { describe, expect, it } from 'vitest'
import type { TFile } from 'obsidian'

import { updateVaultText } from '../src/vault-text'

describe('vault text compatibility update', () => {
	it('uses the atomic process API when available', async () => {
		const calls: string[] = []
		const vault = {
			read: async () => 'old',
			cachedRead: async () => 'old',
			modify: async () => { calls.push('modify') },
			process: async (_file: unknown, transform: (value: string) => string) => {
				calls.push(transform('old'))
				return 'new'
			},
		}
		await updateVaultText(vault, {} as TFile, value => `${value}!`)
		expect(calls).toEqual(['old!'])
	})

	it('reads and modifies when the process API is unavailable', async () => {
		const calls: string[] = []
		const vault = {
			read: async () => 'disk',
			cachedRead: async () => { throw new Error('stale cache should not be read') },
			modify: async (_file: unknown, value: string) => { calls.push(value) },
		}
		await updateVaultText(vault, {} as TFile, value => `${value}!`)
		expect(calls).toEqual(['disk!'])
	})
})
