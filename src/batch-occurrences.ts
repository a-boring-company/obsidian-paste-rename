import type { EmbedCache, ReferenceCache } from 'obsidian'

import { extractGeneratedDestination } from './attachment-links'
import { extractReferencePath } from './embeds'

export interface CachedEmbedOccurrence {
	link: string
	original: string
	start: number
	end: number
	destinationStart: number
	destinationEnd: number
}

export interface CachedAttachmentGroup<T extends { path: string }> {
	file: T
}

export function mapCachedOccurrencesByTargetPath<T extends { path: string }>(
	occurrences: readonly CachedEmbedOccurrence[],
	targetPaths: readonly string[],
	resolve: (link: string) => T | null,
): Map<string, CachedEmbedOccurrence[]> {
	const targets = new Set(targetPaths)
	const mapped = new Map<string, CachedEmbedOccurrence[]>()
	for (const occurrence of occurrences) {
		const file = resolve(occurrence.link)
		if (!file || !targets.has(file.path)) continue
		const targetOccurrences = mapped.get(file.path)
		if (targetOccurrences) targetOccurrences.push(occurrence)
		else mapped.set(file.path, [occurrence])
	}
	return mapped
}

type CachedReference = Pick<ReferenceCache, 'link' | 'original' | 'position'>
type CachedEmbedInput = Pick<EmbedCache, 'link' | 'original' | 'position'> | CachedEmbedOccurrence

function offsetAt(value: string, line: number, ch: number): number {
	let offset = 0
	for (let currentLine = 0; currentLine < line; currentLine++) {
		const newline = value.indexOf('\n', offset)
		if (newline < 0) return value.length
		offset = newline + 1
	}
	return Math.min(value.length, offset + ch)
}

export function cacheEmbedOccurrences(
	content: string,
	embeds: readonly Pick<EmbedCache, 'link' | 'original' | 'position'>[],
): CachedEmbedOccurrence[] {
	return cacheReferenceOccurrences(content, embeds)
}

export function cacheReferenceOccurrences(
	content: string,
	references: readonly CachedReference[],
): CachedEmbedOccurrence[] {
	const occurrences: CachedEmbedOccurrence[] = []
	const seen = new Set<string>()
	for (const embed of references) {
		const start = offsetAt(content, embed.position.start.line, embed.position.start.col)
		if (content.slice(start, start + embed.original.length) !== embed.original) continue
		const parsed = extractReferencePath(embed.original)
		if (!parsed) continue
		const key = `${start}:${start + embed.original.length}:${embed.original}`
		if (seen.has(key)) continue
		seen.add(key)
		occurrences.push({
			link: embed.link,
			original: embed.original,
			start,
			end: start + embed.original.length,
			destinationStart: start + parsed.destinationStart,
			destinationEnd: start + parsed.destinationEnd,
		})
	}
	return occurrences
}

export function groupCachedAttachments<T extends { path: string }>(
	content: string,
	embeds: readonly CachedEmbedInput[],
	resolve: (link: string) => T | null,
): CachedAttachmentGroup<T>[] {
	const groups = new Map<string, CachedAttachmentGroup<T>>()
	const occurrences = embeds.length > 0 && 'start' in embeds[0]
		? embeds as CachedEmbedOccurrence[]
		: cacheEmbedOccurrences(content, embeds as Pick<EmbedCache, 'link' | 'original' | 'position'>[])
	for (const occurrence of occurrences) {
		const file = resolve(occurrence.link)
		if (!file) continue
		if (!groups.has(file.path)) groups.set(file.path, { file })
	}
	return [...groups.values()]
}

export function attachmentTargetDiscovered<T extends { path: string }>(
	groups: readonly CachedAttachmentGroup<T>[],
	generatedPaths: readonly string[],
	targetPath: string,
	resolve: (link: string) => T | null,
): boolean {
	return groups.some(group => group.file.path === targetPath)
		|| generatedPaths.some(link => resolve(link)?.path === targetPath)
}

function encodeMarkdownFilename(filename: string): string {
	return encodeURIComponent(filename).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
}

