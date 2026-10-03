await click('脊线蓝绿氧化带');
await sleep(1000);
const t = await text();
const i = t.indexOf('脊线蓝绿氧化带', 200);
await shot('/tmp/yudian-cdp/E-mine-panel.png');
return t.slice(i >= 0 ? i : 0, (i >= 0 ? i : 0) + 800);
