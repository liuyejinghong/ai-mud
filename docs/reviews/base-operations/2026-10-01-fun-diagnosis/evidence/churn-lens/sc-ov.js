await click('生产总览');
await sleep(800);
return (await text()).slice(0, 1600);
