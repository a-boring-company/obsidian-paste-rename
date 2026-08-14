import { describe, expect, it } from 'vitest'

import { applyBatchChoice, createBatchChoiceState } from '../src/batch-state'
import {
	mapCursorAfterLineEdit,
	replaceNearCursorInText,
} from '../src/embed-location'
import { replaceAttachmentReference } from '../src/attachment-reference'

	describe('anchored embed replacement', () => {
	it('searches a bounded text window and returns exact multiline coordinates', () => {
		const lines = ['first', 'before ![[image.png]] after', 'third', '![[image.png]]']
		const edit = replaceNearCursorInText({ line: 0, ch: 20 }, lines.length, content => {
			const start = content.indexOf('![[image.png]]')
			if (start < 0) return null
			return { text: `${content.slice(0, start)}<figure>\n</figure>${content.slice(start + 14)}`, start, end: start + 14, replacementText: '<figure>\n</figure>' }
		}, line => lines[line])
		expect(edit?.line).toBe(1)
		expect(edit?.endLine).toBe(1)
		expect(edit?.text).toBe('<figure>\n</figure>')
		expect(replaceNearCursorInText({ line: 0, ch: 0 }, 2, () => null, line => lines[line])).toBeNull()
		expect(replaceNearCursorInText({ line: 0, ch: 0 }, 0, () => null, () => '')).toBeNull()
		expect(replaceNearCursorInText({ line: 0, ch: 0 }, 1, () => ({ text: 'same', start: 0, end: 0, matched: true }), () => 'same')?.matched).toBe(true)
		const farAway = Array.from({ length: 21 }, (_, index) => index === 20 ? '![[image.png]]' : `line ${index}`)
		expect(replaceNearCursorInText({ line: 0, ch: 0 }, farAway.length, content => content.includes('![[image.png]]') ? { text: content, start: 0, end: 0, matched: true } : null, line => farAway[line])).toBeNull()
		const continuation = Array.from({ length: 10 }, (_, index) => index === 9 ? 'outside' : `line ${index}`)
		expect(replaceNearCursorInText({ line: 0, ch: 0 }, continuation.length, (content) => ({ text: 'changed', start: content.indexOf('outside'), end: content.indexOf('outside') + 7, replacementText: 'changed' }), line => continuation[line])).toBeNull()
	})

	it('maps four same-line and four following-line anchors through one-by-one and apply-all edits', () => {
		const embeds = Array.from({ length: 8 }, (_, index) => `![[anchor-${index}.png]]`)
		const initialLine = embeds.slice(0, 4).join(' ')
		const initialLines = [initialLine, ...embeds.slice(4)]
		const initialCursors = embeds.map((embed, index) => ({
			line: index < 4 ? 0 : index - 3,
			ch: index < 4 ? initialLine.indexOf(embed) + embed.length : embed.length,
		}))
		const apply = (applyAll: boolean) => {
			const lines = [...initialLines]
			let cursors = initialCursors.map(cursor => ({ ...cursor }))
			const pending = embeds.map((embed, id) => ({ id: `${id}`, path: embed.slice(3, -2) }))
			const editOne = (pendingItem: typeof pending[number]) => {
				const cursor = cursors[Number(pendingItem.id)]
				const edit = replaceNearCursorInText(cursor, lines.length, content => {
					const marker = `![[${pendingItem.path}]]`
					const start = content.indexOf(marker)
					if (start < 0) return null
					const replacement = `<figure>${pendingItem.id}</figure>`
					return { text: `${content.slice(0, start)}${replacement}${content.slice(start + marker.length)}`, start, end: start + marker.length, replacementText: replacement }
				}, line => lines[line])
				expect(edit).not.toBeNull()
				if (!edit) return
				const before = lines.slice(0, edit.line)
				const after = lines.slice((edit.endLine ?? edit.line) + 1)
				const span = lines.slice(edit.line, (edit.endLine ?? edit.line) + 1).join('\n')
				const prefix = span.slice(0, edit.start)
				const suffix = span.slice(edit.endCh ?? edit.end)
				lines.splice(0, lines.length, ...before, ...`${prefix}${edit.text}${suffix}`.split('\n'), ...after)
				cursors = cursors.map(current => mapCursorAfterLineEdit(current, edit))
			}
			let state = createBatchChoiceState(pending.map(item => ({ id: item.id, proposedName: item.path })))
			if (applyAll) {
				const result = applyBatchChoice(state, 'rename', { applyToRemaining: true })
				result.decisions.forEach(decision => editOne(pending[Number(decision.id)]))
			} else {
				while (state.remaining.length) {
					const result = applyBatchChoice(state, 'rename')
					editOne(pending[Number(result.decisions[0].id)])
					state = result.state
				}
			}
			expect(lines.join('\n')).toContain('<figure>0</figure>')
			expect(lines.join('\n')).toContain('<figure>7</figure>')
		}
		apply(false)
		apply(true)
	})

	it('maps same-line and following-line cursors across a multiline edit', () => {
		const edit = { line: 1, start: 0, end: 14, endLine: 1, endCh: 14, text: '<figure>\n</figure>' }
		expect(mapCursorAfterLineEdit({ line: 1, ch: 15 }, edit)).toEqual({ line: 2, ch: 10 })
		expect(mapCursorAfterLineEdit({ line: 1, ch: 5 }, edit)).toEqual({ line: 2, ch: 9 })
		expect(mapCursorAfterLineEdit({ line: 2, ch: 3 }, edit)).toEqual({ line: 3, ch: 3 })
		expect(mapCursorAfterLineEdit({ line: 1, ch: 0 }, edit)).toEqual({ line: 1, ch: 0 })
		expect(mapCursorAfterLineEdit({ line: 0, ch: 3 }, edit)).toEqual({ line: 0, ch: 3 })
		const fullLineEdit = {
			line: 0,
			start: 7,
			end: 21,
			endLine: 0,
			endCh: 21,
			text: '\n<figure>\n</figure>\n',
		}
		expect(mapCursorAfterLineEdit({ line: 0, ch: 22 }, fullLineEdit)).toEqual({ line: 3, ch: 1 })
		expect(mapCursorAfterLineEdit({ line: 1, ch: 5 }, edit)).toEqual({ line: 2, ch: 9 })
	})

	it('continues one line past each bounded anchor for multiline references only', () => {
		const replace = (content: string, cursor: number) => replaceAttachmentReference({
			content,
			cursor,
			targetPaths: ['image.png'],
			replacement: '![alt](new.png)',
			replacementPath: 'new.png',
			image: true,
			asFigure: false,
		})
		const upper = Array.from({ length: 11 }, (_, line) => line === 8 ? '![alt](image.png' : line === 9 ? '"title")' : line === 10 ? '![alt](standalone.png)' : `line ${line}`)
		const upperEdit = replaceNearCursorInText({ line: 0, ch: 0 }, upper.length, (content, cursor) => replace(content, cursor), line => upper[line])
		expect(upperEdit?.line).toBe(8)
		expect(upperEdit?.endLine).toBe(8)

		const lower = Array.from({ length: 21 }, (_, line) => line === 18 ? '![alt](image.png' : line === 19 ? '"title")' : line === 20 ? '![alt](standalone.png)' : `line ${line}`)
		const lowerEdit = replaceNearCursorInText({ line: 10, ch: 0 }, lower.length, (content, cursor) => replace(content, cursor), line => lower[line])
		expect(lowerEdit?.line).toBe(18)
		expect(lowerEdit?.endLine).toBe(18)
		const standaloneEdit = replaceNearCursorInText({ line: 10, ch: 0 }, lower.length, (content, cursor) => replaceAttachmentReference({
			content,
			cursor,
			targetPaths: ['standalone.png'],
			replacement: '![alt](new.png)',
			replacementPath: 'new.png',
			image: true,
			asFigure: false,
		}), line => lower[line])
		expect(standaloneEdit).toBeNull()
	})
})
