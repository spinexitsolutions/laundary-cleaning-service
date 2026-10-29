(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  // clickable rows
  document.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-href]');
    if (tr && !e.target.closest('a,button,input,select,form')) location.href = tr.dataset.href;
  });

  // list toggles
  $$('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
    b.classList.toggle('on');
    const r = await fetch(b.dataset.toggle, { method: 'POST', headers: { 'x-csrf-token': window.CSRF, 'x-requested-with': 'fetch' } }).catch(() => null);
    if (!r || !r.ok) b.classList.toggle('on');
  }));

  // copy buttons
  $$('[data-copy]').forEach((b) => b.addEventListener('click', () => {
    navigator.clipboard?.writeText(location.origin + b.dataset.copy);
    b.style.color = '#157347'; setTimeout(() => (b.style.color = ''), 1200);
  }));

  // image preview
  $$('[data-imgfile]').forEach((inp) => inp.addEventListener('change', () => {
    const f = inp.files[0]; if (!f) return;
    $('.prev', inp.closest('.img-in')).innerHTML = `<img src="${URL.createObjectURL(f)}" alt="">`;
  }));

  // media picker
  let mediaCache = null;
  $$('[data-pick-media]').forEach((b) => b.addEventListener('click', async () => {
    mediaCache = mediaCache || await fetch('/admin/media.json').then((r) => r.json());
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:100;display:grid;place-items:center;padding:20px';
    box.innerHTML = `<div class="card" style="width:min(820px,100%);max-height:80vh;display:flex;flex-direction:column"><div class="card-h"><h2>Media library</h2><div class="sp"></div><button type="button" class="b sm" data-x>Close</button></div>
      <div class="card-b" style="overflow:auto">${mediaCache.length ? `<div class="media-grid">${mediaCache.map((m) => `<button type="button" class="media-item" data-url="${m.url}" style="padding:0;cursor:pointer"><img src="${m.url}" alt=""></button>`).join('')}</div>` : '<p class="muted">No uploads yet — use the file picker or the Media Library page.</p>'}</div></div>`;
    document.body.appendChild(box);
    box.addEventListener('click', (e) => {
      const it = e.target.closest('[data-url]');
      if (it) {
        const wrap = b.closest('.img-in');
        $('input.in', wrap).value = it.dataset.url;
        $('.prev', wrap).innerHTML = `<img src="${it.dataset.url}" alt="">`;
      }
      if (it || e.target === box || e.target.closest('[data-x]')) box.remove();
    });
  }));

  // repeaters
  $$('[data-repeater]').forEach((rep) => {
    rep.addEventListener('click', (e) => {
      if (e.target.closest('[data-rep-add]')) $('[data-rows]', rep).appendChild($('template', rep).content.cloneNode(true));
      const rm = e.target.closest('[data-rep-rm]');
      if (rm) rm.closest('.rep-row').remove();
    });
  });

  // rich text editor
  $$('[data-rte]').forEach((rte) => {
    const ed = $('.rte-ed', rte); const ta = $('textarea', rte);
    ed.innerHTML = ta.value;
    const sync = () => { if (!rte.classList.contains('src')) ta.value = ed.innerHTML; };
    ed.addEventListener('input', sync);
    rte.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      ed.focus();
      if (b.dataset.cmd) document.execCommand(b.dataset.cmd, false, null);
      if (b.dataset.block) document.execCommand('formatBlock', false, b.dataset.block);
      if (b.dataset.link !== undefined) { const u = prompt('Link URL'); if (u) document.execCommand('createLink', false, u); }
      if (b.dataset.img !== undefined) { const u = prompt('Image URL (upload in Media Library and copy its URL)'); if (u) document.execCommand('insertImage', false, u); }
      if (b.dataset.src !== undefined) {
        if (rte.classList.toggle('src')) ta.value = ed.innerHTML; else ed.innerHTML = ta.value;
      }
      sync();
    });
    rte.closest('form')?.addEventListener('submit', () => { if (!rte.classList.contains('src')) ta.value = ed.innerHTML; });
  });

  // order line-item editor
  const lines = $('#lines');
  if (lines) {
    const tpl = $('#lineTpl');
    const priced = window.PRICED || [];
    const money = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
    const recalc = () => {
      let sub = 0;
      $$('tr', lines).forEach((tr) => {
        const amt = (parseFloat($('[data-qty]', tr).value) || 0) * (parseFloat($('[data-price]', tr).value) || 0);
        sub += amt; $('[data-amt]', tr).textContent = money(amt);
      });
      $('#subPrev').textContent = money(sub);
    };
    const add = (l = {}) => {
      const tr = tpl.content.firstElementChild.cloneNode(true);
      const svc = $('[data-svc]', tr); const name = $('[data-name]', tr);
      svc.value = l.service_id || ''; name.value = l.item_name || '';
      $('[data-item]', tr).value = l.item_id || '';
      $('[data-qty]', tr).value = l.qty ?? 1; $('[data-unit]', tr).value = l.unit || 'pc'; $('[data-price]', tr).value = l.unit_price ?? 0;
      const setList = () => name.setAttribute('list', svc.value ? 'dl-' + svc.value : '');
      setList();
      svc.addEventListener('change', () => {
        setList();
        const opt = svc.selectedOptions[0];
        if (opt && opt.dataset.mode === 'per_kg') { name.value = opt.textContent + ' (by weight)'; $('[data-unit]', tr).value = 'kg'; $('[data-price]', tr).value = opt.dataset.kg; $('[data-item]', tr).value = ''; recalc(); }
      });
      name.addEventListener('change', () => {
        const hit = priced.find((p) => String(p.service_id) === svc.value && p.name === name.value);
        if (hit) { $('[data-price]', tr).value = hit.price; $('[data-unit]', tr).value = hit.unit; $('[data-item]', tr).value = hit.item_id; }
        else $('[data-item]', tr).value = '';
        recalc();
      });
      $('[data-rm]', tr).addEventListener('click', () => { tr.remove(); recalc(); });
      tr.addEventListener('input', recalc);
      lines.appendChild(tr);
    };
    (window.ORDER_LINES || []).forEach(add);
    if (!lines.children.length) add();
    $('#addLine').addEventListener('click', () => add());
    recalc();
  }
})();
