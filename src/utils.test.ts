import { path, sanitizer, escapeRegExp } from './utils';

describe('path.join', () => {
	it('should join simple path segments', () => {
		expect(path.join('folder', 'file.txt')).toBe('folder/file.txt');
	});

	it('should join multiple path segments', () => {
		expect(path.join('root', 'nested', 'deep', 'file.txt')).toBe('root/nested/deep/file.txt');
	});

	it('should handle empty segments by skipping them', () => {
		expect(path.join('folder', '', 'file.txt')).toBe('folder/file.txt');
	});

	it('should handle dot segments by removing them', () => {
		expect(path.join('folder', '.', 'file.txt')).toBe('folder/file.txt');
	});

	it('should preserve leading slash for absolute paths', () => {
		expect(path.join('', 'folder', 'file.txt')).toBe('/folder/file.txt');
	});

	it('should handle paths with slashes in segments', () => {
		expect(path.join('root/nested', 'deep/file.txt')).toBe('root/nested/deep/file.txt');
	});

	it('should handle vault root paths correctly', () => {
		expect(path.join('vault', 'attachments', 'image.png')).toBe('vault/attachments/image.png');
	});

	it('should handle duplicate slashes', () => {
		expect(path.join('folder//file.txt')).toBe('folder/file.txt');
	});
});

describe('path.basename', () => {
	it('should return last part of path', () => {
		expect(path.basename('folder/file.txt')).toBe('file.txt');
	});

	it('should return filename when given just a filename', () => {
		expect(path.basename('file.txt')).toBe('file.txt');
	});

	it('should handle deep paths', () => {
		expect(path.basename('root/nested/deep/file.txt')).toBe('file.txt');
	});

	it('should return empty string when path ends with slash', () => {
		expect(path.basename('folder/')).toBe('');
	});

	it('should handle paths with multiple dots', () => {
		expect(path.basename('path/to/archive.tar.gz')).toBe('archive.tar.gz');
	});
});

describe('path.extension', () => {
	it('should return extension without dot', () => {
		expect(path.extension('file.txt')).toBe('txt');
	});

	it('should return jpg for jpg images', () => {
		expect(path.extension('image.jpg')).toBe('jpg');
	});

	it('should return png for png images', () => {
		expect(path.extension('image.png')).toBe('png');
	});

	it('should handle files with multiple dots', () => {
		expect(path.extension('archive.tar.gz')).toBe('gz');
	});

	it('should handle files with no extension', () => {
		expect(path.extension('README')).toBe('README');
	});

	it('should handle paths with folders', () => {
		expect(path.extension('folder/subfolder/file.md')).toBe('md');
	});

	it('should handle hidden files', () => {
		expect(path.extension('.gitignore')).toBe('gitignore');
	});
});

describe('sanitizer.filename', () => {
	it('should keep most special characters allowed in filenames', () => {
		// @, $, and % are valid filename characters
		expect(sanitizer.filename('my image@#$%.png')).toBe('my image@$.png');
	});

	it('should keep allowed characters', () => {
		expect(sanitizer.filename('my-file_123.txt')).toBe('my-file_123.txt');
	});

	it('should keep spaces', () => {
		expect(sanitizer.filename('my image.png')).toBe('my image.png');
	});

	it('should trim leading and trailing whitespace', () => {
		expect(sanitizer.filename('  my file.txt  ')).toBe('my file.txt');
	});

	it('should handle unicode letters', () => {
		expect(sanitizer.filename('图像文件.png')).toBe('图像文件.png');
	});

	it('should keep at-signs in filename', () => {
		expect(sanitizer.filename('file@@@name.txt')).toBe('file@@@name.txt');
	});

	it('should handle empty string', () => {
		expect(sanitizer.filename('')).toBe('');
	});

	it('should keep punctuation that is allowed in filenames', () => {
		expect(sanitizer.filename('file-name_123.txt')).toBe('file-name_123.txt');
	});
});

