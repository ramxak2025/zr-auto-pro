/**
 * ESLint config — backend (NestJS + TypeScript).
 *
 * Strategy: warn on existing debt (any, unused vars), error on real bugs.
 * This lets CI pass while we tighten rules block by block.
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'prettier'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  env: {
    node: true,
    es2022: true,
  },
  ignorePatterns: ['dist', 'node_modules', '.eslintrc.cjs', 'migrations'],
  rules: {
    // Debt — tightened in later blocks
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-console': ['warn', { allow: ['warn', 'error'] }],

    // Real bugs — stay errors
    'no-debugger': 'error',
    'no-undef': 'off', // TS handles this better
    'no-useless-escape': 'warn', // existing regex debt — clean up in later blocks
    '@typescript-eslint/no-floating-promises': 'off', // async hygiene — enable later
    '@typescript-eslint/no-non-null-assertion': 'warn',

    // Prettier integration
    'prettier/prettier': 'warn',
  },
};
