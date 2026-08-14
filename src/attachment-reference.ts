import { extractGeneratedDestination } from './attachment-links'
import { LineReplacement } from './embed-location'
import { findReferenceOccurrences, pathsEqual, ReferencePath } from './embeds'
import { advanceMarkdownDocumentContext, emptyMarkdownDocumentContext, MarkdownDocumentContext } from './markdown-context'

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
	initialContext?: MarkdownDocumentContext | null
}

export interface AttachmentReferenceStateInput {
	content: string
	cursor: number
	targetPaths: readonly string[]
	currentTargetPaths?: readonly string[]
	image: boolean
}

export type AttachmentReferenceState = 'old' | 'current' | 'none'
export type NativeLinkSyncDecision = 'proceed' | 'wait' | 'abort'

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

function nearestCandidate(
	content: string,
	cursor: number,
	input: Pick<AttachmentReferenceInput, 'targetPaths' | 'currentTargetPaths' | 'image' | 'asFigure' | 'figureImageLine'>,
): ReferenceCandidate | null {
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

export function classifyAttachmentReference(input: AttachmentReferenceStateInput): AttachmentReferenceState {
	const candidate = nearestCandidate(input.content, input.cursor, {
		targetPaths: input.targetPaths,
		currentTargetPaths: input.currentTargetPaths,
		image: input.image,
		asFigure: false,
		figureImageLine: undefined,
	})
	if (!candidate) return 'none'
	if (candidate.current && !candidate.old) return 'current'
	return 'old'
}

export function nativeLinkSyncDecision(
	diskState: AttachmentReferenceState | null,
	editorState: AttachmentReferenceState,
): NativeLinkSyncDecision {
	if (editorState === 'none') return 'abort'
	if (diskState === 'current') return editorState === 'current' ? 'proceed' : 'wait'
	if (diskState === 'old' || diskState === 'none') return 'proceed'
	return 'abort'
}

function isInsideExcludedContext(
	content: string,
	position: number,
	initialContext: MarkdownDocumentContext | null = null,
): boolean {
	const lines = content.slice(0, position).split(/\r?\n/)
	let context = initialContext ?? emptyMarkdownDocumentContext()
	for (const line of lines) context = advanceMarkdownDocumentContext(context, line)
	return context.fence !== null || context.frontmatter || context.comment
}

function canRenderTopLevelFigure(content: string, candidate: ReferenceCandidate, initialContext: MarkdownDocumentContext | null): boolean {
	const lineStart = content.lastIndexOf('\n', candidate.start - 1) + 1
	return candidate.start === lineStart && !isInsideExcludedContext(content, candidate.start, initialContext)
}

function replaceCandidate(content: string, candidate: ReferenceCandidate, replacement: string): LineReplacement {
	const before = content.slice(0, candidate.start)
	const after = content.slice(candidate.end)
	const suffix = after && !after.startsWith('\n') ? '\n' : ''
	const replacementText = `${replacement}${suffix}`
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
	const initialContext = input.initialContext ?? null
	if (input.asFigure && canRenderTopLevelFigure(input.content, candidate, initialContext)) return replaceCandidate(input.content, candidate, input.replacement)
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
