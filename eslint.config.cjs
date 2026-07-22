const tsPlugin = require('@typescript-eslint/eslint-plugin');

module.exports = [
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    languageOptions: {
      parser: require('@typescript-eslint/parser'),
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: './tsconfig.json',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      // include TypeScript recommended rules from the plugin
      ...(tsPlugin && tsPlugin.configs && tsPlugin.configs.recommended && tsPlugin.configs.recommended.rules ? tsPlugin.configs.recommended.rules : {}),
    },
  },
];
