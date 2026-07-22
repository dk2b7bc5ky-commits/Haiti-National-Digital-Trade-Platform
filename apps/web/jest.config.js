/**
 * Unit tests for the web app's pure logic (money formatting, deadline
 * countdowns, API-envelope handling). Component/page rendering is covered by
 * the API e2e suite + manual demo pass; these lock in the client-side helpers.
 */
module.exports = {
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  testMatch: ['<rootDir>/lib/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        isolatedModules: true,
        tsconfig: {
          target: 'ES2021',
          module: 'commonjs',
          esModuleInterop: true,
          jsx: 'react-jsx',
          skipLibCheck: true,
        },
      },
    ],
  },
};
