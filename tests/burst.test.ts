import { describe, expect, it } from 'vitest'

import { cancelBurst, createBurstCancellation, isBurstCancelled, planCreateBurst } from '../src/burst'

describe('burst cancellation generation', () => {
	it('reports the cancelled generation', () => {
		const cancellation = createBurstCancellation()
		cancelBurst(cancellation)
		expect(cancellation.generation).toBe(1)
		expect(isBurstCancelled(cancellation, 0)).toBe(true)
	})

	it('keeps an active generation usable', () => {
		const cancellation = createBurstCancellation()
		expect(isBurstCancelled(cancellation, 0)).toBe(false)
		expect(isBurstCancelled(cancellation, 1)).toBe(true)
	})
})

describe('create burst planning', () => {
	it('keeps one task bounded and partitions multi-task bursts in task order', () => {
		const first = { id: 'first', file: { path: 'assets/first.png' } }
		const unresolved = { id: 'unresolved', file: { path: 'assets/missing.png' } }
		const last = { id: 'last', file: { path: 'assets/last.png' } }
		const occurrence = {
			link: 'assets/first.png',
			original: '![[assets/first.png]]',
			start: 0,
			end: 22,
			destinationStart: 3,
			destinationEnd: 19,
		}
		const occurrencesByPath = new Map([
			['assets/first.png', [occurrence]],
			['assets/last.png', [{ ...occurrence, link: 'assets/last.png' }]],
		])

		expect(planCreateBurst([first], occurrencesByPath)).toEqual({ mode: 'bounded', tasks: [first] })

		const boundaryPlan = planCreateBurst([first, unresolved], occurrencesByPath)
		expect(boundaryPlan.mode).toBe('exact')
		if (boundaryPlan.mode === 'exact') {
			expect(boundaryPlan.resolved.map(task => task.id)).toEqual(['first'])
			expect(boundaryPlan.unresolved).toEqual([unresolved])
		}

		const plan = planCreateBurst([first, unresolved, last], occurrencesByPath)
		expect(plan.mode).toBe('exact')
		if (plan.mode !== 'exact') return
		expect(plan.resolved.map(task => task.id)).toEqual(['first', 'last'])
		expect(plan.resolved.map(task => task.occurrences[0].link)).toEqual(['assets/first.png', 'assets/last.png'])
		expect(plan.unresolved).toEqual([unresolved])
	})
})
