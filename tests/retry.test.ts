import { describe, expect, it } from 'vitest'

import { retryBounded } from '../src/retry'

describe('bounded retry', () => {
	it('returns content that appears on a later attempt', async () => {
		let attempt = 0
		expect(await retryBounded(3, async () => ++attempt === 2 ? 'found' : null)).toBe('found')
		expect(attempt).toBe(2)
	})

	it('stops on cancellation and reports exhaustion', async () => {
		let attempt = 0
		let cancelled = false
		expect(await retryBounded(3, async (): Promise<string | null> => { attempt++; cancelled = true; return null }, () => cancelled)).toBeNull()
		expect(attempt).toBe(1)
		cancelled = false
		expect(await retryBounded(2, async (): Promise<string | null> => null)).toBeNull()
	})

	it('does not invoke an already-cancelled attempt', async () => {
		let invoked = false
		expect(await retryBounded(2, async () => { invoked = true; return 'ignored' }, () => true)).toBeNull()
		expect(invoked).toBe(false)
	})
})
