import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

/**
 * Flat ESLint config.
 * eslint-config-next 16 ships flat-config arrays directly, so FlatCompat is
 * not used (it cannot serialise the plugin graph these configs produce).
 */
const config = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'coverage/**',
      'src/generated/**',
      'playwright-report/**',
      'test-results/**',
      '.pgdata/**',
      '.storage/**',
      'next-env.d.ts',
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // Scripts, seeds and tests run outside Next and may log freely.
    files: ['scripts/**/*.ts', 'prisma/**/*.ts', 'tests/**/*.{ts,tsx}'],
    rules: { 'no-console': 'off' },
  },
];

export default config;
