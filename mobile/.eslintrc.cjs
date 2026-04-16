/**
 * ESLint config — mobile (Expo + React Native + TypeScript).
 *
 * Includes eslint-plugin-react-native for RN-specific checks
 * (unused styles, raw text outside <Text>, etc.).
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
    'plugin:react-native/all',
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
    // Debt — Block 8 addresses mobile types
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    '@typescript-eslint/no-non-null-assertion': 'warn',
    'no-console': ['warn', { allow: ['warn', 'error'] }],

    // RN specifics — noisy, warn only
    'react-native/no-inline-styles': 'off', // we use a lot of them intentionally
    'react-native/no-color-literals': 'off',
    'react-native/no-raw-text': 'warn',
    'react-native/no-unused-styles': 'warn',
    'react-native/sort-styles': 'off',

    // Real bugs — stay errors
    'no-debugger': 'error',
    'no-undef': 'off',
    'no-empty': ['warn', { allowEmptyCatch: true }],
    'no-useless-escape': 'warn',
    'react/prop-types': 'off',
    'react/react-in-jsx-scope': 'off',
    'react/no-unescaped-entities': 'warn',
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',

    'prettier/prettier': 'warn',
  },
};
