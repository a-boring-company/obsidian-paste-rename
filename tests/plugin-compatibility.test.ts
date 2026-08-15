import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('plugin compatibility assets', () => {
	it('requires the atomic Obsidian APIs used by batch synchronization', () => {
		const manifest = JSON.parse(readFileSync('manifest.json', 'utf8')) as { minAppVersion: string }
		const versions = JSON.parse(readFileSync('versions.json', 'utf8')) as Record<string, string>
		const mainSource = readFileSync('src/main.ts', 'utf8')
		expect(manifest.minAppVersion).toBe('1.1.1')
		expect(versions['2.0.0']).toBe('1.1.1')
		expect(versions['1.6.1']).toBe('0.12.0')
		expect(readFileSync('attachment-types.default.json', 'utf8')).toContain('images')
		const listenerStart = mainSource.indexOf("this.app.metadataCache.on('changed'")
		const settingsAwait = mainSource.indexOf('await this.loadSettings()')
		const attachmentTypesAwait = mainSource.indexOf('await this.loadAttachmentTypes(generation)')
		expect(listenerStart).toBeGreaterThanOrEqual(0)
		expect(listenerStart).toBeLessThan(settingsAwait)
		expect(listenerStart).toBeLessThan(attachmentTypesAwait)
		const listenerIndexes = [
			mainSource.indexOf("this.app.vault.on('modify'", listenerStart),
			mainSource.indexOf("this.app.vault.on('delete'", listenerStart),
			mainSource.indexOf("this.app.vault.on('rename'", listenerStart),
		]
		for (const index of listenerIndexes) {
			expect(index).toBeGreaterThanOrEqual(0)
			expect(index).toBeLessThan(settingsAwait)
		}
	})
})
