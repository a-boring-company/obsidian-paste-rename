import { describe, expect, it } from 'vitest'

import { cancelBurst, createBurstCancellation, isBurstCancelled } from '../src/burst'

describe('burst cancellation generation', () => {
	it('reports the cancelled generation', () => {
		const cancellation = createBurstCancellation()
		cancelBurst(cancellation)
		expect(cancellation.generation).toBe(1)
		expect(isBurstCancelled(cancellation, 0)).toBe(true)
	})

	it('keeps an active generation usable', () => {
		const cancellation = createBurstCancellation()
		expect(isBurstCancelled(cancellation, 0)).toBe(false)
		expect(isBurstCancelled(cancellation, 1)).toBe(true)
	})
})
