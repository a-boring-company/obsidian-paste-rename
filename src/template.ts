import { FrontMatterCache } from 'obsidian';

const dateTmplRegex = /{{DATE:([^}]+)}}/g
const frontmatterTmplRegex = /{{frontmatter:([^}]+)}}/g

const replaceDateVars = (s: string, date: { format: (fmt: string) => string }): string => {
	return s.replace(dateTmplRegex, (_match, fmt: string) => date.format(fmt))
}

const replaceFrontmatterVars = (s: string, frontmatter?: FrontMatterCache): string => {
	return s.replace(frontmatterTmplRegex, (_match, key: string) => {
		const value = frontmatter?.[key]
		if (value === undefined || value === null) return ''
		return String(value)
	})
}

interface TemplateData {
	imageNameKey: string
	fileName: string
	dirName: string
	firstHeading: string
}

export const renderTemplate = (tmpl: string, data: TemplateData, frontmatter?: FrontMatterCache) => {
	const now = window.moment()
	let text = tmpl
	text = replaceDateVars(text, now)
	text = replaceFrontmatterVars(text, frontmatter)

	text = text
		.replace(/{{imageNameKey}}/gm, data.imageNameKey)
		.replace(/{{fileName}}/gm, data.fileName)
		.replace(/{{dirName}}/gm, data.dirName)
		.replace(/{{firstHeading}}/gm, data.firstHeading)
	return text
}
