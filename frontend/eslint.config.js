// Flat-config ESLint for the Simi frontend (ESLint v9 + typescript-eslint).
import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: './tsconfig.json',
        ecmaVersion: 2023,
        sourceType: 'module',
      },
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      // React hooks exhaustive-deps check.
      ...reactHooks.configs.recommended.rules,
      // New strict react-hooks rules — valid patterns that trigger them:
      // - set-state-in-effect: synchronizing derived state from external
      //   sources (media queries, prop resets) is a documented React pattern
      // - refs: the "latest ref" pattern (ref.current = value during
      //   render) is the standard way to give stable callbacks fresh data
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      // Warn on non-refresh-safe exports (components or hooks that capture
      // state / closures that won't survive HMR).  AllowsRefreshExport is
      // the plugin's recommended level — it only warns, never errors.
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Consistent with backend lint config.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      // Handled by @typescript-eslint/no-unused-vars above.
      'no-unused-vars': 'off',
      // TypeScript already catches undefined identifiers at compile time.
      'no-undef': 'off',
    },
  },
  // Test files: relax rules that are commonly needed for test helpers.
  {
    files: ['src/**/*.test.{ts,tsx}', 'src/**/__tests__/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
];
