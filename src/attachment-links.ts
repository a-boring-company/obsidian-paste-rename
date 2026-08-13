import { extractReferencePath } from './embeds'

import { attachmentPathCandidates } from './attachment-path'

export function extractGeneratedDestination(link: string): string | null {
	const variants = [link, link.startsWith('!') ? link : `!${link}`, `![[${link}]]`]
	for (const variant of variants) {
		const extracted = extractReferencePath(variant)
		if (extracted) return extracted.path
	}
	return null
}

export function imageLinkText(link: string): string {
	return link.startsWith('!') ? link : `!${link}`
}

export function attachmentTargetPathGroups(
	sourceNotePath: string,
	previousPath: string,
	currentPath: string,
	oldLink: string,
	newLink: string,
): { old: string[]; current: string[] } {
	const oldGenerated = [extractGeneratedDestination(oldLink)].filter((path): path is string => path !== null)
	const currentGenerated = [extractGeneratedDestination(newLink)].filter((path): path is string => path !== null)
	return {
		old: attachmentPathCandidates(sourceNotePath, previousPath, oldGenerated),
		current: attachmentPathCandidates(sourceNotePath, currentPath, currentGenerated),
	}
}
