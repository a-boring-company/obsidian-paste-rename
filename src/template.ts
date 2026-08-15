import { FrontMatterCache } from 'obsidian';

interface DateFormatter {
	format(format: string): string
}

interface TemplateData {
	imageNameKey: string
	fileName: string
	dirName: string
	firstHeading: string
}

const templateTokenRegex = /{{DATE:([^}]+)}}|{{frontmatter:([^}]+)}}|{{(imageNameKey|fileName|dirName|firstHeading)}}/gm

export const expandTemplate = (
	tmpl: string,
	data: TemplateData,
	frontmatter: FrontMatterCache | undefined,
	date: DateFormatter,
) => tmpl.replace(templateTokenRegex, (_match, dateFormat: string, frontmatterKey: string, field: keyof TemplateData) => {
	if (dateFormat !== undefined) return date.format(dateFormat)
	if (frontmatterKey !== undefined && frontmatter && Object.prototype.hasOwnProperty.call(frontmatter, frontmatterKey)) {
		return String(frontmatter[frontmatterKey] ?? '')
	}
	if (frontmatterKey !== undefined) return ''
	return data[field]
})

export const renderTemplate = (tmpl: string, data: TemplateData, frontmatter?: FrontMatterCache) => {
	return expandTemplate(tmpl, data, frontmatter, window.moment())
}
