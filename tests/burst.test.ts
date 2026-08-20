import { describe, expect, it } from 'vitest'

import { cancelBurst, coordinateExactBurstDecisions, createBurstCancellation, isBurstCancelled, planCreateBurst, summarizeExactBurstOutcome, summarizeExactSourcePreparationFailure } from '../src/burst'
import { cacheEmbedOccurrences } from '../src/batch-occurrences'
import { replaceBatchAttachmentContent, replaceBatchFigureContent } from '../src/batch-content'
import { retargetCachedOccurrences } from '../src/batch-occurrences'

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

	const exactOccurrence = (content: string, path: string) => cacheEmbedOccurrences(content, [{
		link: path,
		original: `![[${path}]]`,
		position: {
			start: { line: content.slice(0, content.indexOf(`![[${path}]]`)).split('\n').length - 1, col: content.indexOf(`![[${path}]]`) - content.lastIndexOf('\n', content.indexOf(`![[${path}]]`) - 1) - 1, offset: content.indexOf(`![[${path}]]`) },
			end: { line: content.slice(0, content.indexOf(`![[${path}]]`)).split('\n').length - 1, col: content.indexOf(`![[${path}]]`) - content.lastIndexOf('\n', content.indexOf(`![[${path}]]`) - 1) - 1 + `![[${path}]]`.length, offset: content.indexOf(`![[${path}]]`) + `![[${path}]]`.length },
		},
	}])[0]

	it('keeps one-file routing bounded without invoking exact coordination', async () => {
		const task = { id: 'one', file: { path: 'assets/one.png' } }
		const result = planCreateBurst([task], new Map([['assets/one.png', [occurrence('![[assets/one.png]]', 'assets/one.png')]]]))
		expect(result).toEqual({ mode: 'bounded', tasks: [task] })
	})

	it('reports one exact synchronization failure while excluding unresolved tasks from decisions', async () => {
		const first = { id: 'first', file: { path: 'assets/first.png' } }
		const unresolved = { id: 'missing', file: { path: 'assets/missing.png' } }
		const refreshed: string[] = []
		const applied: string[] = []
		const plan = planCreateBurst(
			[first, unresolved],
			new Map([['assets/first.png', [occurrence('![[assets/first.png]]', 'assets/first.png')]]]),
		)
		expect(plan.mode).toBe('exact')
		if (plan.mode !== 'exact') return
		expect(plan.unresolved.map(task => task.id)).toEqual(['missing'])
		const result = await coordinateExactBurstDecisions(
			plan.resolved,
			[{ id: 'missing', action: 'cancel', name: '' }, { id: 'first', action: 'rename', name: 'first-new' }],
			task => {
			refreshed.push(task.id)
			return task.id === 'first' ? [occurrence('![[assets/first.png]]', 'assets/first.png')] : null
		},
		(task, _occurrences, decision) => {
			applied.push(`${task.id}:${decision.action}`)
		},
		)
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

	it('refreshes the later cancel occurrence after a longer rename link', async () => {
		const oldPath = 'assets/short.png'
		const newPath = 'assets/a-much-longer-name.png'
		const cancelPath = 'assets/cancel.png'
		const tasks = [
			{ id: 'rename', file: { path: oldPath } },
			{ id: 'cancel', file: { path: cancelPath } },
		]
		const decisions = [
			{ id: 'rename', action: 'rename' as const, name: newPath },
			{ id: 'cancel', action: 'cancel' as const, name: '' },
		]
		let content = `![[${oldPath}]]\n![[${cancelPath}]]`
		const applied: string[] = []
		const result = await coordinateExactBurstDecisions(tasks, decisions, task => [exactOccurrence(content, task.file.path)], (task, occurrences, decision) => {
			applied.push(`${task.id}:${decision.action}`)
			if (decision.action === 'rename') {
				const currentOccurrences = retargetCachedOccurrences(occurrences, { wiki: newPath, markdown: newPath })
				const next = replaceBatchAttachmentContent(content, oldPath, newPath, 'short', 'a-much-longer-name', occurrences, currentOccurrences)
				if (next === content) return false
				content = next
				return true
			}
			const next = replaceBatchFigureContent(content, '<figure>cancel</figure>', task.file.path, occurrences)
			if (next === null) return false
			content = next
			return true
		})

		expect(result.failed).toEqual([])
		expect(applied).toEqual(['rename:rename', 'cancel:cancel'])
		expect(content).toBe(`![[${newPath}]]\n<figure>cancel</figure>`)
	})

	it('refreshes the later rename occurrence after an earlier cancel expands its link', async () => {
		const renamePath = 'assets/rename.png'
		const newPath = 'assets/a-much-longer-name.png'
		const cancelPath = 'assets/cancel.png'
		const tasks = [
			{ id: 'cancel', file: { path: renamePath } },
			{ id: 'rename', file: { path: cancelPath } },
		]
		const decisions = [
			{ id: 'cancel', action: 'cancel' as const, name: '' },
			{ id: 'rename', action: 'rename' as const, name: newPath },
		]
		let content = `![[${renamePath}]]\n![[${cancelPath}]]`
		const applied: string[] = []
		const result = await coordinateExactBurstDecisions(tasks, decisions, task => [exactOccurrence(content, task.file.path)], (task, occurrences, decision) => {
			applied.push(`${task.id}:${decision.action}`)
			if (decision.action === 'cancel') {
				const next = replaceBatchFigureContent(content, '<figure>cancel</figure>', task.file.path, occurrences)
				if (next === null) return false
				content = next
				return true
			}
			const currentOccurrences = retargetCachedOccurrences(occurrences, { wiki: newPath, markdown: newPath })
			const next = replaceBatchAttachmentContent(content, cancelPath, newPath, 'cancel', 'a-much-longer-name', occurrences, currentOccurrences)
			if (next === content) return false
			content = next
			return true
		})

		expect(result.failed).toEqual([])
		expect(applied).toEqual(['cancel:cancel', 'rename:rename'])
		expect(content).toBe(`<figure>cancel</figure>\n\n![[${newPath}]]`)
	})

	it('returns a distinct renamed-but-unsynchronized result for one aggregate notice', async () => {
		const task = { id: 'rename', file: { path: 'assets/rename.png' } }
		const result = await coordinateExactBurstDecisions(
			[task],
			[{ id: task.id, action: 'rename', name: 'renamed' }],
			currentTask => [occurrence(`![[${currentTask.file.path}]]`, currentTask.file.path)],
			() => 'renamed-but-unsynchronized',
		)

		expect(result.applied).toEqual([])
		expect(result.failed).toEqual([task])
		expect(result.renamedButUnsynchronized).toEqual([task])
		expect(summarizeExactBurstOutcome(result)).toBe('Renamed 1 attachment, but references could not be synchronized.')
	})

	it('combines renamed and not-applied outcomes into one exact-burst summary', async () => {
		const renamed = { id: 'renamed', file: { path: 'assets/renamed.png' } }
		const skipped = { id: 'skipped', file: { path: 'assets/skipped.png' } }
		const result = await coordinateExactBurstDecisions(
			[renamed, skipped],
			[
				{ id: renamed.id, action: 'rename', name: 'new-name' },
				{ id: skipped.id, action: 'cancel', name: '' },
			],
			currentTask => [occurrence(`![[${currentTask.file.path}]]`, currentTask.file.path)],
			currentTask => currentTask.id === renamed.id ? 'renamed-but-unsynchronized' : 'not-applied',
		)

		expect(summarizeExactBurstOutcome(result)).toBe(
			'Renamed 1 attachment, but references could not be synchronized; skipped 1 attachment because its exact reference could not be synchronized.',
		)
	})

	it('omits empty summaries and pluralizes aggregate exact outcomes', () => {
		expect(summarizeExactBurstOutcome({ applied: [], failed: [], renamedButUnsynchronized: [] })).toBeNull()
		expect(summarizeExactBurstOutcome({ applied: [], failed: [{ id: 'skipped' }], renamedButUnsynchronized: [] })).toBe('Skipped 1 attachment because its exact reference could not be synchronized.')
		expect(summarizeExactBurstOutcome({
			applied: [],
			failed: [{ id: 'renamed-a' }, { id: 'renamed-b' }, { id: 'skipped-a' }, { id: 'skipped-b' }],
			renamedButUnsynchronized: [{ id: 'renamed-a' }, { id: 'renamed-b' }],
		})).toBe('Renamed 2 attachments, but references could not be synchronized; skipped 2 attachments because its exact reference could not be synchronized.')
	})

	it('summarizes one exact preflight failure with singular grammar', () => {
		expect(summarizeExactSourcePreparationFailure(1, 'synchronize')).toBe('Skipped 1 attachment because the active note could not be synchronized')
	})
})
