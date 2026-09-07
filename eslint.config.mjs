import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import sonarjs from 'eslint-plugin-sonarjs';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/frontend-original/**',
      '**/frontend-patches/**',
      '**/historical/**',
      '**/crawled_guides/**',
      '**/reconstruction/**',
      '**/reconstruction-report/**',
      '**/restored/**',
      '**/artifacts/**',
      '**/test-results/**',
      '**/playwright-report/**',
      '**/data/decompile/**',
      '**/*.d.ts'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  sonarjs.configs.recommended,
  {
    files: ['server/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'sonarjs/cognitive-complexity': ['warn', 25],
      'sonarjs/no-duplicate-string': 'off',
      'sonarjs/todo-tag': 'off',
      'sonarjs/no-commented-code': 'off',
      'sonarjs/pseudo-random': 'off',
      'sonarjs/slow-regex': 'off',
      'no-undef': 'off'
    }
  }
);
