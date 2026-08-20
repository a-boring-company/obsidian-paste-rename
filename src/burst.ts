import type { CachedEmbedOccurrence } from './batch-occurrences'

interface BurstCancellation {
	cancelled: boolean
	generation: number
}

export type CreateBurstPlan<T> =
	| { mode: 'bounded'; tasks: readonly T[] }
	| { mode: 'exact'; resolved: Array<T & { occurrences: CachedEmbedOccurrence[] }>; unresolved: T[] }

export interface CreateBurstDecision {
	id: string
	action: 'rename' | 'cancel'
	name: string
}

export type ExactBurstMutationStatus = 'success' | 'not-applied' | 'renamed-but-unsynchronized'

export interface ExactBurstMutationResult<T> {
	applied: T[]
	failed: T[]
	renamedButUnsynchronized: T[]
}

type MaybePromise<T> = T | Promise<T>

export async function coordinateExactBurstDecisions<T extends { id: string }>(
	tasks: readonly T[],
	decisions: readonly CreateBurstDecision[],
	refreshOccurrences: (task: T) => MaybePromise<readonly CachedEmbedOccurrence[] | null>,
	applyMutation: (task: T, occurrences: readonly CachedEmbedOccurrence[], decision: CreateBurstDecision) => MaybePromise<boolean | void | ExactBurstMutationStatus>,
): Promise<ExactBurstMutationResult<T>> {
	const taskById = new Map(tasks.map(task => [task.id, task]))
	const applied: T[] = []
	const failed: T[] = []
	const renamedButUnsynchronized: T[] = []
	for (const decision of decisions) {
		const task = taskById.get(decision.id)
		if (!task) continue
		const occurrences = await refreshOccurrences(task)
		if (!occurrences || occurrences.length === 0) {
			failed.push(task)
			continue
		}
		const mutationResult = await applyMutation(task, occurrences, decision)
		if (mutationResult === false || mutationResult === 'not-applied') failed.push(task)
		else if (mutationResult === 'renamed-but-unsynchronized') {
			failed.push(task)
			renamedButUnsynchronized.push(task)
		} else applied.push(task)
	}
	return { applied, failed, renamedButUnsynchronized }
}

export function summarizeExactBurstOutcome<T>(result: ExactBurstMutationResult<T>): string | null {
	const renamedCount = result.renamedButUnsynchronized.length
	const skippedCount = result.failed.length - renamedCount
	const notices: string[] = []
	if (renamedCount > 0) {
		notices.push(`Renamed ${renamedCount} attachment${renamedCount === 1 ? '' : 's'}, but references could not be synchronized`)
	}
	if (skippedCount > 0) {
		notices.push(`${notices.length > 0 ? 'skipped' : 'Skipped'} ${skippedCount} attachment${skippedCount === 1 ? '' : 's'} because its exact reference could not be synchronized`)
	}
	return notices.length > 0 ? `${notices.join('; ')}.` : null
}

export function summarizeExactSourcePreparationFailure(taskCount: number, _failure: string): string {
	return `Skipped ${taskCount} attachment${taskCount === 1 ? '' : 's'} because the active note could not be synchronized`
}

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
