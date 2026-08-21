import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

import { resolveObsidianAlias } from '../vitest.config.mjs'

describe('Vitest config path aliases', () => {
	it('resolves the Obsidian mock as a native path when the checkout path contains spaces', () => {
		const checkoutRoot = join(tmpdir(), 'checkout with spaces')
		const configUrl = pathToFileURL(join(checkoutRoot, 'vitest.config.mts'))

		expect(resolveObsidianAlias(configUrl)).toBe(join(checkoutRoot, 'tests', 'mocks', 'obsidian.ts'))
	})
})
