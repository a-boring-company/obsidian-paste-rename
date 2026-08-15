import { AttachmentTypeConfig, cloneAttachmentTypeConfig } from './attachment-types'

interface AttachmentTypePersistence {
	current: AttachmentTypeConfig
	committed: AttachmentTypeConfig
	revision: number
}

export function createAttachmentTypePersistence(initial: AttachmentTypeConfig): AttachmentTypePersistence {
	const snapshot = cloneAttachmentTypeConfig(initial)
	return { current: cloneAttachmentTypeConfig(snapshot), committed: snapshot, revision: 0 }
}

export function applyAttachmentTypeSnapshot(
	state: AttachmentTypePersistence,
	snapshot: AttachmentTypeConfig,
): number {
	state.revision++
	state.current = cloneAttachmentTypeConfig(snapshot)
	return state.revision
}

export function commitAttachmentTypeSnapshot(
	state: AttachmentTypePersistence,
	snapshot: AttachmentTypeConfig,
): void {
	state.committed = cloneAttachmentTypeConfig(snapshot)
}

export function reconcileAttachmentTypeFailure(
	state: AttachmentTypePersistence,
	revision: number,
): void {
	if (state.revision === revision) state.current = cloneAttachmentTypeConfig(state.committed)
}
