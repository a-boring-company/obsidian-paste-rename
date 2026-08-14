export interface BatchScanState {
	token: number
	closed: boolean
	ready: boolean
}

export interface BatchScanInput {
	namePattern: string
	extPattern: string
	nameReplace: string
}

export function createBatchScanState(): BatchScanState {
	return { token: 0, closed: false, ready: false }
}

export function beginBatchScan(state: BatchScanState): number {
	state.ready = false
	state.token++
	return state.token
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
	state.closed = true
	state.token++
}

export function supersedeBatchScan(state: BatchScanState): void {
	state.ready = false
	state.token++
}

export function isCurrentBatchScan(state: BatchScanState, token: number): boolean {
	return !state.closed && state.token === token
}

export function isCurrentBatchScanInput(captured: BatchScanInput, current: BatchScanInput): boolean {
	return captured.namePattern === current.namePattern
		&& captured.extPattern === current.extPattern
		&& captured.nameReplace === current.nameReplace
}
