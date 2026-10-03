const probe = await ev(`(() => {
  const btns = [...document.querySelectorAll('button')].filter(b => (b.innerText||'').includes('总览') || (b.innerText||'').includes('加工'));
  return JSON.stringify(btns.map(b => { const r = b.getBoundingClientRect(); return { t: (b.innerText||'').trim().slice(0,20), x: r.x, y: r.y, w: r.width, h: r.height }; }));
})()`);
return JSON.parse(probe);
