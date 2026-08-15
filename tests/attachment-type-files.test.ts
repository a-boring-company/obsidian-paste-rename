import { describe, expect, it } from 'vitest'

import { chooseAttachmentTypeConfig } from '../src/attachment-type-files'
import { DEFAULT_ATTACHMENT_TYPE_CONFIG } from '../src/attachment-types'

describe('attachment type file selection', () => {
	it('keeps an existing valid user file authoritative', () => {
		expect(chooseAttachmentTypeConfig({ status: 'read', text: '{"images":["png"],"attachments":[]}' }, '{"images":["jpg"],"attachments":[]}'))
			.toEqual({ config: { images: ['png'], attachments: [] }, createUserFile: false, invalidUserFile: false, unreadableUserFile: false })
	})

	it('uses shipped defaults and creates the user file only when it is absent', () => {
		expect(chooseAttachmentTypeConfig({ status: 'missing' }, '{"images":["jpg"],"attachments":[]}'))
			.toEqual({ config: { images: ['jpg'], attachments: [] }, createUserFile: true, invalidUserFile: false, unreadableUserFile: false })
	})

	it('uses built-ins for missing or invalid shipped defaults', () => {
		expect(chooseAttachmentTypeConfig({ status: 'missing' }, '{')).toEqual({
			config: DEFAULT_ATTACHMENT_TYPE_CONFIG, createUserFile: true, invalidUserFile: false, unreadableUserFile: false,
		})
	})

	it('does not overwrite an invalid user file', () => {
		expect(chooseAttachmentTypeConfig({ status: 'read', text: '{' }, '{"images":["jpg"],"attachments":[]}')).toEqual({
			config: DEFAULT_ATTACHMENT_TYPE_CONFIG, createUserFile: false, invalidUserFile: true, unreadableUserFile: false,
		})
	})

	it('keeps unreadable existing files untouched and uses safe in-memory defaults', () => {
		expect(chooseAttachmentTypeConfig({ status: 'unreadable' }, '{"images":["jpg"],"attachments":[]}')).toEqual({
			config: DEFAULT_ATTACHMENT_TYPE_CONFIG, createUserFile: false, invalidUserFile: false, unreadableUserFile: true,
		})
	})
})
