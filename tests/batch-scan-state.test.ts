import { describe, expect, it } from 'vitest'

import { beginBatchScan, canRenameBatch, createBatchScanState, invalidateBatchScan, isCurrentBatchScan, isCurrentBatchScanInput, publishBatchScan, supersedeBatchScan } from '../src/batch-scan-state'

describe('batch scan state', () => {
	it('clears readiness for a new scan and publishes only the winning result', () => {
		const state = createBatchScanState()
		expect(state).toEqual({ token: 0, closed: false, ready: false })
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
		const afterClose = beginBatchScan(state)
		expect(isCurrentBatchScan(state, afterClose)).toBe(false)
	})

	it('rejects publishing a scan based on fields edited while it awaited', () => {
		const captured = { namePattern: 'old', extPattern: 'png', nameReplace: 'new' }
		expect(isCurrentBatchScanInput(captured, { ...captured })).toBe(true)
		expect(isCurrentBatchScanInput(captured, { ...captured, nameReplace: 'changed' })).toBe(false)
	})

	it('supersedes pending and published results without closing future scans', () => {
		const state = createBatchScanState()
		const pending = beginBatchScan(state)
		supersedeBatchScan(state)
		expect(isCurrentBatchScan(state, pending)).toBe(false)
		const next = beginBatchScan(state)
		expect(publishBatchScan(state, 1)).toBe(true)
		expect(isCurrentBatchScan(state, next)).toBe(true)
		supersedeBatchScan(state)
		expect(canRenameBatch(state)).toBe(false)
		const afterPublished = beginBatchScan(state)
		expect(publishBatchScan(state, 1)).toBe(true)
		expect(isCurrentBatchScan(state, afterPublished)).toBe(true)
	})
})
