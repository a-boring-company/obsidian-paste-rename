import { describe, expect, it } from 'vitest'

import { isEligibleAttachmentCreate } from '../src/create-eligibility'
import { DEFAULT_ATTACHMENT_TYPE_CONFIG } from '../src/attachment-types'

describe('attachment create eligibility', () => {
	it('keeps pasted images eligible when all-attachment handling is disabled', () => {
		let exclusionsChecked = false
		expect(isEligibleAttachmentCreate('png', true, false, () => {
			exclusionsChecked = true
			throw new Error('exclusion predicate should be lazy')
		}, DEFAULT_ATTACHMENT_TYPE_CONFIG)).toBe(true)
		expect(exclusionsChecked).toBe(false)
	})

	it('applies exclusions only to all-attachment handling', () => {
		expect(isEligibleAttachmentCreate('pdf', false, false, () => true, DEFAULT_ATTACHMENT_TYPE_CONFIG)).toBe(false)
		expect(isEligibleAttachmentCreate('pdf', false, true, () => true, DEFAULT_ATTACHMENT_TYPE_CONFIG)).toBe(false)
		expect(isEligibleAttachmentCreate('pdf', false, true, () => false, DEFAULT_ATTACHMENT_TYPE_CONFIG)).toBe(true)
	})

	it('rejects unknown extensions and non-pasted files when all-attachment handling is disabled', () => {
		expect(isEligibleAttachmentCreate('exe', true, false, () => false, DEFAULT_ATTACHMENT_TYPE_CONFIG)).toBe(false)
		expect(isEligibleAttachmentCreate('png', false, false, () => false, DEFAULT_ATTACHMENT_TYPE_CONFIG)).toBe(false)
	})
})
