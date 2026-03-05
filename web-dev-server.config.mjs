export default {
  nodeResolve: true,
  middleware: [
    async (ctx, next) => {
      if (ctx.path.endsWith('.wasm')) {
        ctx.type = 'application/wasm';
      }
    },
    (ctx, next) => {
      if (ctx.path === '/') {
        ctx.redirect('/demo/demo.html');
        return;
      }
      return next();
    },
  ],
};
