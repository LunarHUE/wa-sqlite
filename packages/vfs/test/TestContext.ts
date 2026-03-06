import * as Comlink from 'comlink';

const TEST_WORKER_URL = './test-worker.ts';
const TEST_WORKER_TERMINATE = true;

const mapProxyToReleaser = new WeakMap();
const workerFinalization = new FinalizationRegistry<() => void>(release => release());

interface TestContextParams {
  build?: string;
  config?: string;
  reset?: boolean;
}

const DEFAULT_PARAMS: Required<TestContextParams> = Object.freeze({
  build: 'default',
  config: 'default',
  reset: true,
});

export class TestContext {
  #params: Required<TestContextParams> = structuredClone(DEFAULT_PARAMS);

  constructor(params: TestContextParams = {}) {
    Object.assign(this.#params, params);
  }

  async create(extras: Record<string, unknown> = {}) {
    const url = new URL(TEST_WORKER_URL, import.meta.url);
    for (const [key, value] of Object.entries(this.#params)) {
      url.searchParams.set(key, value.toString());
    }
    for (const [key, value] of Object.entries(extras)) {
      url.searchParams.set(key, String(value));
    }

    const worker = new Worker(url, { type: 'module' });
    const port = await new Promise<MessagePort>((resolve, reject) => {
      worker.addEventListener('message', (event) => {
        if (event.ports[0]) {
          return resolve(event.ports[0]);
        }
        const e = new Error((event.data as any).message);
        reject(Object.assign(e, event.data));
      }, { once: true });
    });

    const proxy = Comlink.wrap(port);
    if (TEST_WORKER_TERMINATE) {
      function releaser() {
        worker.terminate();
      }
      mapProxyToReleaser.set(proxy, releaser);
      workerFinalization.register(proxy, releaser, releaser);
    }

    return proxy;
  }

  async destroy(proxy: any) {
    proxy[Comlink.releaseProxy]();
    const releaser = mapProxyToReleaser.get(proxy);
    if (releaser) {
      workerFinalization.unregister(releaser);
      releaser();
    }
  }

  // https://github.com/WebAssembly/js-promise-integration/issues/21#issuecomment-1634843621
  static async supportsJSPI(): Promise<boolean> {
    try {
      const m = new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 1, 111, 0, 3, 2, 1, 0, 7, 5, 1,
        1, 111, 0, 0, 10, 4, 1, 2, 0, 11,
      ]);
      const { instance } = await WebAssembly.instantiate(m);
      // @ts-ignore
      new WebAssembly.Function(
        {
          parameters: [],
          results: ['externref'],
        },
        instance.exports.o,
        { promising: 'first' }
      );
      return true;
    } catch (e) {
      return false;
    }
  }
}
