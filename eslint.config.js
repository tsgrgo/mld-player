import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';

export default defineConfig([
	tseslint.configs.recommendedTypeChecked,
	{
		files: ['**/*.{js,mjs,cjs,ts,mts,cts}'],
		plugins: { js },
		extends: ['js/recommended'],
		languageOptions: {
			globals: globals.browser,
			parserOptions: {
				project: './tsconfig.json'
			}
		},
		rules: {
			'@typescript-eslint/no-floating-promises': 'warn',
			'@typescript-eslint/restrict-plus-operands': 'off',
			'@typescript-eslint/no-unused-vars': 'off',
			'no-useless-catch': 'off',
			'no-case-declarations': 'off',
			'no-unused-vars': 'off',
			'no-empty': 'off'
		}
	}
]);
