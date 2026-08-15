import { describe, expect, it } from 'vitest'

import {
	applyAttachmentTypeSnapshot,
	commitAttachmentTypeSnapshot,
	createAttachmentTypePersistence,
	reconcileAttachmentTypeFailure,
} from '../src/attachment-type-state'
import { parseAttachmentTypeConfig } from '../src/attachment-types'

const base = { images: ['png'], attachments: ['pdf'] }
const next = { images: ['jpg'], attachments: ['pdf'] }
const other = { images: ['webp'], attachments: ['txt'] }

describe('attachment type persistence state', () => {
	it('reconciles both failed writes to the last committed base', () => {
		const state = createAttachmentTypePersistence(base)
		const first = applyAttachmentTypeSnapshot(state, next)
		const second = applyAttachmentTypeSnapshot(state, other)
		reconcileAttachmentTypeFailure(state, first)
		reconcileAttachmentTypeFailure(state, second)
		expect(state.current).toEqual(base)
	})

	it('keeps B when A fails and B succeeds', () => {
		const state = createAttachmentTypePersistence(base)
		const first = applyAttachmentTypeSnapshot(state, next)
		const second = applyAttachmentTypeSnapshot(state, other)
		reconcileAttachmentTypeFailure(state, first)
		commitAttachmentTypeSnapshot(state, other)
		expect(second).toBe(2)
		expect(state.current).toEqual(other)
	})

	it('keeps A committed when B fails', () => {
		const state = createAttachmentTypePersistence(base)
		const first = applyAttachmentTypeSnapshot(state, next)
		commitAttachmentTypeSnapshot(state, next)
		applyAttachmentTypeSnapshot(state, other)
		reconcileAttachmentTypeFailure(state, 2)
		expect(first).toBe(1)
		expect(state.current).toEqual(next)
	})

	it('does not advance revision for invalid input represented by no snapshot', () => {
		const state = createAttachmentTypePersistence(base)
		const invalid = parseAttachmentTypeConfig({ images: ['bad ext'], attachments: [] })
		expect(invalid.ok).toBe(false)
		const first = applyAttachmentTypeSnapshot(state, next)
		reconcileAttachmentTypeFailure(state, first)
		expect(state.revision).toBe(1)
		expect(state.current).toEqual(base)
	})

	it('restores the committed snapshot after a reset write fails', () => {
		const state = createAttachmentTypePersistence(next)
		commitAttachmentTypeSnapshot(state, next)
		const resetRevision = applyAttachmentTypeSnapshot(state, base)
		reconcileAttachmentTypeFailure(state, resetRevision)
		expect(state.current).toEqual(next)
	})
})
