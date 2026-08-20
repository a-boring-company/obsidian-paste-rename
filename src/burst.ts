import type { CachedEmbedOccurrence } from './batch-occurrences'
import { applyBatchChoice, createBatchChoiceState } from './batch-state'

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
	notApplied: T[]
	renamedButUnsynchronized: T[]
}

type MaybePromise<T> = T | Promise<T>

interface OrchestratedCreateTask {
	id: string
	file: { path: string }
	proposedName: string
	autoRename: boolean
	isMeaningful: boolean
}

interface CreateBurstChoice {
	action: 'rename' | 'cancel'
	name?: string
	applyToRemaining: boolean
}

export type ExactBurstPreparation<C> =
	| { context: C; occurrencesByPath: ReadonlyMap<string, readonly CachedEmbedOccurrence[]> }
	| { failure: string }

interface CreateBurstOperations<T, C> {
	prepareExact: () => MaybePromise<ExactBurstPreparation<C>>
	choose: (task: T, hasRemaining: boolean) => MaybePromise<CreateBurstChoice>
	applyBounded: (task: T, decision: CreateBurstDecision, notify: true) => MaybePromise<void>
	refreshOccurrences: (context: C, task: T) => MaybePromise<readonly CachedEmbedOccurrence[] | null>
	applyExact: (
		context: C,
		task: T,
		occurrences: readonly CachedEmbedOccurrence[],
		decision: CreateBurstDecision,
		notify: false,
	) => MaybePromise<boolean | ExactBurstMutationStatus>
	isCurrent: () => boolean
	notify: (message: string) => void
}

export async function orchestrateCreateBurst<T extends OrchestratedCreateTask, C>(
	tasks: readonly T[],
	operations: CreateBurstOperations<T, C>,
): Promise<ExactBurstMutationResult<T> | null> {
	if (!operations.isCurrent()) return null
	const taskById = new Map(tasks.map(task => [task.id, task]))
	let context: C | null = null
	let activeTasks = tasks
	const outcome: ExactBurstMutationResult<T> = { applied: [], notApplied: [], renamedButUnsynchronized: [] }
	const exact = tasks.length > 1
	if (exact) {
		const prepared = await operations.prepareExact()
		if ('failure' in prepared) {
			outcome.notApplied.push(...tasks)
			if (operations.isCurrent()) operations.notify(prepared.failure)
			return outcome
		}
		context = prepared.context
		const plan = planCreateBurst(tasks, prepared.occurrencesByPath) as Extract<CreateBurstPlan<T>, { mode: 'exact' }>
		activeTasks = plan.resolved
		outcome.notApplied.push(...plan.unresolved)
	}

	const interruptedResult = exact ? outcome : null
	let state = createBatchChoiceState(activeTasks.map(task => ({ id: task.id, proposedName: task.proposedName })))
	while (state.remaining.length) {
		if (!operations.isCurrent()) return interruptedResult
		const current = taskById.get(state.remaining[0].id) as T
		const choice = current.autoRename && current.isMeaningful
			? { action: 'rename' as const, name: current.proposedName, applyToRemaining: false }
			: await operations.choose(current, state.remaining.length > 1)
		if (!operations.isCurrent()) return interruptedResult
		const selected = applyBatchChoice(state, choice.action, choice)
		state = selected.state
		for (const decision of selected.decisions) {
			if (!operations.isCurrent()) return interruptedResult
			const task = taskById.get(decision.id) as T
			if (!exact) {
				await operations.applyBounded(task, decision, true)
				if (!operations.isCurrent()) return interruptedResult
				continue
			}
			const occurrences = await operations.refreshOccurrences(context as C, task)
			if (!operations.isCurrent()) return outcome
			if (!occurrences?.length) {
				outcome.notApplied.push(task)
				continue
			}
			const mutation = await operations.applyExact(context as C, task, occurrences, decision, false)
			if (!operations.isCurrent()) return outcome
			if (mutation === false || mutation === 'not-applied') outcome.notApplied.push(task)
			else if (mutation === 'renamed-but-unsynchronized') outcome.renamedButUnsynchronized.push(task)
			else outcome.applied.push(task)
		}
	}
	if (!exact) return null
	if (!operations.isCurrent()) return outcome
	const notice = summarizeExactBurstOutcome(outcome)
	if (notice) operations.notify(notice)
	return outcome
}

export function summarizeExactBurstOutcome<T>(result: ExactBurstMutationResult<T>): string | null {
	const renamedCount = result.renamedButUnsynchronized.length
	const skippedCount = result.notApplied.length
	const notices: string[] = []
	if (renamedCount > 0) {
		notices.push(`Renamed ${renamedCount} attachment${renamedCount === 1 ? '' : 's'}, but references could not be synchronized`)
	}
	if (skippedCount > 0) {
		notices.push(`${notices.length > 0 ? 'skipped' : 'Skipped'} ${skippedCount} attachment${skippedCount === 1 ? '' : 's'} because the requested change${skippedCount === 1 ? '' : 's'} could not be applied`)
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
