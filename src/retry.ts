export async function retryBounded<T>(
	attempts: number,
	attempt: (attempt: number) => Promise<T | null>,
	cancelled: () => boolean = () => false,
): Promise<T | null> {
	for (let index = 0; index < attempts; index++) {
		if (cancelled()) return null
		const result = await attempt(index)
		if (result !== null) return result
		if (cancelled()) return null
	}
	return null
}
