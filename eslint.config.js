import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'pitch/**', '**/*.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // Services and examples are processes: they are allowed to write to stdout.
    files: [
      'services/**/*.ts',
      'examples/**/*.ts',
      'packages/*/scripts/**/*.ts',
      'packages/*/src/**/cli.ts',
      '**/*-cli.ts',
    ],
    rules: { 'no-console': 'off' },
  },
);
