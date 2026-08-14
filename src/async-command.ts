export async function observeAsyncCommand(task: () => Promise<void>, onError: (error: unknown) => void): Promise<void> {
	try {
		await task()
	} catch (error) {
		onError(error)
	}
}
