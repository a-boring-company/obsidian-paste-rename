import { beginLatestRequest, createLatestRequestState, invalidateLatestRequest, isLatestRequest, LatestRequestState } from './latest-request'

export interface BatchScanState {
	request: LatestRequestState
	ready: boolean
}

export function createBatchScanState(): BatchScanState {
	return { request: createLatestRequestState(), ready: false }
}

export function beginBatchScan(state: BatchScanState): number {
	state.ready = false
	return beginLatestRequest(state.request)
}

export function publishBatchScan(state: BatchScanState, taskCount: number): boolean {
	state.ready = taskCount > 0
	return state.ready
}

export function canRenameBatch(state: BatchScanState): boolean {
	return state.ready
}

export function invalidateBatchScan(state: BatchScanState): void {
	state.ready = false
	invalidateLatestRequest(state.request)
}

export function isCurrentBatchScan(state: BatchScanState, token: number): boolean {
	return isLatestRequest(state.request, token)
}
