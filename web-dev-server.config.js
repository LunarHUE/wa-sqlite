export default {
  nodeResolve: true,
  middleware: [
    (ctx, next) => {
      if (ctx.path === '/') {
        ctx.redirect('/demo/demo.html');
        return;
      }
      return next();
    },
  ],
};
