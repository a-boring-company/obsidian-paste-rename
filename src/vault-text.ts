import type { TFile, Vault } from 'obsidian'

type VaultProcessAdapter = Pick<Vault, 'process'>

export type VaultCompareWriteResult = 'written' | 'conflict' | 'cancelled'

export async function compareAndWriteVaultText(
	vault: VaultProcessAdapter,
	file: TFile,
	allowed: (content: string) => boolean,
	isCurrent: () => boolean,
	nextContent: string,
	beforeWrite?: () => boolean,
): Promise<VaultCompareWriteResult> {
	if (!isCurrent()) return 'cancelled'
	let conflict = false
	let cancelled = false
	await vault.process(file, content => {
		if (!isCurrent()) {
			cancelled = true
			return content
		}
		if (!allowed(content)) {
			conflict = true
			return content
		}
		if (beforeWrite && !beforeWrite()) {
			conflict = true
			return content
		}
		return nextContent
	})
	if (cancelled) return 'cancelled'
	return conflict ? 'conflict' : 'written'
}

export async function processVaultText(
	vault: VaultProcessAdapter,
	file: TFile,
	transform: (content: string) => string,
	isCurrent: () => boolean,
): Promise<'written' | 'cancelled'> {
	if (!isCurrent()) return 'cancelled'
	let cancelled = false
	await vault.process(file, content => {
		if (!isCurrent()) {
			cancelled = true
			return content
		}
		return transform(content)
	})
	return cancelled ? 'cancelled' : 'written'
}
