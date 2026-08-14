export interface LatestRequestState {
	token: number
	closed: boolean
}

export function createLatestRequestState(): LatestRequestState {
	return { token: 0, closed: false }
}

export function beginLatestRequest(state: LatestRequestState): number {
	state.token++
	return state.token
}

export function invalidateLatestRequest(state: LatestRequestState): void {
	state.closed = true
	state.token++
}

export function isLatestRequest(state: LatestRequestState, token: number): boolean {
	return !state.closed && state.token === token
}
