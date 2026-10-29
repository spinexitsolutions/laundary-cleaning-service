(() => {
  const D = window.BOOK;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const cur = window.CUR || '₹';
  const fmt = (n) => cur + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const form = $('#bookForm');

  const state = { services: new Set(), qty: {}, kg: {}, step: 0 };
  if (D.preselect) state.services.add(Number(D.preselect));

  const svc = (id) => D.services.find((s) => s.id === Number(id));
  const ICONS = {};
  $$('.svc-opt').forEach((b) => (ICONS[b.dataset.svc] = $('.ic-box', b).innerHTML));
  const plus = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
  const minus = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/></svg>';

  /* ---- step 1: services ---- */
  function paintServices() {
    $$('.svc-opt').forEach((b) => b.classList.toggle('on', state.services.has(Number(b.dataset.svc))));
    const n = state.services.size;
    $('[data-svc-count]').textContent = n ? `${n} service${n > 1 ? 's' : ''} selected` : 'No service selected';
  }
  $$('.svc-opt').forEach((b) => b.addEventListener('click', () => {
    const id = Number(b.dataset.svc);
    state.services.has(id) ? state.services.delete(id) : state.services.add(id);
    paintServices(); buildItems(); quote();
  }));

  /* ---- step 2: items ---- */
  function buildItems() {
    const wrap = $('#itemBlocks');
    wrap.innerHTML = '';
    [...state.services].forEach((sid) => {
      const s = svc(sid); if (!s) return;
      const block = document.createElement('div');
      block.className = 'svc-block';
      let body = '';
      if (s.mode === 'per_kg') {
        const v = state.kg[sid] ?? 0;
        body = `<div class="kg-box"><div class="kg-val"><span data-kgv>${v}</span> <small>kg · ${fmt(s.kg)}/kg</small></div>
          <input type="range" min="0" max="25" step="0.5" value="${v}" data-kg="${sid}" aria-label="Estimated weight">
          <p style="margin:6px 0 0;color:var(--muted);font-size:.88rem">A typical week for one person is about 4–5 kg. Final weight is measured at pickup.</p></div>`;
      } else {
        const items = D.items.filter((it) => it.prices[sid] != null);
        const cats = D.cats.filter((c) => items.some((it) => it.cat === c.id));
        body = `<div class="cat-tabs">${cats.map((c, i) => `<button type="button" class="cat-tab ${i ? '' : 'on'}" data-cat="${c.id}">${c.name}</button>`).join('')}</div>
          <div class="item-list">${items.map((it) => {
            const k = `${sid}_${it.id}`; const q = state.qty[k] || 0;
            return `<div class="item-row ${q ? 'has' : ''}" data-icat="${it.cat}" ${cats[0] && it.cat !== cats[0].id ? 'hidden' : ''}>
              <span class="nm">${it.name}</span><span class="pr">${fmt(it.prices[sid])}<small style="font-weight:400">/${it.unit}</small></span>
              <span class="qty"><button type="button" data-dec="${k}" aria-label="Less">${minus}</button><output>${q}</output><button type="button" data-inc="${k}" aria-label="More">${plus}</button></span></div>`;
          }).join('') || '<p style="color:var(--muted)">Items for this service are priced at pickup.</p>'}</div>`;
      }
      block.innerHTML = `<div class="svc-block-head"><span class="ic-box" style="width:40px;height:40px;border-radius:12px;display:grid;place-items:center;background:${s.color}">${ICONS[sid] || ''}</span><b>${s.title}</b><small>${s.mode === 'per_kg' ? 'BY WEIGHT' : 'PER ITEM'}</small></div>${body}`;
      wrap.appendChild(block);
    });
    if (!state.services.size) wrap.innerHTML = '<p style="color:var(--muted)">Go back and choose a service first.</p>';
  }

  $('#itemBlocks').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-cat]');
    if (tab) {
      const block = tab.closest('.svc-block');
      $$('[data-cat]', block).forEach((t) => t.classList.toggle('on', t === tab));
      $$('[data-icat]', block).forEach((r) => (r.hidden = r.dataset.icat !== tab.dataset.cat));
      return;
    }
    const inc = e.target.closest('[data-inc]'); const dec = e.target.closest('[data-dec]');
    if (!inc && !dec) return;
    const k = (inc || dec).dataset[inc ? 'inc' : 'dec'];
    state.qty[k] = Math.max(0, (state.qty[k] || 0) + (inc ? 1 : -1));
    const row = (inc || dec).closest('.item-row');
    $('output', row).textContent = state.qty[k];
    row.classList.toggle('has', state.qty[k] > 0);
    if (state.qty[k] > 0) $('#countLater').checked = false;
    quote();
  });
  $('#itemBlocks').addEventListener('input', (e) => {
    if (!e.target.dataset.kg) return;
    state.kg[e.target.dataset.kg] = Number(e.target.value);
    e.target.closest('.kg-box').querySelector('[data-kgv]').textContent = e.target.value;
    if (Number(e.target.value)) $('#countLater').checked = false;
    quote();
  });
  $('#countLater').addEventListener('change', (e) => { if (e.target.checked) { state.qty = {}; state.kg = {}; buildItems(); quote(); } });

  /* ---- steps ---- */
  function validate(step) {
    if (step === 0 && !state.services.size) return 'Please choose at least one service.';
    if (step === 1) {
      const hasItems = Object.values(state.qty).some(Boolean) || Object.values(state.kg).some(Boolean);
      if (!hasItems && !$('#countLater').checked) return 'Add a few items, or tick “count everything at pickup”.';
      if (hasItems && lastQuote && lastQuote.subtotal < D.minOrder) return `Minimum order is ${fmt(D.minOrder)} — add a little more, or choose “count at pickup”.`;
    }
    if (step === 2) {
      if (!/^\d{6}$/.test(form.pincode.value.trim())) return 'Please enter a valid 6-digit pincode.';
      if (pinOk === false) return 'Sorry, we don’t serve that pincode yet.';
    }
    if (step === 3) {
      if (!form.name.value.trim()) return 'Please enter your name.';
      if (form.phone.value.replace(/\D/g, '').length < 10) return 'Please enter a valid phone number.';
      if (!form.address.value.trim()) return 'Please enter your pickup address.';
    }
    return null;
  }
  function toast(msg) {
    let t = $('.toasts'); if (!t) { t = document.createElement('div'); t.className = 'toasts'; document.body.appendChild(t); }
    const el = document.createElement('div'); el.className = 'toast error'; el.textContent = msg; t.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }
  function go(n) {
    for (let i = state.step; i < n; i++) { const err = validate(i); if (err) { toast(err); n = i; break; } }
    state.step = n;
    $$('[data-panel]').forEach((p) => p.classList.toggle('on', Number(p.dataset.panel) === n));
    $$('[data-goto]').forEach((b) => { const i = Number(b.dataset.goto); b.classList.toggle('on', i === n); b.classList.toggle('done', i < n); });
    window.scrollTo({ top: form.getBoundingClientRect().top + scrollY - 100, behavior: 'smooth' });
  }
  $$('[data-next]').forEach((b) => b.addEventListener('click', () => go(state.step + 1)));
  $$('[data-prev]').forEach((b) => b.addEventListener('click', () => go(state.step - 1)));
  $$('[data-goto]').forEach((b) => b.addEventListener('click', () => go(Number(b.dataset.goto))));

  /* ---- pincode ---- */
  let pinOk = null;
  const pinMsg = $('#pinMsg');
  async function checkPin() {
    const v = form.pincode.value.trim();
    if (!/^\d{6}$/.test(v)) { pinOk = null; pinMsg.textContent = ''; return; }
    const r = await fetch('/api/pincode?pin=' + v).then((x) => x.json()).catch(() => null);
    if (!r) return;
    pinOk = r.ok;
    pinMsg.className = 'pin-result ' + (r.ok ? 'ok' : 'no');
    pinMsg.textContent = r.area ? `✓ We serve ${r.area}` : r.ok ? '✓ Pickup available' : '✕ Sorry, we don’t pick up here yet';
    quote();
  }
  form.pincode.addEventListener('input', checkPin);
  if (form.pincode.value) checkPin();

  // hide today's slots that are already over
  function filterSlots() {
    const d = form.querySelector('[name=pickup_date]:checked');
    const today = d && d.closest('.date-pick').querySelector('input') === d;
    const now = new Date(); const hm = now.getHours() * 60 + now.getMinutes();
    let firstVisible = null;
    $$('[name=pickup_slot]').forEach((r) => {
      const [h, m] = (r.dataset.end || '23:59').split(':').map(Number);
      const past = today && h * 60 + m - 60 < hm;
      r.closest('.slot-opt').hidden = past;
      if (past && r.checked) r.checked = false;
      if (!past && !firstVisible) firstVisible = r;
    });
    if (!form.querySelector('[name=pickup_slot]:checked') && firstVisible) firstVisible.checked = true;
    if (today && !firstVisible) { const next = $$('[name=pickup_date]')[1]; if (next) { next.checked = true; filterSlots(); } }
    const dd = form.querySelector('[name=pickup_date]:checked');
    $('#sumDate').textContent = dd ? new Date(dd.value + 'T00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }).toUpperCase() : '—';
  }
  $$('[name=pickup_date]').forEach((r) => r.addEventListener('change', filterSlots));
  filterSlots();
  $$('[name=delivery_type]').forEach((r) => r.addEventListener('change', quote));

  // saved addresses
  $$('[data-addr]').forEach((b) => b.addEventListener('click', () => {
    const a = JSON.parse(b.dataset.addr);
    form.address.value = a.address || ''; form.landmark.value = a.landmark || '';
    if (a.pincode) { form.pincode.value = a.pincode; checkPin(); }
  }));

  /* ---- coupon ---- */
  $('#couponBtn').addEventListener('click', () => { $('#couponField').value = $('#couponInput').value.trim(); quote(true); });

  /* ---- live quote ---- */
  let lastQuote = null; let timer;
  function cart() {
    const items = Object.entries(state.qty).filter(([, q]) => q > 0).map(([k, qty]) => { const [service_id, item_id] = k.split('_').map(Number); return { service_id, item_id, qty }; })
      .filter((i) => state.services.has(i.service_id));
    const kg = Object.fromEntries(Object.entries(state.kg).filter(([sid, v]) => v > 0 && state.services.has(Number(sid))));
    return { items, kg, services: [...state.services] };
  }
  function lines() {
    const c = cart(); const out = [];
    c.items.forEach((i) => { const it = D.items.find((x) => x.id === i.item_id); const s = svc(i.service_id); out.push([`${i.qty} × ${it.name} · ${s.title}`, it.prices[i.service_id] * i.qty]); });
    Object.entries(c.kg).forEach(([sid, v]) => { const s = svc(sid); out.push([`${v} kg · ${s.title}`, s.kg * v]); });
    return out;
  }
  function quote(showCoupon) {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const ls = lines();
      $('#sumLines').innerHTML = ls.length ? ls.map(([n, v]) => `<div class="sum-line"><span>${n}</span><span>${fmt(v)}</span></div>`).join('')
        : state.services.size ? `<div class="sum-line"><span>${[...state.services].map((id) => svc(id).title).join(', ')}</span><span>at pickup</span></div><div class="sum-empty">Final bill confirmed after counting at pickup.</div>` : '<div class="sum-empty">Pick a service to begin.</div>';
      const r = await fetch('/api/quote', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': window.CSRF }, body: JSON.stringify({ cart: cart(), express: form.delivery_type.value === 'express', coupon: $('#couponField').value, pincode: form.pincode.value }) }).then((x) => x.json()).catch(() => null);
      if (!r) return;
      lastQuote = r;
      $('#tSub').textContent = fmt(r.subtotal);
      $('#rowDisc').hidden = !r.discount; $('#tDisc').textContent = '−' + fmt(r.discount);
      $('#tDel').textContent = r.delivery_fee ? fmt(r.delivery_fee) : 'FREE';
      $('#rowExp').hidden = !r.express_fee; $('#tExp').textContent = fmt(r.express_fee);
      $('#tTax').textContent = fmt(r.tax);
      $('#tTot').textContent = fmt(r.total); $('#mTot').textContent = fmt(r.total);
      const msg = $('#couponMsg');
      if (r.coupon) { msg.className = 'coupon-msg ' + (r.coupon.ok ? 'ok' : 'no'); msg.textContent = r.coupon.message || ''; if (!r.coupon.ok && !showCoupon) msg.textContent += ' (will apply once eligible)'; }
      else msg.textContent = '';
    }, 180);
  }

  form.addEventListener('submit', (e) => {
    for (let i = 0; i < 4; i++) { const err = validate(i); if (err) { e.preventDefault(); toast(err); go(i); return; } }
    $('#cartField').value = JSON.stringify(cart());
    form.querySelector('[type=submit]').disabled = true;
  });

  paintServices(); buildItems(); quote();
  if (D.preselect && state.services.size) go(1);
})();
