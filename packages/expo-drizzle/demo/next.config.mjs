/** @type {import('next').NextConfig} */
const nextConfig = {
  // Transpile workspace packages that ship TypeScript source
  transpilePackages: ['@lunarhue/expo-wa-sqlite'],

  webpack(config) {
    // wa-sqlite-async.mjs is an Emscripten module — tell webpack not to
    // parse it so it can fetch the WASM binary at runtime via locateFile.
    config.module.rules.push({
      test: /wa-sqlite-async\.mjs$/,
      type: 'javascript/auto',
    });
    return config;
  },
};

export default nextConfig;
