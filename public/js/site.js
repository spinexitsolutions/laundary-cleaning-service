(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  // header border on scroll
  const header = $('.site-header');
  const onScroll = () => header && header.classList.toggle('scrolled', scrollY > 10);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  // mobile drawer
  const drawer = $('#drawer');
  $$('[data-drawer-open]').forEach((b) => b.addEventListener('click', () => { drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden'; }));
  $$('[data-drawer-close], #drawer nav a').forEach((b) => b.addEventListener('click', () => { drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true'); document.body.style.overflow = ''; }));

  // reveal on scroll
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' }) : null;
  $$('.rv').forEach((el) => (io ? io.observe(el) : el.classList.add('in')));

  // count-up numbers
  const counter = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (!e.isIntersecting) return;
    const el = e.target; counter.unobserve(el);
    const target = parseFloat(el.dataset.count); if (isNaN(target)) return;
    const dec = (el.dataset.count.split('.')[1] || '').length; const t0 = performance.now(); const dur = 1600;
    const tick = (t) => { const p = Math.min(1, (t - t0) / dur); const v = target * (1 - Math.pow(1 - p, 3)); el.textContent = v.toFixed(dec); if (p < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }), { threshold: .4 });
  $$('[data-count]').forEach((el) => counter.observe(el));

  // receipt tabs
  $$('[data-receipt]').forEach((r) => {
    $$('[data-rtab]', r).forEach((t) => t.addEventListener('click', () => {
      $$('[data-rtab]', r).forEach((x) => x.classList.toggle('on', x === t));
      $$('[data-rgroup]', r).forEach((g) => (g.hidden = g.dataset.rgroup !== t.dataset.rtab));
    }));
  });

  // testimonial scroller
  const quotes = $('[data-quotes]');
  $$('[data-scroll]').forEach((b) => b.addEventListener('click', () => quotes && quotes.scrollBy({ left: Number(b.dataset.scroll) * 440, behavior: 'smooth' })));

  // pincode checker
  $$('[data-pincheck]').forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = f.parentNode.querySelector('[data-pinresult]');
    const pin = f.pin.value.trim();
    const r = await fetch('/api/pincode?pin=' + encodeURIComponent(pin)).then((x) => x.json()).catch(() => null);
    if (!r) return;
    out.className = 'pin-result ' + (r.area ? 'ok' : 'no');
    out.textContent = r.area ? `Yes! We pick up in ${r.area}${r.fee ? ' · delivery ' + (window.CUR || '₹') + r.fee : ' · free delivery'}.` : `Not yet in ${pin} — WhatsApp us and we'll try to make it work.`;
  }));

  // pricing page tabs
  $$('[data-ptab]').forEach((t) => t.addEventListener('click', () => {
    $$('[data-ptab]').forEach((x) => x.classList.toggle('on', x === t));
    const id = t.dataset.ptab;
    $$('[data-pcat]').forEach((row) => (row.hidden = id !== 'all' && row.dataset.pcat !== id));
  }));

  // auto-dismiss toasts
  setTimeout(() => $$('.toast:not(.error)').forEach((t) => t.remove()), 6000);
})();
