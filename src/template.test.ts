import { renderTemplate } from './template';
import { FrontMatterCache } from 'obsidian';

// Mock window.moment
const mockMoment = {
  format: (format: string) => {
    if (format === 'YYYY-MM-DD') {
      return '2023-01-01';
    }
    if (format === 'HH-mm-ss') {
      return '12-30-00';
    }
    return '';
  },
};

global.window = {
  moment: () => mockMoment,
} as any;


describe('renderTemplate', () => {
  const baseData = {
    imageNameKey: 'test-image',
    fileName: 'My-Note',
    dirName: 'My-Folder',
    firstHeading: 'My-First-Heading',
  };

  it('should replace basic variables', () => {
    const tmpl = '{{fileName}}-{{imageNameKey}}';
    const result = renderTemplate(tmpl, baseData);
    expect(result).toBe('My-Note-test-image');
  });

  it('should replace dirName and firstHeading', () => {
    const tmpl = '{{dirName}}/{{firstHeading}}';
    const result = renderTemplate(tmpl, baseData);
    expect(result).toBe('My-Folder/My-First-Heading');
  });

  it('should replace date variables', () => {
    const tmpl = 'img-{{DATE:YYYY-MM-DD}}';
    const result = renderTemplate(tmpl, baseData);
    expect(result).toBe('img-2023-01-01');
  });

  it('should handle multiple date variables', () => {
    const tmpl = '{{DATE:YYYY-MM-DD}}-{{DATE:HH-mm-ss}}';
    const result = renderTemplate(tmpl, baseData);
    expect(result).toBe('2023-01-01-12-30-00');
  });

  it('should replace frontmatter variables', () => {
    const tmpl = '{{frontmatter:alias}}-{{fileName}}';
    const frontmatter: FrontMatterCache = { alias: 'test-alias' };
    const result = renderTemplate(tmpl, baseData, frontmatter);
    expect(result).toBe('test-alias-My-Note');
  });

  it('should handle missing frontmatter variables gracefully', () => {
    const tmpl = '{{frontmatter:nonexistent}}-{{fileName}}';
    const frontmatter: FrontMatterCache = { alias: 'test-alias' };
    const result = renderTemplate(tmpl, baseData, frontmatter);
    expect(result).toBe('-My-Note');
  });

  it('should handle undefined frontmatter gracefully', () => {
    const tmpl = '{{frontmatter:nonexistent}}-{{fileName}}';
    const result = renderTemplate(tmpl, baseData, undefined);
    expect(result).toBe('-My-Note');
  });

  it('should replace all variable types at once', () => {
    const tmpl = '{{dirName}}/{{fileName}}-{{imageNameKey}}-{{DATE:YYYY-MM-DD}}-{{frontmatter:alias}}';
    const frontmatter: FrontMatterCache = { alias: 'test-alias' };
    const result = renderTemplate(tmpl, baseData, frontmatter);
    expect(result).toBe('My-Folder/My-Note-test-image-2023-01-01-test-alias');
  });

  it('should return the template string if no variables are present', () => {
    const tmpl = 'a-static-string';
    const result = renderTemplate(tmpl, baseData);
    expect(result).toBe('a-static-string');
  });

  it('should handle an empty template string', () => {
    const tmpl = '';
    const result = renderTemplate(tmpl, baseData);
    expect(result).toBe('');
  });

  it('should handle multiple occurrences of the same variable', () => {
    const tmpl = '{{fileName}}-{{fileName}}';
    const result = renderTemplate(tmpl, baseData);
    expect(result).toBe('My-Note-My-Note');
  });
});
