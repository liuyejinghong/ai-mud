const t = await text();
const i = t.indexOf('生产总览');
await shot('/tmp/yudian-cdp/E-overview.png');
return t.slice(i, i + 900);
