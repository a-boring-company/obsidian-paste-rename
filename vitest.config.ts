import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts'],
		coverage: {
			provider: 'v8',
			reportsDirectory: '.tmp/coverage',
			include: [
				'src/attachment-types.ts',
				'src/filename.ts',
				'src/figure.ts',
				'src/embeds.ts',
				'src/attachment-path.ts',
				'src/batch-state.ts',
				'src/embed-location.ts',
				'src/template.ts',
				'src/burst.ts',
				'src/retry.ts',
				'src/write-queue.ts',
				'src/attachment-links.ts',
				'src/attachment-reference.ts',
				'src/attachment-type-state.ts',
			],
			thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
		},
	},
})
