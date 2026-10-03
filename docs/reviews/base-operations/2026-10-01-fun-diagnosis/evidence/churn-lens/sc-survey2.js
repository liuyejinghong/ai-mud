const r = await ev(`(() => {
  const sel = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.text.includes('望山')));
  if (!sel) return 'no-select';
  const opt = [...sel.options].find(o => o.text.includes('待命'));
  if (!opt) return 'no-option';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setter.call(sel, opt.value);
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return 'selected:' + opt.text.slice(0, 30);
})()`);
if (String(r).startsWith('selected')) {
  await sleep(400);
  await click('开始勘探');
  await sleep(800);
}
await click('返回地图');
await sleep(400);
await click('恢复');
await sleep(500);
await click('×4');
await sleep(45000);
const t = await text();
await shot('/tmp/yudian-cdp/E-after-survey.png');
const i = t.indexOf('脊线蓝绿氧化带', 200);
return { sel: r, after: t.slice(i >= 0 ? i : 0, (i >= 0 ? i : 0) + 400) };
