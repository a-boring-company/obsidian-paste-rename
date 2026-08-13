import { describe, expect, it } from 'vitest'

import { createSerializedWriteQueue } from '../src/write-queue'

describe('serialized snapshot write queue', () => {
	it('writes immutable snapshots in enqueue order despite reversed resolution', async () => {
		const queue = createSerializedWriteQueue((value: string[]) => [...value])
		const order: string[] = []
		let releaseFirst!: () => void
		const first = queue.enqueue(['first'], async snapshot => {
			order.push(snapshot[0])
			await new Promise<void>(resolve => { releaseFirst = resolve })
		})
		const second = queue.enqueue(['second'], async snapshot => { order.push(snapshot[0]) })
		await Promise.resolve()
		releaseFirst()
		await Promise.all([first, second])
		expect(order).toEqual(['first', 'second'])
	})

	it('continues after a failed write', async () => {
		const queue = createSerializedWriteQueue((value: number) => value)
		const seen: number[] = []
		await expect(queue.enqueue(1, async value => {
			seen.push(value)
			throw new Error('first failed')
		})).rejects.toThrow('first failed')
		await queue.enqueue(2, async value => { seen.push(value) })
		expect(seen).toEqual([1, 2])
	})

	it('keeps the newer revision after an older queued write fails', async () => {
		const queue = createSerializedWriteQueue((value: string) => value)
		let memory = 'A'
		let revision = 0
		let disk = ''
		const write = (value: string, previous: string, fail: boolean) => {
			const ownRevision = ++revision
			memory = value
			return queue.enqueue(value, async snapshot => {
				if (fail) throw new Error('write failed')
				disk = snapshot
			}).catch(error => {
				if (revision === ownRevision) memory = previous
				throw error
			})
		}
		const first = write('A1', 'A', true)
		const second = write('B', 'A1', false)
		await expect(first).rejects.toThrow('write failed')
		await second
		expect({ memory, disk }).toEqual({ memory: 'B', disk: 'B' })
	})

	it('restores the previous value when reset write fails', async () => {
		const queue = createSerializedWriteQueue((value: string) => value)
		let memory = 'custom'
		await expect(queue.enqueue('defaults', async () => { throw new Error('reset failed') }).catch(error => {
			memory = 'custom'
			throw error
		})).rejects.toThrow('reset failed')
		expect(memory).toBe('custom')
	})
})
