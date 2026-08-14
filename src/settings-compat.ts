export type ImageOutput = 'html' | 'markdown'

export function resolveImageOutput(stored: unknown, fallback: ImageOutput): ImageOutput {
	if (stored === null || stored === undefined) return fallback
	if (typeof stored !== 'object' || Array.isArray(stored)) return fallback
	if (!Object.prototype.hasOwnProperty.call(stored, 'imageOutput')) return 'markdown'
	const value = (stored as { imageOutput?: unknown }).imageOutput
	return value === 'html' || value === 'markdown' ? value : fallback
}
