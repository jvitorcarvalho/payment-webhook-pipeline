// ESLint flat config. typescript-eslint gives type-aware-free strict rules;
// eslint-config-prettier turns off style rules so Prettier owns formatting.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['node_modules/', 'dist/', 'coverage/', '.env', '.env.*', '!.env.example'],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  prettier,
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly' },
    },
  },
);
