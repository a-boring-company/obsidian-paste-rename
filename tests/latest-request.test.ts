import { describe, expect, it } from 'vitest'

import { beginLatestRequest, createLatestRequestState, invalidateLatestRequest, isLatestRequest } from '../src/latest-request'

describe('latest request state', () => {
	it('accepts only the newest request and invalidates it on close', () => {
		const state = createLatestRequestState()
		const first = beginLatestRequest(state)
		const second = beginLatestRequest(state)
		expect(isLatestRequest(state, first)).toBe(false)
		expect(isLatestRequest(state, second)).toBe(true)
		invalidateLatestRequest(state)
		expect(isLatestRequest(state, second)).toBe(false)
	})
})
