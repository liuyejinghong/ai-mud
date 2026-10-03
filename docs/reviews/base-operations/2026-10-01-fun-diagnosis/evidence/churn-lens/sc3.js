const { email, pass } = cred();
await click('试玩注册');
await sleep(800);
const t1 = await text();
return { form: t1.slice(0, 600), email };
