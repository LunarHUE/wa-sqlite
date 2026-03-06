import { chromeLauncher } from '@web/test-runner';
import { esbuildPlugin } from '@web/dev-server-esbuild';

export default /** @type {import("@web/test-runner").TestRunnerConfig} */ ({
  files: ['./test/*.test.ts'],
  nodeResolve: true,
  browserLogs: true,
  browserStartTimeout: 60_000,
  testFramework: {
    config: {
      timeout: 5 * 60 * 1000,
    },
  },
  plugins: [
    esbuildPlugin({ ts: true }),
  ],
  concurrency: 1,
  concurrentBrowsers: 1,
  browsers: [
    chromeLauncher({
      launchOptions: {
        args: [
          '--flag-switches-begin',
          '--enable-features=WebAssemblyExperimentalJSPI',
          '--flag-switches-end'
        ],
      },
    }),
  ],
});
