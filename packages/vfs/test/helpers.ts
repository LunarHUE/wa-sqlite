import { expect as chaiExpect } from '@esm-bundle/chai';

export { chaiExpect as expect };

interface ExpectAsyncResult {
  toBeResolvedTo(expected: unknown): Promise<void>;
  toBeRejectedWithError(pattern: RegExp | string): Promise<void>;
  toBeRejectedWith(expected: Error | string | RegExp): Promise<void>;
  toBeRejected(): Promise<void>;
  toBePending(): Promise<void>;
}

export function expectAsync(promise: Promise<unknown>): ExpectAsyncResult {
  return {
    async toBeResolvedTo(expected: unknown) {
      chaiExpect(await promise).to.deep.equal(expected);
    },
    async toBeRejectedWithError(pattern: RegExp | string) {
      let rejected = false;
      let error: unknown;
      try {
        await promise;
      } catch (e) {
        rejected = true;
        error = e;
      }
      chaiExpect(rejected, 'Expected promise to be rejected').to.be.true;
      if (pattern instanceof RegExp) {
        chaiExpect((error as Error).message).to.match(pattern);
      } else {
        chaiExpect((error as Error).message).to.include(pattern);
      }
    },
    async toBeRejectedWith(expected: Error | string | RegExp) {
      let rejected = false;
      let error: unknown;
      try {
        await promise;
      } catch (e) {
        rejected = true;
        error = e;
      }
      chaiExpect(rejected, 'Expected promise to be rejected').to.be.true;
      if (expected instanceof Error) {
        chaiExpect((error as Error).message).to.equal(expected.message);
      } else if (expected instanceof RegExp) {
        chaiExpect((error as Error).message).to.match(expected);
      } else {
        chaiExpect((error as Error).message).to.include(expected);
      }
    },
    async toBeRejected() {
      let rejected = false;
      try {
        await promise;
      } catch {
        rejected = true;
      }
      chaiExpect(rejected, 'Expected promise to be rejected').to.be.true;
    },
    async toBePending() {
      const pending = Symbol('pending');
      const result = await Promise.race([promise, Promise.resolve(pending)]);
      chaiExpect(result, 'Expected promise to be pending').to.equal(pending);
    },
  };
}
