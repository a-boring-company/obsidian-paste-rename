import { extractGeneratedFigurePaths } from './figure-document'

export function collectBatchReferenceLinks(embedLinks: readonly string[], markdown: string): string[] {
	return [...new Set([...embedLinks, ...extractGeneratedFigurePaths(markdown)])]
}
