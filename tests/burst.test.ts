import { describe, expect, it } from 'vitest'

import { cancelBurst, createBurstCancellation, isBurstCancelled, orchestrateCreateBurst, planCreateBurst, summarizeExactBurstOutcome, summarizeExactSourcePreparationFailure } from '../src/burst'
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

describe('create burst orchestration', () => {
	const exactOccurrence = (content: string, path: string) => cacheEmbedOccurrences(content, [{
		link: path,
		original: `![[${path}]]`,
		position: {
			start: { line: content.slice(0, content.indexOf(`![[${path}]]`)).split('\n').length - 1, col: content.indexOf(`![[${path}]]`) - content.lastIndexOf('\n', content.indexOf(`![[${path}]]`) - 1) - 1, offset: content.indexOf(`![[${path}]]`) },
			end: { line: content.slice(0, content.indexOf(`![[${path}]]`)).split('\n').length - 1, col: content.indexOf(`![[${path}]]`) - content.lastIndexOf('\n', content.indexOf(`![[${path}]]`) - 1) - 1 + `![[${path}]]`.length, offset: content.indexOf(`![[${path}]]`) + `![[${path}]]`.length },
		},
	}])[0]

	const task = (id: string, path: string, options: { autoRename?: boolean; meaningful?: boolean } = {}) => ({
		id,
		file: { path },
		proposedName: `${id}.png`,
		autoRename: options.autoRename ?? false,
		isMeaningful: options.meaningful ?? true,
	})

	it('routes one file through the bounded path with user notices enabled', async () => {
		const one = task('one', 'assets/one.png')
		const applied: string[] = []
		const notices: string[] = []
		const result = await orchestrateCreateBurst([one], {
			prepareExact: () => { throw new Error('one file must remain bounded') },
			choose: () => ({ action: 'rename', name: 'chosen.png', applyToRemaining: false }),
			applyBounded: (current, decision, notify) => { applied.push(`${current.id}:${decision.name}:${notify}`) },
			refreshOccurrences: () => { throw new Error('bounded routing must not refresh exact occurrences') },
			applyExact: () => { throw new Error('bounded routing must not apply exact mutations') },
			isCurrent: () => true,
			notify: message => { notices.push(message) },
		})

		expect(result).toBeNull()
		expect(applied).toEqual(['one:chosen.png:true'])
		expect(notices).toEqual([])
	})

	it('routes multiple files exactly, excludes unresolved tasks, and applies cancel-all silently', async () => {
		const first = task('first', 'assets/first.png')
		const second = task('second', 'assets/second.png')
		const unresolved = task('missing', 'assets/missing.png')
		let content = '![[assets/first.png]]\n![[assets/second.png]]'
		const applied: string[] = []
		const refreshed: string[] = []
		const notices: string[] = []
		let choices = 0
		const result = await orchestrateCreateBurst([first, unresolved, second], {
			prepareExact: () => ({
				context: 'exact',
				occurrencesByPath: new Map([
					[first.file.path, [exactOccurrence(content, first.file.path)]],
					[second.file.path, [exactOccurrence(content, second.file.path)]],
				]),
			}),
			choose: () => { choices += 1; return { action: 'cancel', applyToRemaining: true } },
			applyBounded: () => { throw new Error('multi-file routing must not be bounded') },
			refreshOccurrences: (_context, current) => { refreshed.push(current.id); return [exactOccurrence(content, current.file.path)] },
			applyExact: (_context, current, occurrences, decision, notify) => {
				applied.push(`${current.id}:${decision.action}:${notify}`)
				content = replaceBatchFigureContent(content, `<figure>${current.id}</figure>`, current.file.path, occurrences) as string
				return 'success'
			},
			isCurrent: () => true,
			notify: message => { notices.push(message) },
		})

		expect(result).toEqual({ applied: [first, second], notApplied: [unresolved], renamedButUnsynchronized: [] })
		expect(choices).toBe(1)
		expect(refreshed).toEqual(['first', 'second'])
		expect(applied).toEqual(['first:cancel:false', 'second:cancel:false'])
		expect(content).toBe('<figure>first</figure>\n\n<figure>second</figure>')
		expect(notices).toEqual(['Skipped 1 attachment because the requested change could not be applied.'])
	})

	it('refreshes the later cancel occurrence after a longer rename link', async () => {
		const oldPath = 'assets/short.png'
		const newPath = 'assets/a-much-longer-name.png'
		const cancelPath = 'assets/cancel.png'
		const tasks = [task('rename', oldPath, { autoRename: true }), task('cancel', cancelPath)]
		let content = `![[${oldPath}]]\n![[${cancelPath}]]`
		const applied: string[] = []
		await orchestrateCreateBurst(tasks, {
			prepareExact: () => ({ context: 'exact', occurrencesByPath: new Map(tasks.map(current => [current.file.path, [exactOccurrence(content, current.file.path)]])) }),
			choose: () => ({ action: 'cancel', applyToRemaining: false }),
			applyBounded: () => { throw new Error('multi-file routing must not be bounded') },
			refreshOccurrences: (_context, current) => [exactOccurrence(content, current.file.path)],
			applyExact: (_context, current, occurrences, decision) => {
				applied.push(`${current.id}:${decision.action}`)
				if (decision.action === 'rename') {
					const currentOccurrences = retargetCachedOccurrences(occurrences, { wiki: newPath, markdown: newPath })
					const next = replaceBatchAttachmentContent(content, oldPath, newPath, 'short', 'a-much-longer-name', occurrences, currentOccurrences)
					if (next === content) return false
					content = next
					return 'success'
				}
				const next = replaceBatchFigureContent(content, '<figure>cancel</figure>', current.file.path, occurrences)
				if (next === null) return false
				content = next
				return 'success'
			},
			isCurrent: () => true,
			notify: () => {},
		})

		expect(applied).toEqual(['rename:rename', 'cancel:cancel'])
		expect(content).toBe(`![[${newPath}]]\n<figure>cancel</figure>`)
	})

	it('refreshes the later rename occurrence after an earlier cancel expands its link', async () => {
		const renamePath = 'assets/rename.png'
		const newPath = 'assets/a-much-longer-name.png'
		const cancelPath = 'assets/cancel.png'
		const tasks = [task('cancel', renamePath), task('rename', cancelPath, { autoRename: true })]
		let content = `![[${renamePath}]]\n![[${cancelPath}]]`
		const applied: string[] = []
		await orchestrateCreateBurst(tasks, {
			prepareExact: () => ({ context: 'exact', occurrencesByPath: new Map(tasks.map(current => [current.file.path, [exactOccurrence(content, current.file.path)]])) }),
			choose: () => ({ action: 'cancel', applyToRemaining: false }),
			applyBounded: () => { throw new Error('multi-file routing must not be bounded') },
			refreshOccurrences: (_context, current) => [exactOccurrence(content, current.file.path)],
			applyExact: (_context, current, occurrences, decision) => {
				applied.push(`${current.id}:${decision.action}`)
				if (decision.action === 'cancel') {
					const next = replaceBatchFigureContent(content, '<figure>cancel</figure>', current.file.path, occurrences)
					if (next === null) return false
					content = next
					return 'success'
				}
				const currentOccurrences = retargetCachedOccurrences(occurrences, { wiki: newPath, markdown: newPath })
				const next = replaceBatchAttachmentContent(content, cancelPath, newPath, 'cancel', 'a-much-longer-name', occurrences, currentOccurrences)
				if (next === content) return false
				content = next
				return 'success'
			},
			isCurrent: () => true,
			notify: () => {},
		})

		expect(applied).toEqual(['cancel:cancel', 'rename:rename'])
		expect(content).toBe(`<figure>cancel</figure>\n\n![[${newPath}]]`)
	})

	it('aggregates disjoint exact outcomes across separate decisions into one accurate final notice', async () => {
		const renamed = task('renamed', 'assets/renamed.png')
		const skipped = task('skipped', 'assets/skipped.png')
		const content = '![[assets/renamed.png]]\n![[assets/skipped.png]]'
		const choices = [
			{ action: 'rename' as const, name: 'renamed-new.png', applyToRemaining: false },
			{ action: 'rename' as const, name: '', applyToRemaining: false },
		]
		const notices: string[] = []
		const result = await orchestrateCreateBurst([renamed, skipped], {
			prepareExact: () => ({ context: 'exact', occurrencesByPath: new Map([
				[renamed.file.path, [exactOccurrence(content, renamed.file.path)]],
				[skipped.file.path, [exactOccurrence(content, skipped.file.path)]],
			]) }),
			choose: () => choices.shift() as typeof choices[number],
			applyBounded: () => { throw new Error('multi-file routing must not be bounded') },
			refreshOccurrences: (_context, current) => [exactOccurrence(content, current.file.path)],
			applyExact: (_context, current, _occurrences, _decision, notify) => {
				expect(notify).toBe(false)
				return current.id === renamed.id ? 'renamed-but-unsynchronized' : 'not-applied'
			},
			isCurrent: () => true,
			notify: message => { notices.push(message) },
		})

		expect(result).toEqual({ applied: [], notApplied: [skipped], renamedButUnsynchronized: [renamed] })
		expect(notices).toEqual([
			'Renamed 1 attachment, but references could not be synchronized; skipped 1 attachment because the requested change could not be applied.',
		])
	})

	it('omits empty summaries and pluralizes aggregate exact outcomes', () => {
		expect(summarizeExactBurstOutcome({ applied: [], notApplied: [], renamedButUnsynchronized: [] })).toBeNull()
		expect(summarizeExactBurstOutcome({ applied: [], notApplied: [{ id: 'skipped' }], renamedButUnsynchronized: [] })).toBe('Skipped 1 attachment because the requested change could not be applied.')
		expect(summarizeExactBurstOutcome({
			applied: [],
			notApplied: [{ id: 'skipped-a' }, { id: 'skipped-b' }],
			renamedButUnsynchronized: [{ id: 'renamed-a' }, { id: 'renamed-b' }],
		})).toBe('Renamed 2 attachments, but references could not be synchronized; skipped 2 attachments because the requested changes could not be applied.')
		expect(summarizeExactBurstOutcome({
			applied: [],
			notApplied: [],
			renamedButUnsynchronized: [],
			partiallyApplied: [{ id: 'partial-a' }, { id: 'partial-b' }],
		})).toBe('Changed 2 attachments, but references could not be synchronized.')
	})

	it('emits one preparation failure and does not open decisions', async () => {
		const tasks = [task('first', 'assets/first.png'), task('second', 'assets/second.png')]
		const notices: string[] = []
		const result = await orchestrateCreateBurst(tasks, {
			prepareExact: () => ({ failure: 'Skipped 2 attachments because the active note changed' }),
			choose: () => { throw new Error('failed preparation must not open decisions') },
			applyBounded: () => { throw new Error('failed preparation must not apply bounded decisions') },
			refreshOccurrences: () => { throw new Error('failed preparation must not refresh occurrences') },
			applyExact: () => { throw new Error('failed preparation must not apply exact decisions') },
			isCurrent: () => true,
			notify: message => { notices.push(message) },
		})
		expect(result).toEqual({ applied: [], notApplied: tasks, renamedButUnsynchronized: [] })
		expect(notices).toEqual(['Skipped 2 attachments because the active note changed'])
	})

	it('classifies an unavailable refreshed occurrence as not applied', async () => {
		const tasks = [task('missing', 'assets/missing.png'), task('unresolved', 'assets/unresolved.png')]
		const content = '![[assets/missing.png]]'
		const notices: string[] = []
		const result = await orchestrateCreateBurst(tasks, {
			prepareExact: () => ({ context: 'exact', occurrencesByPath: new Map([
				[tasks[0].file.path, [exactOccurrence(content, tasks[0].file.path)]],
			]) }),
			choose: () => ({ action: 'cancel', applyToRemaining: false }),
			applyBounded: () => { throw new Error('multi-file routing must not be bounded') },
			refreshOccurrences: () => null,
			applyExact: () => { throw new Error('missing exact occurrences must not be applied') },
			isCurrent: () => true,
			notify: message => { notices.push(message) },
		})
		expect(result).toEqual({ applied: [], notApplied: [tasks[1], tasks[0]], renamedButUnsynchronized: [] })
		expect(notices).toEqual(['Skipped 2 attachments because the requested changes could not be applied.'])
	})

	it('suppresses work and final notices when the generation becomes stale', async () => {
		const one = task('one', 'assets/one.png')
		const exact = [task('first', 'assets/first.png'), task('second', 'assets/second.png')]
		const exactContent = '![[assets/first.png]]\n![[assets/second.png]]'
		const exactPreparation = {
			context: 'exact',
			occurrencesByPath: new Map(exact.map(current => [current.file.path, [exactOccurrence(exactContent, current.file.path)]])),
		}
		const fail = () => { throw new Error('stale orchestration must stop') }
		const notices: string[] = []
		const stale = () => ({
			prepareExact: fail,
			choose: fail,
			applyBounded: fail,
			refreshOccurrences: fail,
			applyExact: fail,
			isCurrent: () => false,
			notify: (message: string) => { notices.push(message) },
		})
		expect(await orchestrateCreateBurst([one], stale())).toBeNull()

		let checks = 0
		expect(await orchestrateCreateBurst([one], {
			...stale(),
			choose: () => ({ action: 'cancel' as const, applyToRemaining: false }),
			isCurrent: () => ++checks < 3,
		})).toBeNull()
		checks = 0
		expect(await orchestrateCreateBurst([one], {
			...stale(),
			choose: () => ({ action: 'cancel' as const, applyToRemaining: false }),
			isCurrent: () => ++checks < 4,
		})).toBeNull()

		let current = true
		expect(await orchestrateCreateBurst([one], {
			...stale(),
			choose: () => ({ action: 'cancel' as const, applyToRemaining: false }),
			applyBounded: () => { current = false },
			isCurrent: () => current,
		})).toBeNull()

		current = true
		expect(await orchestrateCreateBurst(exact, {
			...stale(),
			prepareExact: () => { current = false; return exactPreparation },
			isCurrent: () => current,
		})).toEqual({ applied: [], notApplied: [], renamedButUnsynchronized: [] })

		current = true
		expect(await orchestrateCreateBurst(exact, {
			...stale(),
			prepareExact: () => {
				current = false
				return { context: 'exact', occurrencesByPath: new Map() }
			},
			isCurrent: () => current,
		})).toEqual({ applied: [], notApplied: exact, renamedButUnsynchronized: [] })
		expect(notices).toEqual([])
	})

	it('stops an apply-to-remaining sequence when cancellation occurs during the first refresh', async () => {
		const tasks = [task('first', 'assets/first.png'), task('second', 'assets/second.png'), task('third', 'assets/third.png')]
		const content = tasks.map(current => `![[${current.file.path}]]`).join('\n')
		let current = true
		const refreshed: string[] = []
		const mutated: string[] = []
		const notices: string[] = []
		const result = await orchestrateCreateBurst(tasks, {
			prepareExact: () => ({
				context: 'exact',
				occurrencesByPath: new Map(tasks.map(currentTask => [currentTask.file.path, [exactOccurrence(content, currentTask.file.path)]])),
			}),
			choose: () => ({ action: 'cancel', applyToRemaining: true }),
			applyBounded: () => { throw new Error('multi-file routing must not be bounded') },
			refreshOccurrences: async (_context, currentTask) => {
				refreshed.push(currentTask.id)
				await Promise.resolve()
				current = false
				return [exactOccurrence(content, currentTask.file.path)]
			},
			applyExact: (_context, currentTask) => { mutated.push(currentTask.id); return 'success' },
			isCurrent: () => current,
			notify: message => { notices.push(message) },
		})

		expect(result).toEqual({ applied: [], notApplied: [], renamedButUnsynchronized: [] })
		expect(refreshed).toEqual(['first'])
		expect(mutated).toEqual([])
		expect(notices).toEqual([])
	})

	it('stops an apply-to-remaining sequence when cancellation occurs during the first mutation', async () => {
		const tasks = [task('first', 'assets/first.png'), task('second', 'assets/second.png'), task('third', 'assets/third.png')]
		const content = tasks.map(current => `![[${current.file.path}]]`).join('\n')
		let current = true
		const refreshed: string[] = []
		const mutated: string[] = []
		const notices: string[] = []
		const result = await orchestrateCreateBurst(tasks, {
			prepareExact: () => ({
				context: 'exact',
				occurrencesByPath: new Map(tasks.map(currentTask => [currentTask.file.path, [exactOccurrence(content, currentTask.file.path)]])),
			}),
			choose: () => ({ action: 'cancel', applyToRemaining: true }),
			applyBounded: () => { throw new Error('multi-file routing must not be bounded') },
			refreshOccurrences: (_context, currentTask) => {
				refreshed.push(currentTask.id)
				return [exactOccurrence(content, currentTask.file.path)]
			},
			applyExact: async (_context, currentTask) => {
				mutated.push(currentTask.id)
				await Promise.resolve()
				current = false
				return 'success' as const
			},
			isCurrent: () => current,
			notify: message => { notices.push(message) },
		})

		expect(result).toEqual({ applied: [], notApplied: [], renamedButUnsynchronized: [] })
		expect(refreshed).toEqual(['first'])
		expect(mutated).toEqual(['first'])
		expect(notices).toEqual([])
	})

	it('summarizes one exact preflight failure with singular grammar', () => {
		expect(summarizeExactSourcePreparationFailure(1, 'synchronize')).toBe('Skipped 1 attachment because the active note could not be synchronized')
		expect(summarizeExactSourcePreparationFailure(2, 'rollback')).toBe('Skipped 2 attachments because the active note could not be synchronized')
	})
})
