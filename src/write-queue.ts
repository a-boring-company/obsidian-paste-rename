interface SerializedWriteQueue<T> {
	enqueue(value: T, write: (snapshot: T) => Promise<void>): Promise<void>
}

export function createSerializedWriteQueue<T>(clone: (value: T) => T): SerializedWriteQueue<T> {
	let tail: Promise<void> = Promise.resolve()
	return {
		enqueue(value, write) {
			const snapshot = clone(value)
			const operation = tail.then(() => write(snapshot))
			tail = operation.catch((): undefined => undefined)
			return operation
		},
	}
}
