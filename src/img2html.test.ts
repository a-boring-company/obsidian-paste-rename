import { createHtmlImgTag, extractObsidianEmbedPath, imageNameToFigureCaption, replaceImageEmbedsWithHtml } from './img2html';

describe('imageNameToFigureCaption', () => {
	it('should replace underscores with spaces', () => {
		expect(imageNameToFigureCaption('image_1234567890.png')).toBe('image 1234567890.');
	});

	it('should handle filenames with multiple underscores', () => {
		expect(imageNameToFigureCaption('my_test_image_123.png')).toBe('my test image 123.');
	});

	it('should handle filenames without underscores', () => {
		expect(imageNameToFigureCaption('testimage.png')).toBe('testimage.');
	});

	it('should handle filenames with various extensions', () => {
		expect(imageNameToFigureCaption('image_test.jpg')).toBe('image test.');
		expect(imageNameToFigureCaption('image_test.gif')).toBe('image test.');
		expect(imageNameToFigureCaption('image_test.webp')).toBe('image test.');
	});

	it('should handle empty filename', () => {
		expect(imageNameToFigureCaption('')).toBe('.');
	});

	it('should handle filename with only extension', () => {
		expect(imageNameToFigureCaption('.png')).toBe('.png.')
	});

	it('should preserve spaces in filenames', () => {
		expect(imageNameToFigureCaption('2021 - Compaleo - Spectral Domain.png')).toBe('2021 - Compaleo - Spectral Domain.');
	});

	it('should handle filenames with dashes', () => {
		expect(imageNameToFigureCaption('my-note-screenshot-1.png')).toBe('my-note-screenshot-1.');
	});

	it('should handle mixed underscores and dashes', () => {
		expect(imageNameToFigureCaption('my_note-screenshot_1.png')).toBe('my note-screenshot 1.');
	});

	it('should handle filenames with special characters', () => {
		expect(imageNameToFigureCaption('image (1).png')).toBe('image (1).');
	});
});

