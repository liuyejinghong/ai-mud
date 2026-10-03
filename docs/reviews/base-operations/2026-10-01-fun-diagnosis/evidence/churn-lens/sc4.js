const html = await ev('document.documentElement.outerHTML');
const i = html.indexOf('试玩注册');
return html.slice(Math.max(0, i - 800), i + 1200);
