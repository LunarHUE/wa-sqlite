export * from './sqlite-constants';
export declare class SQLiteError extends Error {
    code: number;
    constructor(message: string, code: number);
}
/**
 * Builds a Javascript API from the Emscripten module. This API is still
 * low-level and closely corresponds to the C API exported by the module,
 * but differs in some specifics like throwing exceptions on errors.
 */
export declare function Factory(Module: any): any;