export function encodeMarkdownDestination(path: string): string {
	return path.split('/').map(segment => {
		if (segment === '' || segment === '.' || segment === '..') return segment
		return encodeMarkdownFilename(segment)
	}).join('/')
}

function rangesOverlap(start: number, end: number, otherStart: number, otherEnd: number): boolean {
	return start < otherEnd && otherStart < end
}

interface RetargetDestinations {
	wiki: string
	markdown: string
}

export function deriveRetargetDestinations(
	wikiDestination: string,
	generatedLink: string,
	markdownFallback: string,
): RetargetDestinations {
	const generatedMarkdown = generatedLink.startsWith('[[') ? null : extractGeneratedDestination(generatedLink)
	return {
		wiki: wikiDestination,
		markdown: generatedMarkdown ?? encodeMarkdownDestination(markdownFallback),
	}
}

function splitSubpath(path: string): string {
	const marker = [...[path.indexOf('?'), path.indexOf('#'), path.indexOf('^')].filter(index => index >= 0)].sort((left, right) => left - right)[0]
	return marker === undefined ? '' : path.slice(marker)
}

export function retargetCachedOccurrences(
	occurrences: readonly CachedEmbedOccurrence[],
	destinations: RetargetDestinations,
): CachedEmbedOccurrence[] {
	const retargeted = occurrences.map((occurrence, sourceIndex) => {
		const parsed = extractReferencePath(occurrence.original)
		if (!parsed) return { sourceIndex, delta: 0, occurrence }
		const destinationBase = parsed.kind === 'markdown' ? destinations.markdown : destinations.wiki
		const destination = `${destinationBase}${splitSubpath(parsed.path)}`
		const currentOriginal = `${occurrence.original.slice(0, parsed.destinationStart)}${destination}${occurrence.original.slice(parsed.destinationEnd)}`
		return {
			sourceIndex,
			delta: currentOriginal.length - occurrence.original.length,
			occurrence: {
				...occurrence,
				link: destination,
				original: currentOriginal,
				end: occurrence.start + currentOriginal.length,
				destinationStart: occurrence.start + parsed.destinationStart,
				destinationEnd: occurrence.start + parsed.destinationStart + destination.length,
			},
		}
	})
	const result = Array<CachedEmbedOccurrence>(retargeted.length)
	let priorDelta = 0
	for (const item of [...retargeted].sort((left, right) => left.occurrence.start - right.occurrence.start)) {
		const occurrence = item.occurrence
		result[item.sourceIndex] = {
			...occurrence,
			start: occurrence.start + priorDelta,
			end: occurrence.end + priorDelta,
			destinationStart: occurrence.destinationStart + priorDelta,
			destinationEnd: occurrence.destinationEnd + priorDelta,
		}
		priorDelta += item.delta
	}
	return result
}

export function replaceRetargetedCachedOccurrences(
	content: string,
	oldOccurrences: readonly CachedEmbedOccurrence[],
	currentOccurrences: readonly CachedEmbedOccurrence[],
): string {
	const replacements = oldOccurrences.map((old, sourceIndex) => {
		if (content.slice(old.start, old.end) !== old.original) return null
		const current = currentOccurrences[sourceIndex]
		if (!current) return null
		const parsed = extractReferencePath(current.original)
		if (!parsed) return null
		return {
			start: old.destinationStart,
			end: old.destinationEnd,
			text: current.original.slice(parsed.destinationStart, parsed.destinationEnd),
		}
	})
		.filter((replacement): replacement is { start: number; end: number; text: string } => replacement !== null)
		.sort((left, right) => left.start - right.start)
	const nonOverlapping: Array<{ start: number; end: number; text: string }> = []
	for (const replacement of replacements) {
		if (nonOverlapping.some(previous => rangesOverlap(replacement.start, replacement.end, previous.start, previous.end))) continue
		nonOverlapping.push(replacement)
	}
	let result = content
	for (const replacement of nonOverlapping.reverse()) result = `${result.slice(0, replacement.start)}${replacement.text}${result.slice(replacement.end)}`
	return result
}
