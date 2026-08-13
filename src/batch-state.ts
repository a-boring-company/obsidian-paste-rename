export interface BatchRenameTask {
	id: string
	proposedName: string
}

export type BatchChoice = 'rename' | 'cancel'

export interface BatchDecision {
	id: string
	action: BatchChoice
	name: string
}

export interface BatchChoiceState {
	remaining: BatchRenameTask[]
}

export function createBatchChoiceState(tasks: BatchRenameTask[]): BatchChoiceState {
	return { remaining: [...tasks] }
}

export function applyBatchChoice(
	state: BatchChoiceState,
	choice: BatchChoice,
	options: { applyToRemaining?: boolean; name?: string } = {},
): { state: BatchChoiceState; decisions: BatchDecision[] } {
	const [current, ...remaining] = state.remaining
	if (!current) return { state: { remaining: [] }, decisions: [] }
	const selected = options.applyToRemaining ? [current, ...remaining] : [current]
	const decisions = selected.map((task, index) => ({
		id: task.id,
		action: choice,
		name: choice === 'rename' && options.name && (!options.applyToRemaining || index === 0) ? options.name : task.proposedName,
	}))
	return {
		state: { remaining: options.applyToRemaining ? [] : remaining },
		decisions,
	}
}
