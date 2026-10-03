const t = await text();
const probe = await ev(`(() => {
  const btns = [...document.querySelectorAll('button')].map(b => ({ t: (b.innerText||'').trim().slice(0,20), vis: b.getBoundingClientRect().width > 0 }));
  return JSON.stringify({ url: location.href.slice(0,60), btns: btns.slice(0, 40) });
})()`);
return { body: t.slice(0, 200), probe: JSON.parse(probe) };
