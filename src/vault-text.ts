import type { TFile, Vault } from 'obsidian'

type VaultTextAdapter = Pick<Vault, 'read' | 'modify'> & Partial<Pick<Vault, 'process'>>

export async function updateVaultText(
	vault: VaultTextAdapter,
	file: TFile,
	transform: (content: string) => string,
): Promise<void> {
	if (typeof vault.process === 'function') {
		await vault.process(file, transform)
		return
	}
	const content = await vault.read(file)
	await vault.modify(file, transform(content))
}
