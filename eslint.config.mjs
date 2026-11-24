import tseslint from 'typescript-eslint';

export default [
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.svelte-kit/**'],
  },
  {
    files: ['packages/*/src/**/*.{ts,tsx}', 'scripts/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportDeclaration[source.value=/^\\.\\.?\\/.*\\.[mc]?jsx?$/]',
          message: 'Use .ts/.tsx extensions (not .js/.mjs/.cjs/.jsx) in relative TypeScript imports.',
        },
        {
          selector: 'ExportNamedDeclaration[source.value=/^\\.\\.?\\/.*\\.[mc]?jsx?$/]',
          message: 'Use .ts/.tsx extensions (not .js/.mjs/.cjs/.jsx) in relative TypeScript re-exports.',
        },
        {
          selector: 'ExportAllDeclaration[source.value=/^\\.\\.?\\/.*\\.[mc]?jsx?$/]',
          message: 'Use .ts/.tsx extensions (not .js/.mjs/.cjs/.jsx) in relative TypeScript re-exports.',
        },
        {
          selector: 'TSEnumDeclaration',
          message: 'Enums are non-erasable TypeScript syntax and unsupported by Node 24 type stripping. Use a union or const object instead.',
        },
        {
          // Ambient `declare module`/`declare global` blocks are erasable, so only flag runtime namespaces.
          selector: "TSModuleDeclaration[declare=false][kind!='global']",
          message: 'Namespaces/modules are non-erasable TypeScript syntax and unsupported by Node 24 type stripping.',
        },
        {
          selector: 'TSParameterProperty',
          message: 'Constructor parameter properties are non-erasable TypeScript syntax and unsupported by Node 24 type stripping.',
        },
      ],
    },
  },
];
