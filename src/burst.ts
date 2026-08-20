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

export interface ExactBurstMutationResult<T> {
	applied: T[]
	failed: T[]
}

export interface CreateBurstCoordinationResult<T> {
	mode: 'bounded' | 'exact'
	resolved: Array<T & { occurrences: CachedEmbedOccurrence[] }>
	unresolved: T[]
	applied: Array<T & { occurrences: CachedEmbedOccurrence[] }>
	failed: Array<T & { occurrences: CachedEmbedOccurrence[] }>
}

type MaybePromise<T> = T | Promise<T>

export async function coordinateExactBurstDecisions<T extends { id: string }>(
	tasks: readonly T[],
	decisions: readonly CreateBurstDecision[],
	refreshOccurrences: (task: T) => MaybePromise<readonly CachedEmbedOccurrence[] | null>,
	applyMutation: (task: T, occurrences: readonly CachedEmbedOccurrence[], decision: CreateBurstDecision) => MaybePromise<boolean | void>,
): Promise<ExactBurstMutationResult<T>> {
	const taskById = new Map(tasks.map(task => [task.id, task]))
	const applied: T[] = []
	const failed: T[] = []
	for (const decision of decisions) {
		const task = taskById.get(decision.id)
		if (!task) continue
		const occurrences = await refreshOccurrences(task)
		if (!occurrences || occurrences.length === 0) {
			failed.push(task)
			continue
		}
		const mutationResult = await applyMutation(task, occurrences, decision)
		if (mutationResult === false) failed.push(task)
		else applied.push(task)
	}
	return { applied, failed }
}

export async function coordinateCreateBurst<T extends { id: string; file: { path: string } }>(
	tasks: readonly T[],
	occurrencesByPath: ReadonlyMap<string, readonly CachedEmbedOccurrence[]>,
	decisions: readonly CreateBurstDecision[],
	refreshOccurrences: (task: T) => MaybePromise<readonly CachedEmbedOccurrence[] | null>,
	applyMutation: (task: T, occurrences: readonly CachedEmbedOccurrence[], decision: CreateBurstDecision) => MaybePromise<boolean | void>,
): Promise<CreateBurstCoordinationResult<T>> {
	const plan = planCreateBurst(tasks, occurrencesByPath)
	if (plan.mode === 'bounded') return { mode: 'bounded', resolved: [], unresolved: [], applied: [], failed: [] }
	const result = await coordinateExactBurstDecisions<T & { occurrences: CachedEmbedOccurrence[] }>(plan.resolved, decisions, refreshOccurrences, applyMutation)
	return { mode: 'exact', resolved: plan.resolved, unresolved: plan.unresolved, ...result }
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
