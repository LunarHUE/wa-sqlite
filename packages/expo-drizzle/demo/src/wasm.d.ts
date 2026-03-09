// Type stub for the Emscripten-generated wa-sqlite WASM module factory.
declare module '@lunarhue/wa-sqlite-wasm/wa-sqlite-async.mjs' {
  type WaModuleFactory = (options?: {
    locateFile?: (filename: string) => string;
    wasmBinary?: ArrayBuffer;
  }) => Promise<any>;

  const factory: WaModuleFactory;
  export default factory;
}