describe('sanitizer.delimiter', () => {
	it('should return single dash for valid delimiter', () => {
		expect(sanitizer.delimiter('-')).toBe('-');
	});

	it('should return underscore for valid delimiter', () => {
		expect(sanitizer.delimiter('_')).toBe('_');
	});

	it('should trim but keep valid characters', () => {
		// @ and $ are valid, so they get kept
		expect(sanitizer.delimiter('@#$%')).toBe('@$');
	});

	it('should keep the full sanitized string', () => {
		expect(sanitizer.delimiter('--test')).toBe('--test');
	});

	it('should sanitize invalid characters', () => {
		// @ is valid, so it stays
		expect(sanitizer.delimiter('@_')).toBe('@_');
	});

	it('should handle single valid character', () => {
		expect(sanitizer.delimiter('~')).toBe('~');
	});
});

describe('sanitizer.spaceToUnderscore', () => {
	it('should convert single space to underscore', () => {
		expect(sanitizer.spaceToUnderscore('my file')).toBe('my_file');
	});

	it('should convert multiple spaces to underscores', () => {
		expect(sanitizer.spaceToUnderscore('my test file name')).toBe('my_test_file_name');
	});

	it('should handle string with no spaces', () => {
		expect(sanitizer.spaceToUnderscore('myfile')).toBe('myfile');
	});

	it('should handle empty string', () => {
		expect(sanitizer.spaceToUnderscore('')).toBe('');
	});

	it('should convert real-world filename with spaces', () => {
		expect(sanitizer.spaceToUnderscore('2021 - Compaleo - Spectral Domain')).toBe('2021_-_Compaleo_-_Spectral_Domain');
	});

	it('should preserve existing underscores', () => {
		expect(sanitizer.spaceToUnderscore('my_file name')).toBe('my_file_name');
	});

	it('should handle consecutive spaces', () => {
		expect(sanitizer.spaceToUnderscore('my  file')).toBe('my_file');
	});

	it('should handle leading and trailing spaces', () => {
		expect(sanitizer.spaceToUnderscore(' my file ')).toBe('my_file');
	});
});

describe('sanitizer workflow: filename then spaceToUnderscore', () => {
	it('should sanitize invalid characters before converting spaces', () => {
		// Simulates generateNewName workflow: sanitizer.spaceToUnderscore(sanitizer.filename(stemRaw))
		const input = 'My Note#Title/With:Invalid|Chars';
		const sanitized = sanitizer.spaceToUnderscore(sanitizer.filename(input));
		expect(sanitized).toBe('My_NoteTitleWithInvalidChars');
	});

	it('should handle template output with special characters and spaces', () => {
		// Note: < and > are allowed by sanitizer.filename (as used in HTML-like patterns)
		// The slash / is removed as an invalid character
		const input = '  test<script>alert(1)</script>file name  ';
		const sanitized = sanitizer.spaceToUnderscore(sanitizer.filename(input));
		expect(sanitized).toBe('test<script>alert(1)<script>file_name');
	});

	it('should produce valid filename from unicode input with spaces', () => {
		const input = '日本語 ファイル 名前';
		const sanitized = sanitizer.spaceToUnderscore(sanitizer.filename(input));
		expect(sanitized).toBe('日本語_ファイル_名前');
	});

	it('should handle frontmatter value with pipe characters', () => {
		// Common case: imageNameKey might have pipe separators
		const input = 'project|section|image';
		const sanitized = sanitizer.spaceToUnderscore(sanitizer.filename(input));
		expect(sanitized).toBe('projectsectionimage');
	});
});

describe('escapeRegExp', () => {
	it('should escape special regex characters', () => {
		expect(escapeRegExp('.*+?^${}()|[]\\\\')).toBe('\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\\\\\');
	});

	it('should not change regular characters', () => {
		expect(escapeRegExp('abc123')).toBe('abc123');
	});

	it('should escape dot', () => {
		expect(escapeRegExp('file.txt')).toBe('file\\.txt');
	});

	it('should escape parentheses', () => {
		expect(escapeRegExp('image(1).png')).toBe('image\\(1\\)\\.png');
	});

	it('should be usable in regex', () => {
		const escaped = escapeRegExp('test.file');
		const regex = new RegExp(escaped);
		expect(regex.test('test.file')).toBe(true);
		expect(regex.test('testXfile')).toBe(false);
	});

	it('should handle empty string', () => {
		expect(escapeRegExp('')).toBe('');
	});

	it('should escape all bracket types', () => {
		expect(escapeRegExp('[]()')).toBe('\\[\\]\\(\\)');
	});
});