describe('createHtmlImgTag', () => {
	it('should generate centered HTML with figure caption for default path', () => {
		const result = createHtmlImgTag(
			'image_1234567890.png',
			'image_1234567890.png',
			'',
			{
				imageWidth: '80%',
				includeAlt: false,
				useCustomPath: false,
				customPath: '',
			}
		);

		expect(result).toContain('<figure style="text-align: center;">');
		expect(result).toContain('</figure>');
		expect(result).toContain('<img src="image_1234567890.png" style="width: 80%;">');
		expect(result).toContain('<figcaption><b>Figure</b>.');
		expect(result).toContain('image 1234567890.');
	});

	it('should generate centered HTML with figure caption for custom path (absolute)', () => {
		const result = createHtmlImgTag(
			'image_1234567890.png',
			'assets/image_1234567890.png',
			'assets',
			{
				imageWidth: '80%',
				includeAlt: false,
				useCustomPath: true,
				customPath: 'assets',
			}
		);

		expect(result).toContain('<figure style="text-align: center;">');
		expect(result).toContain('</figure>');
		expect(result).toContain('<img src="assets/image_1234567890.png" style="width: 80%;">');
		expect(result).toContain('<figcaption><b>Figure</b>.');
		expect(result).toContain('image 1234567890.');
	});

	it('should generate centered HTML with figure caption for custom path (relative)', () => {
		const result = createHtmlImgTag(
			'image_1234567890.png',
			'./assets/image_1234567890.png',
			'./assets',
			{
				imageWidth: '80%',
				includeAlt: false,
				useCustomPath: true,
				customPath: './assets',
			}
		);

		expect(result).toContain('<img src="./assets/image_1234567890.png" style="width: 80%;">');
		expect(result).toContain('<figcaption><b>Figure</b>.');
		expect(result).toContain('image 1234567890.');
	});

	it('should use provided imagePath when custom path is disabled', () => {
		const result = createHtmlImgTag(
			'plot.png',
			'../assets/plot.png',
			'assets',
			{
				imageWidth: '75%',
				includeAlt: true,
				useCustomPath: false,
				customPath: '',
			}
		);

		expect(result).toContain('src="../assets/plot.png"');
		expect(result).toContain('style="width: 75%;"');
		expect(result).toContain('alt="plot.png"');
	});

	it('should handle image names with multiple underscores', () => {
		const result = createHtmlImgTag(
			'my_test_image_123.png',
			'my_test_image_123.png',
			'',
			{
				imageWidth: '80%',
				includeAlt: false,
				useCustomPath: false,
				customPath: '',
			}
		);

		expect(result).toContain('<figcaption><b>Figure</b>.');
		expect(result).toContain('my test image 123.');
	});

	it('should include alt attribute when includeAlt is true', () => {
		const result = createHtmlImgTag(
			'image_1234567890.png',
			'image_1234567890.png',
			'',
			{
				imageWidth: '80%',
				includeAlt: true,
				useCustomPath: false,
				customPath: '',
			}
		);

		expect(result).toContain('alt="image_1234567890.png"');
	});

	it('should not include alt attribute when includeAlt is false', () => {
		const result = createHtmlImgTag(
			'image_1234567890.png',
			'image_1234567890.png',
			'',
			{
				imageWidth: '80%',
				includeAlt: false,
				useCustomPath: false,
				customPath: '',
			}
		);

		expect(result).not.toContain('alt=');
	});

	it('should use the correct width value', () => {
		const result = createHtmlImgTag(
			'image_1234567890.png',
			'image_1234567890.png',
			'',
			{
				imageWidth: '80%',
				includeAlt: false,
				useCustomPath: false,
				customPath: '',
			}
		);

		expect(result).toContain('style="width: 80%;"');
	});

	it('should use pixel width when specified', () => {
		const result = createHtmlImgTag(
			'image_1234567890.png',
			'image_1234567890.png',
			'',
			{
				imageWidth: '500px',
				includeAlt: false,
				useCustomPath: false,
				customPath: '',
			}
		);

		expect(result).toContain('style="width: 500px;"');
	});

	it('should generate proper multi-line format', () => {
		const result = createHtmlImgTag(
			'image_1234567890.png',
			'image_1234567890.png',
			'',
			{
				imageWidth: '80%',
				includeAlt: false,
				useCustomPath: false,
				customPath: '',
			}
		);

		const expectedFormat = `<figure style="text-align: center;">
<img src="image_1234567890.png" style="width: 80%;">
<figcaption><b>Figure</b>. image 1234567890.</figcaption>
</figure>`;

		expect(result).toBe(expectedFormat);
	});

	it('should work with all options enabled', () => {
		const result = createHtmlImgTag(
			'my_screenshot_2024.jpg',
			'./images/my_screenshot_2024.jpg',
			'./images',
			{
				imageWidth: '600px',
				includeAlt: true,
				useCustomPath: true,
				customPath: './images',
			}
		);

		expect(result).toContain('<figure style="text-align: center;">');
		expect(result).toContain('style="width: 600px;"');
		expect(result).toContain('alt="my_screenshot_2024.jpg"');
		expect(result).toContain('src="./images/my_screenshot_2024.jpg"');
		expect(result).toContain('my screenshot 2024.');
	});

	it('should escape HTML in attributes and caption', () => {
		const result = createHtmlImgTag(
			'"><img src=x onerror=alert(1)>.png',
			'evil.png',
			'',
			{
				imageWidth: '80%" onload="hack',
				includeAlt: true,
				useCustomPath: true,
				customPath: '<script>alert(1)</script>',
			}
		);

		expect(result).toContain('src="&lt;script&gt;alert(1)&lt;/script&gt;/&quot;&gt;&lt;img src=x onerror=alert(1)&gt;.png"')
		expect(result).toContain('style="width: 80%&quot; onload=&quot;hack;"')
		expect(result).toContain('alt="&quot;&gt;&lt;img src=x onerror=alert(1)&gt;.png"')
		expect(result).toContain('<figcaption><b>Figure</b>. &quot;&gt;&lt;img src=x onerror=alert(1)&gt;.')
	});

	it('should handle filenames with spaces (real-world Obsidian rename)', () => {
		const result = createHtmlImgTag(
			'2021 - Compaleo - Spectral Domain Sparse Representation -12.png',
			'appx/2021 - Compaleo - Spectral Domain Sparse Representation -12.png',
			'appx',
			{
				imageWidth: '80%',
				includeAlt: false,
				useCustomPath: false,
				customPath: '',
			}
		);

		expect(result).toContain('src="appx/2021 - Compaleo - Spectral Domain Sparse Representation -12.png"');
		expect(result).toContain('<figcaption><b>Figure</b>. 2021 - Compaleo - Spectral Domain Sparse Representation -12.');
	});

	it('should use imageDir when imagePath is empty', () => {
		const result = createHtmlImgTag(
			'test.png',
			'',
			'images/subfolder',
			{
				imageWidth: '80%',
				includeAlt: false,
				useCustomPath: false,
				customPath: '',
			}
		);

		expect(result).toContain('src="images/subfolder/test.png"');
	});

	it('should use filename only when both imagePath and imageDir are empty', () => {
		const result = createHtmlImgTag(
			'test.png',
			'',
			'',
			{
				imageWidth: '80%',
				includeAlt: false,
				useCustomPath: false,
				customPath: '',
			}
		);

		expect(result).toContain('src="test.png"');
	});

	it('should trim trailing slash from custom path', () => {
		const result = createHtmlImgTag(
			'test.png',
			'',
			'',
			{
				imageWidth: '80%',
				includeAlt: false,
				useCustomPath: true,
				customPath: 'assets/',
			}
		);

		expect(result).toContain('src="assets/test.png"');
		expect(result).not.toContain('src="assets//test.png"');
	});

	it('should trim multiple trailing slashes from custom path', () => {
		const result = createHtmlImgTag(
			'test.png',
			'',
			'',
			{
				imageWidth: '80%',
				includeAlt: false,
				useCustomPath: true,
				customPath: 'assets///',
			}
		);

		expect(result).toContain('src="assets/test.png"');
		expect(result).not.toContain('src="assets///');
	});

	it('should fall back to imagePath when useCustomPath is true but customPath is empty', () => {
		const result = createHtmlImgTag(
			'test.png',
			'fallback/path/test.png',
			'',
			{
				imageWidth: '80%',
				includeAlt: false,
				useCustomPath: true,
				customPath: '',
			}
		);

		expect(result).toContain('src="fallback/path/test.png"');
		expect(result).not.toContain('src="/test.png"');
	});

	it('should handle relative path with parent directory traversal', () => {
		const result = createHtmlImgTag(
			'screenshot.png',
			'../../attachments/screenshot.png',
			'attachments',
			{
				imageWidth: '80%',
				includeAlt: true,
				useCustomPath: false,
				customPath: '',
			}
		);

		expect(result).toContain('src="../../attachments/screenshot.png"');
		expect(result).toContain('alt="screenshot.png"');
	});

	it('should prefer custom path over imagePath when useCustomPath is true', () => {
		const result = createHtmlImgTag(
			'image.png',
			'original/path/image.png',
			'original/path',
			{
				imageWidth: '80%',
				includeAlt: false,
				useCustomPath: true,
				customPath: './custom/path',
			}
		);

		expect(result).toContain('src="./custom/path/image.png"');
		expect(result).not.toContain('original/path');
	});
});

