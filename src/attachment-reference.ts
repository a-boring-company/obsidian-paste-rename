import { extractGeneratedDestination } from './attachment-links'
import { LineReplacement } from './embed-location'
import { findReferenceOccurrences, pathsEqual, ReferencePath } from './embeds'

export interface AttachmentReferenceInput {
	content: string
	cursor: number
	targetPaths: readonly string[]
	currentTargetPaths?: readonly string[]
	replacement: string
	replacementPath?: string
	image: boolean
	asFigure: boolean
	figureImageLine?: string
}

interface ReferenceCandidate {
	start: number
	end: number
	old: boolean
	current: boolean
	reference?: ReferencePath
}

function distanceFromCandidate(position: number, candidate: ReferenceCandidate): number {
	if (position < candidate.start) return candidate.start - position
	if (position > candidate.end) return position - candidate.end
	return 0
}

function nearestCandidate(content: string, cursor: number, input: AttachmentReferenceInput): ReferenceCandidate | null {
	const candidates: ReferenceCandidate[] = findReferenceOccurrences(content)
		.filter(reference => input.image ? reference.image : true)
		.map(reference => ({
			start: reference.start,
			end: reference.end,
			old: input.targetPaths.some(target => pathsEqual(reference.path, target)),
			current: (input.currentTargetPaths ?? []).some(target => pathsEqual(reference.path, target)),
			reference,
		}))
		.filter(candidate => candidate.old || candidate.current)

	if (input.asFigure && input.figureImageLine) {
		let start = content.indexOf(input.figureImageLine)
		while (start >= 0) {
			candidates.push({ start, end: start + input.figureImageLine.length, old: false, current: true })
			start = content.indexOf(input.figureImageLine, start + 1)
		}
	}
	if (!candidates.length) return null
	const position = Math.max(0, Math.min(cursor, content.length))
	return candidates.reduce((closest, candidate) => {
		const candidateDistance = distanceFromCandidate(position, candidate)
		const closestDistance = distanceFromCandidate(position, closest)
		return candidateDistance < closestDistance ? candidate : closest
	})
}

function replaceCandidate(content: string, candidate: ReferenceCandidate, replacement: string, block: boolean): LineReplacement {
	const before = content.slice(0, candidate.start)
	const after = content.slice(candidate.end)
	const prefix = block && before && !before.endsWith('\n') ? '\n' : ''
	const suffix = block && after && !after.startsWith('\n') ? '\n' : ''
	const replacementText = `${prefix}${replacement}${suffix}`
	return {
		text: `${before}${replacementText}${after}`,
		start: candidate.start,
		end: candidate.end,
		replacementText,
	}
}

export function replaceAttachmentReference(input: AttachmentReferenceInput): LineReplacement | null {
	const replacementPath = input.replacementPath ?? extractGeneratedDestination(input.replacement) ?? input.replacement
	const candidate = nearestCandidate(input.content, input.cursor, input)
	if (!candidate) return null
	if (!candidate.reference) return { text: input.content, start: candidate.start, end: candidate.end, matched: true }

	const reference = candidate.reference
	if (input.asFigure) return replaceCandidate(input.content, candidate, input.replacement, true)
	if (candidate.current && (!candidate.old || pathsEqual(reference.path, replacementPath))) {
		return { text: input.content, start: candidate.start, end: candidate.end, matched: true }
	}
	return {
		text: `${input.content.slice(0, reference.destinationStart)}${replacementPath}${input.content.slice(reference.destinationEnd)}`,
		start: reference.destinationStart,
		end: reference.destinationEnd,
		replacementText: replacementPath,
	}
}
