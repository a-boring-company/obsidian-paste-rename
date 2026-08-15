import { describe, expect, it } from 'vitest'

import { applyBatchChoice, createBatchChoiceState } from '../src/batch-state'

describe('batch choice state', () => {
	const tasks = [
		{ id: 'one', proposedName: 'note_one.png' },
		{ id: 'two', proposedName: 'note_two.pdf' },
		{ id: 'three', proposedName: 'note_three.txt' },
	]

	it('renames one task with the entered name and keeps remaining tasks', () => {
		const result = applyBatchChoice(createBatchChoiceState(tasks), 'rename', { name: 'custom.png' })
		expect(result.decisions).toEqual([{ id: 'one', action: 'rename', name: 'custom.png' }])
		expect(result.state.remaining).toEqual(tasks.slice(1))
	})

	it('rename-all uses each task default when no confirmed name is supplied', () => {
		const result = applyBatchChoice(createBatchChoiceState(tasks), 'rename', { applyToRemaining: true })
		expect(result.decisions).toEqual(tasks.map(task => ({ id: task.id, action: 'rename', name: task.proposedName })))
		expect(result.state.remaining).toEqual([])
	})

	it('rename-all keeps the confirmed current name and defaults for remaining tasks', () => {
		const result = applyBatchChoice(createBatchChoiceState(tasks), 'rename', { applyToRemaining: true, name: 'confirmed.png' })
		expect(result.decisions).toEqual([
			{ id: 'one', action: 'rename', name: 'confirmed.png' },
			{ id: 'two', action: 'rename', name: 'note_two.pdf' },
			{ id: 'three', action: 'rename', name: 'note_three.txt' },
		])
	})

	it('cancel-all leaves every remaining name unchanged', () => {
		const result = applyBatchChoice(createBatchChoiceState(tasks), 'cancel', { applyToRemaining: true })
		expect(result.decisions).toEqual(tasks.map(task => ({ id: task.id, action: 'cancel', name: task.proposedName })))
		expect(result.state.remaining).toEqual([])
	})

	it('handles cancel-one, rename without a custom name, and an empty state', () => {
		const state = createBatchChoiceState(tasks)
		const cancelled = applyBatchChoice(state, 'cancel')
		expect(cancelled.decisions).toEqual([{ id: 'one', action: 'cancel', name: 'note_one.png' }])
		const renamed = applyBatchChoice(cancelled.state, 'rename')
		expect(renamed.decisions).toEqual([{ id: 'two', action: 'rename', name: 'note_two.pdf' }])
		expect(applyBatchChoice({ remaining: [] }, 'cancel')).toEqual({
		state: { remaining: [] }, decisions: [],
	})
	})

})
