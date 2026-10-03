const { email, pass } = cred();
await fill('#base-auth-email', email);
await fill('#base-auth-password', pass);
const v = await ev(`JSON.stringify({e: document.querySelector('#base-auth-email').value.length, p: document.querySelector('#base-auth-password').value.length})`);
await click('领取试玩基地');
await sleep(3000);
return { fieldLens: JSON.parse(v), after: (await text()).slice(0, 400) };
