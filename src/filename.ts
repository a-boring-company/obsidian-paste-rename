function removeUnsafeCharacters(value: string): string {
	return value
		.replace(/[^A-Za-z0-9._-]+/g, '')
		.replace(/[-_]{2,}/g, '_')
		.replace(/^[-_.]+|[-_.]+$/g, '')
}

export function normalizeFilenameStem(input: string): string {
	return removeUnsafeCharacters(
		input
			.normalize('NFKD')
			.replace(/Đ/g, 'D')
			.replace(/đ/g, 'd')
			.replace(/[\u0300-\u036f]/g, '')
			.replace(/\s+/g, '_')
			.replace(/[^\x20-\x7E]/g, ''),
	)
}