describe('replaceImageEmbedsWithHtml', () => {
	const config = {
		imageWidth: '80%',
		includeAlt: false,
		useCustomPath: false,
		customPath: '',
	}

	it('should replace a wikilink embed (spaces)', () => {
		const line = 'prefix ![[foo bar.png]] suffix'
		const result = replaceImageEmbedsWithHtml(line, 'foo bar.png', '', config)
		expect(result.didReplace).toBe(true)
		expect(result.replacedLine).toContain('prefix ')
		expect(result.replacedLine).toContain(' suffix')
		expect(result.replacedLine).toContain('<img src="foo bar.png"')
	})

	it('should replace a wikilink embed with pipe suffix', () => {
		const line = '![[foo bar.png|300]]'
		const result = replaceImageEmbedsWithHtml(line, 'foo bar.png', '', config)
		expect(result.didReplace).toBe(true)
		expect(result.replacedLine).toContain('<img src=\"foo bar.png\"')
	})

	it('should replace a wikilink embed (%20)', () => {
		const line = '![[foo%20bar.png]]'
		const result = replaceImageEmbedsWithHtml(line, 'foo bar.png', '', config)
		expect(result.didReplace).toBe(true)
		// Preserve the exact path extracted from the embed
		expect(result.replacedLine).toContain('<img src="foo%20bar.png"')
	})

	it('should replace a markdown embed with spaces', () => {
		const line = '![alt](foo bar.png)'
		const result = replaceImageEmbedsWithHtml(line, 'foo bar.png', '', config)
		expect(result.didReplace).toBe(true)
		expect(result.replacedLine).toContain('<img src="foo bar.png"')
	})

	it('should replace a markdown embed with angle brackets', () => {
		const line = '![alt](<foo bar.png>)'
		const result = replaceImageEmbedsWithHtml(line, 'foo bar.png', '', config)
		expect(result.didReplace).toBe(true)
		expect(result.replacedLine).toContain('<img src="foo bar.png"')
	})

	it('should not replace when the target filename is not present', () => {
		const line = '![[other.png]]'
		const result = replaceImageEmbedsWithHtml(line, 'foo bar.png', '', config)
		expect(result.didReplace).toBe(false)
		expect(result.replacedLine).toBe(line)
	})
})

describe('extractObsidianEmbedPath', () => {
	it('should extract path from wikilink embed', () => {
		expect(extractObsidianEmbedPath('![[appx/image.png]]')).toBe('appx/image.png')
	})

	it('should extract path from wikilink embed with width/alias', () => {
		expect(extractObsidianEmbedPath('![[appx/image.png|300]]')).toBe('appx/image.png')
		expect(extractObsidianEmbedPath('![[appx/image.png|Some caption]]')).toBe('appx/image.png')
	})

	it('should extract path from markdown embed', () => {
		expect(extractObsidianEmbedPath('![alt](appx/image.png)')).toBe('appx/image.png')
	})

	it('should extract path from markdown embed with angle brackets', () => {
		expect(extractObsidianEmbedPath('![alt](<appx/my image.png>)')).toBe('appx/my image.png')
	})

	it('should return null for non-embed strings', () => {
		expect(extractObsidianEmbedPath('appx/image.png')).toBeNull()
		expect(extractObsidianEmbedPath('[[appx/image.png]]')).toBeNull()
	})
})
