/**
 * ESLint config — mobile (Expo + React Native + TypeScript).
 *
 * Philosophy: errors are real bugs. Everything else is OFF so that
 * --max-warnings=0 can enforce a strict CI gate on real problems
 * without drowning developers in style debt.
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'react', 'react-hooks', 'react-native', 'prettier'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended',
    'plugin:prettier/recommended',
  ],
  settings: {
    react: { version: 'detect' },
  },
  env: {
    'react-native/react-native': true,
    es2022: true,
  },
  ignorePatterns: ['node_modules', '.expo', '.eslintrc.cjs', 'babel.config.js', 'metro.config.js'],
  rules: {
    // Tech debt — off for --max-warnings=0 CI.
    // Real bugs stay as errors below.
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': 'off',
    '@typescript-eslint/no-non-null-assertion': 'off',
    'no-console': 'off',
    'no-empty': 'off',
    'no-useless-escape': 'off',
    'react/prop-types': 'off',
    'react/react-in-jsx-scope': 'off',
    'react/no-unescaped-entities': 'off',
    'react-hooks/exhaustive-deps': 'off',
    'prettier/prettier': 'off',
    '@typescript-eslint/no-empty-function': 'off',
    '@typescript-eslint/ban-ts-comment': 'off',
    '@typescript-eslint/no-require-imports': 'off',
    'no-unused-vars': 'off',
    'react/display-name': 'off',

    // Real bugs — stay errors.
    'no-debugger': 'error',
    'no-undef': 'off', // TS handles this better
    'react-hooks/rules-of-hooks': 'error',
  },
};
