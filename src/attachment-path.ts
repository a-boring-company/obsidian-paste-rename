function normalisePosix(path: string): string {
	const parts: string[] = []
	for (const part of path.replace(/\\/g, '/').split('/')) {
		if (!part || part === '.') continue
		if (part === '..') {
			if (parts.length && parts[parts.length - 1] !== '..') parts.pop()
			else parts.push(part)
			continue
		}
		parts.push(part)
	}
	return parts.join('/')
}

export function attachmentPathCandidates(
	sourceNotePath: string,
	attachmentPath: string,
	generatedDestinations: string[] = [],
): string[] {
	const target = normalisePosix(attachmentPath)
	if (target === '..' || target.startsWith('../')) throw new Error('attachment path escapes the vault')
	const relative = relativeAttachmentPath(sourceNotePath, target)
	const candidates = [...generatedDestinations, relative, target, target ? `/${target}` : '']
	return [...new Set(candidates.filter(candidate => candidate.length > 0))]
}

export function relativeAttachmentPath(sourceNotePath: string, attachmentPath: string): string {
	const note = normalisePosix(sourceNotePath)
	const target = normalisePosix(attachmentPath)
	if (note === '..' || note.startsWith('../') || target === '..' || target.startsWith('../')) {
		throw new Error('attachment path escapes the vault')
	}
	const sourceParts = note ? note.split('/') : []
	sourceParts.pop()
	const targetParts = target ? target.split('/') : []
	let commonLength = 0
	while (commonLength < sourceParts.length && commonLength < targetParts.length && sourceParts[commonLength] === targetParts[commonLength]) {
		commonLength++
	}
	const parentSegments = sourceParts.slice(commonLength).map(() => '..')
	return [...parentSegments, ...targetParts.slice(commonLength)].join('/')
}

export function renameInPlace(currentPath: string, newFilename: string): string {
	if (!newFilename || newFilename === '.' || newFilename === '..' || /[\\/]/.test(newFilename)) {
		throw new Error('new name must be a filename without a path')
	}
	const current = normalisePosix(currentPath)
	const parent = current.includes('/') ? current.slice(0, current.lastIndexOf('/')) : ''
	return parent ? `${parent}/${newFilename}` : newFilename
}

export function isRenameNoOp(currentName: string, normalizedName: string): boolean {
	return currentName === normalizedName
}
