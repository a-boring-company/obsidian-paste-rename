import type { CachedEmbedOccurrence } from './batch-occurrences'

interface BurstCancellation {
	cancelled: boolean
	generation: number
}

export type CreateBurstPlan<T> =
	| { mode: 'bounded'; tasks: readonly T[] }
	| { mode: 'exact'; resolved: Array<T & { occurrences: CachedEmbedOccurrence[] }>; unresolved: T[] }

export function planCreateBurst<T extends { file: { path: string } }>(
	tasks: readonly T[],
	occurrencesByPath: ReadonlyMap<string, readonly CachedEmbedOccurrence[]>,
): CreateBurstPlan<T> {
	if (tasks.length < 2) return { mode: 'bounded', tasks }

	const resolved: Array<T & { occurrences: CachedEmbedOccurrence[] }> = []
	const unresolved: T[] = []
	for (const task of tasks) {
		const occurrences = occurrencesByPath.get(task.file.path)
		if (!occurrences || occurrences.length === 0) {
			unresolved.push(task)
			continue
		}
		resolved.push({ ...task, occurrences: [...occurrences] })
	}
	return { mode: 'exact', resolved, unresolved }
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
