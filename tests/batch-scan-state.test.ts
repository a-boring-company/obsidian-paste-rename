import { describe, expect, it } from 'vitest'

import { beginBatchScan, canRenameBatch, createBatchScanState, invalidateBatchScan, isCurrentBatchScan, publishBatchScan } from '../src/batch-scan-state'

describe('batch scan state', () => {
	it('clears readiness for a new scan and publishes only the winning result', () => {
		const state = createBatchScanState()
		const first = beginBatchScan(state)
		expect(canRenameBatch(state)).toBe(false)
		const second = beginBatchScan(state)
		expect(isCurrentBatchScan(state, first)).toBe(false)
		expect(isCurrentBatchScan(state, second)).toBe(true)
		expect(publishBatchScan(state, 2)).toBe(true)
		expect(canRenameBatch(state)).toBe(true)
		expect(isCurrentBatchScan(state, second)).toBe(true)
	})

	it('keeps Rename all disabled for an empty result and after close', () => {
		const state = createBatchScanState()
		const token = beginBatchScan(state)
		expect(publishBatchScan(state, 0)).toBe(false)
		expect(canRenameBatch(state)).toBe(false)
		invalidateBatchScan(state)
		expect(canRenameBatch(state)).toBe(false)
		expect(isCurrentBatchScan(state, token)).toBe(false)
	})
})
