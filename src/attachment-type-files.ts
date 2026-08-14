import {
	AttachmentTypeConfig,
	cloneAttachmentTypeConfig,
	DEFAULT_ATTACHMENT_TYPE_CONFIG,
	parseAttachmentTypeConfig,
} from './attachment-types'

interface AttachmentTypeFileSelection {
	config: AttachmentTypeConfig
	createUserFile: boolean
	invalidUserFile: boolean
	unreadableUserFile: boolean
}

export type AttachmentTypeUserSource =
	| { status: 'missing' }
	| { status: 'unreadable' }
	| { status: 'read'; text: string }

export function chooseAttachmentTypeConfig(user: AttachmentTypeUserSource, shippedText: string | null): AttachmentTypeFileSelection {
	if (user.status === 'read') {
		const result = parseAttachmentTypeConfig(user.text)
		if (result.ok) return { config: result.value, createUserFile: false, invalidUserFile: false, unreadableUserFile: false }
		return { config: cloneAttachmentTypeConfig(DEFAULT_ATTACHMENT_TYPE_CONFIG), createUserFile: false, invalidUserFile: true, unreadableUserFile: false }
	}
	if (user.status === 'unreadable') {
		return { config: cloneAttachmentTypeConfig(DEFAULT_ATTACHMENT_TYPE_CONFIG), createUserFile: false, invalidUserFile: false, unreadableUserFile: true }
	}
	if (shippedText !== null) {
		const result = parseAttachmentTypeConfig(shippedText)
		if (result.ok) return { config: result.value, createUserFile: true, invalidUserFile: false, unreadableUserFile: false }
	}
	return { config: cloneAttachmentTypeConfig(DEFAULT_ATTACHMENT_TYPE_CONFIG), createUserFile: true, invalidUserFile: false, unreadableUserFile: false }
}
