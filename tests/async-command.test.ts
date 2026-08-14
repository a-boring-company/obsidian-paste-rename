import { describe, expect, it } from 'vitest'

import { observeAsyncCommand } from '../src/async-command'

describe('async command observation', () => {
	it('awaits successful commands and reports rejected commands', async () => {
		let completed = false
		let reported: unknown = null
		await observeAsyncCommand(async () => { completed = true }, error => { reported = error })
		expect(completed).toBe(true)
		expect(reported).toBeNull()

		const failure = new Error('failure')
		await observeAsyncCommand(async () => { throw failure }, error => { reported = error })
		expect(reported).toBe(failure)
	})
})
