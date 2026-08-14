interface BurstCancellation {
	cancelled: boolean
	generation: number
}

export function createBurstCancellation(): BurstCancellation {
	return { cancelled: false, generation: 0 }
}

export function cancelBurst(state: BurstCancellation): void {
	state.cancelled = true
	state.generation += 1
}

export function isBurstCancelled(state: BurstCancellation, generation: number): boolean {
	return state.cancelled || state.generation !== generation
}
