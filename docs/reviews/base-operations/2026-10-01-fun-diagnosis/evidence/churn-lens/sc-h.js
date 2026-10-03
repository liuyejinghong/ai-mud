const h = await ev(`document.documentElement.outerHTML`);
const i = h.indexOf('生产总览');
return h.slice(Math.max(0, i - 400), i + 200);
