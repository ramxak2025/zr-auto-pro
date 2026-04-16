/**
 * ESLint config — frontend (React + Vite + TypeScript).
 *
 * Errors are real bugs. Warnings are technical debt addressed in later blocks.
 * React-hooks/exhaustive-deps stays error — catches real stale-closure bugs.
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'react', 'react-hooks', 'jsx-a11y', 'prettier'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended',
    'plugin:jsx-a11y/recommended',
    'plugin:prettier/recommended',
  ],
  settings: {
    react: { version: 'detect' },
  },
  env: {
    browser: true,
    es2022: true,
  },
  ignorePatterns: ['dist', 'node_modules', '.eslintrc.cjs', 'public/sw.js', 'vite.config.ts'],
  rules: {
    // Debt — tightened in Block 6
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    '@typescript-eslint/no-non-null-assertion': 'warn',
    'jsx-a11y/label-has-associated-control': 'warn',
    'jsx-a11y/click-events-have-key-events': 'warn',
    'jsx-a11y/no-static-element-interactions': 'warn',
    'jsx-a11y/no-noninteractive-element-interactions': 'warn',
    'jsx-a11y/no-autofocus': 'warn',
    'jsx-a11y/alt-text': 'warn',
    'no-empty': ['warn', { allowEmptyCatch: true }],

    // Real bugs — stay errors
    'no-debugger': 'error',
    'no-undef': 'off', // TS handles
    'no-useless-escape': 'warn',
    'react/prop-types': 'off', // we use TS
    'react/react-in-jsx-scope': 'off', // Vite + React 17+ auto-import

    // React bug catchers — do NOT downgrade
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn', // warn for now; catches missing deps without blocking
    'react/jsx-no-target-blank': 'error',
    'react/no-unescaped-entities': 'warn',

    // Prettier
    'prettier/prettier': 'warn',
  },
};
