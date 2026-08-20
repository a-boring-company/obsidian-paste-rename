import { describe, expect, it } from 'vitest'

import { cancelBurst, coordinateCreateBurst, coordinateExactBurstDecisions, createBurstCancellation, isBurstCancelled, planCreateBurst } from '../src/burst'
import { cacheEmbedOccurrences } from '../src/batch-occurrences'
import { replaceBatchFigureContent } from '../src/batch-content'

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

describe('create burst coordination', () => {
	const occurrence = (content: string, path: string) => {
		const original = `![[${path}]]`
		const start = content.indexOf(original)
		return {
			link: path,
			original,
			start,
			end: start + original.length,
			destinationStart: start + 3,
			destinationEnd: start + 3 + path.length,
		}
	}

	it('keeps one-file routing bounded without invoking exact coordination', async () => {
		const task = { id: 'one', file: { path: 'assets/one.png' } }
		const result = await coordinateCreateBurst([task], new Map([['assets/one.png', [occurrence('![[assets/one.png]]', 'assets/one.png')]]]), [], () => {
			throw new Error('bounded routing must not refresh exact provenance')
		}, () => {
			throw new Error('bounded routing must not apply exact mutations')
		})
		expect(result).toMatchObject({ mode: 'bounded', unresolved: [], applied: [], failed: [] })
	})

	it('reports one exact synchronization failure while excluding unresolved tasks from decisions', async () => {
		const first = { id: 'first', file: { path: 'assets/first.png' } }
		const unresolved = { id: 'missing', file: { path: 'assets/missing.png' } }
		const refreshed: string[] = []
		const applied: string[] = []
		const result = await coordinateCreateBurst(
			[first, unresolved],
			new Map([['assets/first.png', [occurrence('![[assets/first.png]]', 'assets/first.png')]]]),
			[{ id: 'missing', action: 'cancel', name: '' }, { id: 'first', action: 'rename', name: 'first-new' }],
			task => {
			refreshed.push(task.id)
			return task.id === 'first' ? [occurrence('![[assets/first.png]]', 'assets/first.png')] : null
		},
		(task, _occurrences, decision) => {
			applied.push(`${task.id}:${decision.action}`)
		},
		)
		expect(result.unresolved.map(task => task.id)).toEqual(['missing'])
		expect(result.failed).toEqual([])
		expect(refreshed).toEqual(['first'])
		expect(applied).toEqual(['first:rename'])

		const failed = await coordinateExactBurstDecisions(
			[first, { id: 'last', file: { path: 'assets/last.png' } }],
			[{ id: 'first', action: 'cancel', name: '' }, { id: 'last', action: 'cancel', name: '' }],
			task => task.id === 'first' ? null : [occurrence('![[assets/last.png]]', 'assets/last.png')],
			() => undefined,
		)
		expect(failed.failed.map(task => task.id)).toEqual(['first'])
		expect(failed.applied.map(task => task.id)).toEqual(['last'])
		const mutationFailure = await coordinateExactBurstDecisions(
			[first],
			[{ id: 'first', action: 'rename', name: 'failed' }],
			task => [occurrence('![[assets/first.png]]', task.file.path)],
			() => false,
		)
		expect(mutationFailure.failed.map(task => task.id)).toEqual(['first'])
	})

	it('refreshes exact provenance before each cancel in a cancel-all sequence', async () => {
		const first = { id: 'first', file: { path: 'assets/first.png' } }
		const second = { id: 'second', file: { path: 'assets/second.png' } }
		let content = '![[assets/first.png]]\n![[assets/second.png]]'
		const result = await coordinateExactBurstDecisions(
			[first, second],
			[{ id: 'first', action: 'cancel', name: '' }, { id: 'second', action: 'cancel', name: '' }],
			task => cacheEmbedOccurrences(content, [{ link: task.file.path, original: `![[${task.file.path}]]`, position: {
				start: { line: content.slice(0, content.indexOf(`![[${task.file.path}]]`)).split('\n').length - 1, col: 0, offset: content.indexOf(`![[${task.file.path}]]`) },
				end: { line: content.slice(0, content.indexOf(`![[${task.file.path}]]`)).split('\n').length - 1, col: `![[${task.file.path}]]`.length, offset: content.indexOf(`![[${task.file.path}]]`) + `![[${task.file.path}]]`.length },
			} }]),
			(task, occurrences) => {
				content = replaceBatchFigureContent(content, `<figure>${task.id}</figure>`, task.file.path, occurrences)
			},
		)
		expect(result.failed).toEqual([])
		expect(content).toBe('<figure>first</figure>\n\n<figure>second</figure>')
	})

	it('preserves rename and cancel decision order while refreshing each task', async () => {
		const tasks = [
			{ id: 'rename', file: { path: 'assets/rename.png' } },
			{ id: 'cancel', file: { path: 'assets/cancel.png' } },
		]
		const applied: string[] = []
		const result = await coordinateExactBurstDecisions(tasks, [
			{ id: 'rename', action: 'rename', name: 'renamed' },
			{ id: 'cancel', action: 'cancel', name: '' },
		], task => [occurrence(`![[${task.file.path}]]`, task.file.path)], (task, _occurrences, decision) => {
			applied.push(`${task.id}:${decision.action}`)
		})
		expect(result.failed).toEqual([])
		expect(applied).toEqual(['rename:rename', 'cancel:cancel'])
	})
})
