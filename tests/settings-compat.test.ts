import { describe, expect, it } from 'vitest'

import { resolveImageOutput } from '../src/settings-compat'

describe('legacy image output settings', () => {
	it('uses HTML only when no settings data exists', () => {
		expect(resolveImageOutput(null, 'html')).toBe('html')
		expect(resolveImageOutput(undefined, 'html')).toBe('html')
	})

	it('keeps explicit output and maps legacy saved settings to Markdown', () => {
		expect(resolveImageOutput({ imageOutput: 'html' }, 'html')).toBe('html')
		expect(resolveImageOutput({ imageOutput: 'markdown' }, 'html')).toBe('markdown')
		expect(resolveImageOutput({ imageNamePattern: '{{fileName}}' }, 'html')).toBe('markdown')
		expect(resolveImageOutput({ imageOutput: 'invalid' }, 'html')).toBe('html')
		expect(resolveImageOutput([], 'html')).toBe('html')
	})
})
