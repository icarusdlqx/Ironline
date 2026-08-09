import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const SIM_FORBIDDEN_LAYERS = ['render', 'render3d', 'ui', 'campaign'];

const simForbiddenPatterns = SIM_FORBIDDEN_LAYERS.flatMap((layer) => [
  `**/${layer}`,
  `**/${layer}/**`,
]);

export default tseslint.config(
  { ignores: ['dist/**', 'dist-single/**', 'coverage/**', 'node_modules/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: simForbiddenPatterns,
              allowTypeImports: false,
              message:
                '/sim is pure and deterministic: it must never import from a rendering, UI or campaign layer.',
            },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'All randomness in /sim flows through ctx.rng.',
        },
        {
          object: 'Date',
          property: 'now',
          message: '/sim is deterministic: derive time from the world tick, not the wall clock.',
        },
        {
          object: 'performance',
          property: 'now',
          message: '/sim is deterministic: derive time from the world tick, not the wall clock.',
        },
      ],
    },
  },
);
