import { AttachmentTypeConfig, isEligibleAttachmentExtension, isImageExtension } from './attachment-types'

export function isEligibleAttachmentCreate(
	extension: unknown,
	isPasted: boolean,
	handleAllAttachments: boolean,
	isExcluded: () => boolean,
	config: AttachmentTypeConfig,
): boolean {
	if (!isEligibleAttachmentExtension(extension, config)) return false
	if (!handleAllAttachments) return isPasted && isImageExtension(extension, config)
	return !isExcluded()
}
