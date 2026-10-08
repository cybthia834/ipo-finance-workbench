import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/**', '.runtime/**', 'frontend/dist/**', '.venv/**'] },
  { files: ['frontend/src/**/*.{ts,tsx}'], extends: [js.configs.recommended, ...tseslint.configs.recommended],
    rules: {
      // Existing API records are incrementally typed; strict compiler checks stay enabled.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
);
