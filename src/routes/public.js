const express = require('express');
const { get, all, run, tx } = require('../db');
const { getSettings } = require('../settings');
const H = require('../helpers');

const router = express.Router();

/* ---------------- shared data for header/footer ---------------- */
router.use((req, res, next) => {
  const menus = all('SELECT * FROM menu_items WHERE is_active = 1 ORDER BY sort_order, id');
  res.locals.menu = (loc) => menus.filter((m) => m.location === loc);
  res.locals.navServices = all('SELECT title, slug FROM services WHERE is_active = 1 ORDER BY sort_order, id');
  next();
});

const meta = (title, desc) => ({ title: `${title} — ${getSettings().site_name}`, desc: desc || getSettings().meta_desc });

function priceBook() {
  const services = all('SELECT * FROM services WHERE is_active = 1 ORDER BY sort_order, id');
  const cats = all('SELECT * FROM item_categories WHERE is_active = 1 ORDER BY sort_order, id');
  const items = all('SELECT * FROM items WHERE is_active = 1 ORDER BY sort_order, id');
  const prices = all('SELECT * FROM item_prices');
  const pmap = {};
  for (const p of prices) (pmap[p.item_id] ||= {})[p.service_id] = p.price;
  return { services, cats, items, pmap };
}

/* ---------------- Home ---------------- */
router.get('/', (req, res) => {
  const s = getSettings();
  const pb = priceBook();
  res.render('public/home', {
    services: pb.services.filter((x) => x.is_featured),
    pb,
    testimonials: all('SELECT * FROM testimonials WHERE is_active = 1 ORDER BY sort_order, id'),
    faqs: all('SELECT * FROM faqs WHERE is_active = 1 AND show_on_home = 1 ORDER BY sort_order, id LIMIT 6'),
    posts: all('SELECT * FROM posts WHERE is_published = 1 ORDER BY published_at DESC, id DESC LIMIT 3'),
    areas: all('SELECT * FROM service_areas WHERE is_active = 1 ORDER BY sort_order, id'),
    meta: { title: s.meta_title, desc: s.meta_desc },
  });
});

/* ---------------- Services ---------------- */
router.get('/services', (req, res) => {
  res.render('public/services', { services: all('SELECT * FROM services WHERE is_active = 1 ORDER BY sort_order, id'), meta: meta('Services') });
});

router.get('/services/:slug', (req, res, next) => {
  const service = get('SELECT * FROM services WHERE slug = ? AND is_active = 1', req.params.slug);
  if (!service) return next();
  const items = all(`SELECT i.name, i.unit, p.price, c.name AS cat FROM item_prices p JOIN items i ON i.id = p.item_id
    LEFT JOIN item_categories c ON c.id = i.category_id WHERE p.service_id = ? AND i.is_active = 1 ORDER BY c.sort_order, i.sort_order`, service.id);
  const others = all('SELECT * FROM services WHERE is_active = 1 AND id != ? ORDER BY sort_order LIMIT 3', service.id);
  res.render('public/service', { service, items, others, faqs: all('SELECT * FROM faqs WHERE is_active = 1 ORDER BY sort_order LIMIT 4'), meta: meta(service.meta_title || service.title, service.meta_desc || service.short_desc) });
});

/* ---------------- Pricing ---------------- */
router.get('/pricing', (req, res) => {
  res.render('public/pricing', { pb: priceBook(), meta: meta('Pricing', 'Transparent per-item and per-kg prices for laundry, dry cleaning, ironing and shoe care.') });
});

/* ---------------- Booking ---------------- */
router.get('/book', (req, res) => {
  const s = getSettings();
  const pb = priceBook();
  const days = [];
  const n = Math.max(1, parseInt(s.booking_days_ahead, 10) || 7);
  for (let i = 0; i < n; i++) days.push(H.addDays(H.today(), i));
  let prefill = {};
  if (res.locals.customer) {
    const c = get('SELECT * FROM customers WHERE id = ?', res.locals.customer.id);
    prefill = { name: c.name, phone: c.phone, email: c.email, address: c.address, pincode: c.pincode };
  }
  res.render('public/book', {
    pb, days,
    slots: all('SELECT * FROM time_slots WHERE is_active = 1 ORDER BY sort_order, id'),
    methods: H.paymentMethods(),
    addresses: res.locals.customer ? all('SELECT * FROM customer_addresses WHERE customer_id = ?', res.locals.customer.id) : [],
    prefill,
    preselect: req.query.service || '',
    meta: meta('Book a pickup'),
  });
});

function parseCart(raw) {
  try {
    const c = JSON.parse(raw || '{}');
    return { items: Array.isArray(c.items) ? c.items : [], kg: c.kg && typeof c.kg === 'object' ? c.kg : {}, services: Array.isArray(c.services) ? c.services.map(Number) : [] };
  } catch { return { items: [], kg: {}, services: [] }; }
}

router.post('/api/quote', (req, res) => {
  const cart = parseCart(JSON.stringify(req.body.cart || {}));
  const q = H.priceCart({ ...cart, express: !!req.body.express, coupon: req.body.coupon, pincode: req.body.pincode });
  res.json({
    subtotal: q.subtotal, discount: q.discount, delivery_fee: q.delivery_fee, express_fee: q.express_fee, tax: q.tax, total: q.total,
    coupon: req.body.coupon ? { ok: q.coupon.ok, message: q.coupon.ok ? q.coupon.message : q.coupon.error } : null,
    area: q.area ? q.area.name : null,
  });
});

router.get('/api/pincode', (req, res) => {
  const area = H.findArea(req.query.pin);
  const s = getSettings();
  res.json({ ok: !!area || s.restrict_pincodes !== '1', area: area ? area.name : null, fee: area ? area.delivery_fee : Number(s.delivery_fee) });
});

router.post('/book', (req, res) => {
  const s = getSettings();
  const b = req.body;
  const back = (msg) => { H.flash(req, 'error', msg); res.redirect('/book'); };
  if (s.booking_enabled !== '1') return back('Online booking is paused right now. Please call or WhatsApp us.');

  const name = String(b.name || '').trim();
  const phone = String(b.phone || '').replace(/[^\d+]/g, '');
  const address = String(b.address || '').trim();
  const pincode = String(b.pincode || '').trim();
  if (!name || phone.replace(/\D/g, '').length < 10 || !address || !pincode) return back('Please fill in your name, a valid phone number, address and pincode.');

  const area = H.findArea(pincode);
  if (!area && s.restrict_pincodes === '1') return back(`Sorry, we don’t serve pincode ${pincode} yet.`);

  const maxDay = H.addDays(H.today(), Math.max(1, parseInt(s.booking_days_ahead, 10) || 7));
  const pickupDate = String(b.pickup_date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pickupDate) || pickupDate < H.today() || pickupDate > maxDay) return back('Please choose a valid pickup date.');
  const slot = get('SELECT * FROM time_slots WHERE id = ? AND is_active = 1', b.pickup_slot);
  if (!slot) return back('Please choose a pickup time slot.');
  if (slot.capacity) {
    const used = get("SELECT COUNT(*) n FROM orders WHERE pickup_date = ? AND pickup_slot = ? AND status != 'cancelled'", pickupDate, slot.label).n;
    if (used >= slot.capacity) return back('That pickup slot just filled up — please pick another.');
  }

  const cart = parseCart(b.cart);
  const express = b.delivery_type === 'express';
  const q = H.priceCart({ ...cart, express, coupon: b.coupon, pincode });
  const svcIds = new Set([...cart.services, ...q.lines.map((l) => l.service_id)]);
  const svcTitles = svcIds.size ? all(`SELECT title FROM services WHERE id IN (${[...svcIds].map(() => '?').join(',')})`, ...svcIds).map((r) => r.title) : [];
  if (!svcTitles.length) return back('Please choose at least one service.');
  if (q.lines.length && q.subtotal < Number(s.min_order || 0)) return back(`Minimum order value is ${H.money(s.min_order)}. Add a few more items, or choose “count at pickup”.`);

  const method = H.paymentMethods().find((m) => m.code === b.payment_method) ? b.payment_method : (H.paymentMethods()[0]?.code || 'cod');
  const deliveryDate = H.addDays(pickupDate, express ? 1 : Math.max(1, parseInt(s.standard_days, 10) || 2));

  const orderNo = tx(() => {
    let customerId = res.locals.customer?.id;
    if (!customerId) {
      const ex = get('SELECT id FROM customers WHERE phone = ?', phone);
      customerId = ex ? ex.id : Number(run('INSERT INTO customers (name, phone, email, address, pincode) VALUES (?, ?, ?, ?, ?)', name, phone, b.email || null, address, pincode).lastInsertRowid);
    }
    const no = H.nextOrderNo();
    const r = run(`INSERT INTO orders (order_no, customer_id, name, phone, email, address, pincode, area_id, pickup_date, pickup_slot, delivery_date, delivery_type, services, count_at_pickup, notes,
      subtotal, discount, coupon_code, express_fee, delivery_fee, tax, total, payment_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    no, customerId, name, phone, b.email || null, address + (b.landmark ? `\nLandmark: ${b.landmark}` : ''), pincode, area?.id || null, pickupDate, slot.label, deliveryDate,
    express ? 'express' : 'standard', svcTitles.join(', '), q.lines.length ? 0 : 1, b.notes || null,
    q.subtotal, q.discount, q.coupon.ok ? q.coupon.coupon.code : null, q.express_fee, q.delivery_fee, q.tax, q.total, method);
    const oid = Number(r.lastInsertRowid);
    for (const l of q.lines) {
      run('INSERT INTO order_items (order_id, service_id, service_title, item_id, item_name, unit, qty, unit_price, line_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        oid, l.service_id, l.service_title, l.item_id, l.item_name, l.unit, l.qty, l.unit_price, l.line_total);
    }
    run('INSERT INTO order_history (order_id, status, note) VALUES (?, ?, ?)', oid, 'pending', 'Order placed on website');
    if (q.coupon.ok) run('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?', q.coupon.coupon.id);
    if (b.save_address === '1' && res.locals.customer) {
      run('INSERT INTO customer_addresses (customer_id, label, address, pincode, landmark) VALUES (?, ?, ?, ?, ?)', customerId, b.address_label || 'Home', address, pincode, b.landmark || null);
    }
    return no;
  });

  req.session.myOrders = [...(req.session.myOrders || []), orderNo].slice(-10);
  res.redirect(`/book/confirmed/${orderNo}`);
});

router.get('/book/confirmed/:no', (req, res, next) => {
  if (!(req.session.myOrders || []).includes(req.params.no)) return res.redirect('/track');
  const order = get('SELECT * FROM orders WHERE order_no = ?', req.params.no);
  if (!order) return next();
  res.render('public/confirmed', { order, items: all('SELECT * FROM order_items WHERE order_id = ?', order.id), meta: meta('Pickup booked') });
});

/* ---------------- Tracking ---------------- */
router.get('/track', (req, res) => {
  let order = null, error = null, history = [], items = [];
  const no = String(req.query.order || '').trim().toUpperCase();
  const phone = String(req.query.phone || '').replace(/\D/g, '');
  if (no) {
    const o = get('SELECT * FROM orders WHERE upper(order_no) = ?', no);
    if (o && phone.length >= 4 && o.phone.replace(/\D/g, '').endsWith(phone.slice(-10))) {
      order = o;
      history = all('SELECT * FROM order_history WHERE order_id = ? ORDER BY created_at, id', o.id);
      items = all('SELECT * FROM order_items WHERE order_id = ?', o.id);
    } else error = 'We couldn’t find an order with that number and phone. Please double-check both.';
  }
  res.render('public/track', { order, history, items, error, q: { order: no, phone: req.query.phone || '' }, meta: meta('Track your order') });
});

/* ---------------- Content pages ---------------- */
router.get('/about', (req, res) => {
  res.render('public/about', { team: all('SELECT * FROM team_members WHERE is_active = 1 ORDER BY sort_order, id'), meta: meta('About us') });
});

router.get('/faq', (req, res) => {
  const faqs = all('SELECT * FROM faqs WHERE is_active = 1 ORDER BY category, sort_order, id');
  const groups = {};
  for (const f of faqs) (groups[f.category || 'General'] ||= []).push(f);
  res.render('public/faq', { groups, meta: meta('FAQs') });
});

router.get('/areas', (req, res) => {
  res.render('public/areas', { areas: all('SELECT * FROM service_areas WHERE is_active = 1 ORDER BY sort_order, id'), meta: meta('Service areas') });
});

router.get('/gallery', (req, res) => {
  res.render('public/gallery', { images: all('SELECT * FROM gallery WHERE is_active = 1 ORDER BY sort_order, id'), meta: meta('Gallery') });
});

router.get('/contact', (req, res) => res.render('public/contact', { meta: meta('Contact us'), sent: req.query.sent }));

router.post('/contact', (req, res) => {
  const { name, email, phone, subject, message, website } = req.body;
  if (website) return res.redirect('/contact?sent=1'); // honeypot
  if (!name || !message || (!email && !phone)) {
    H.flash(req, 'error', 'Please add your name, a way to reach you and a message.');
    return res.redirect('/contact');
  }
  run('INSERT INTO messages (name, email, phone, subject, message) VALUES (?, ?, ?, ?, ?)', name, email || null, phone || null, subject || null, message);
  res.redirect('/contact?sent=1');
});

router.post('/subscribe', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    run('INSERT OR IGNORE INTO subscribers (email) VALUES (?)', email);
    H.flash(req, 'success', 'You’re on the list — thanks for subscribing!');
  } else H.flash(req, 'error', 'Please enter a valid email address.');
  const ref = req.get('referer');
  res.redirect(ref && ref.startsWith(`${req.protocol}://${req.get('host')}`) ? ref : '/');
});

/* ---------------- Blog ---------------- */
router.get('/blog', (req, res) => {
  const cat = req.query.category;
  const posts = cat
    ? all('SELECT * FROM posts WHERE is_published = 1 AND category = ? ORDER BY published_at DESC, id DESC', cat)
    : all('SELECT * FROM posts WHERE is_published = 1 ORDER BY published_at DESC, id DESC');
  const cats = all("SELECT DISTINCT category FROM posts WHERE is_published = 1 AND category IS NOT NULL AND category != ''").map((r) => r.category);
  res.render('public/blog', { posts, cats, cat, meta: meta('The Journal') });
});

router.get('/blog/:slug', (req, res, next) => {
  const post = get('SELECT * FROM posts WHERE slug = ? AND is_published = 1', req.params.slug);
  if (!post) return next();
  const more = all('SELECT * FROM posts WHERE is_published = 1 AND id != ? ORDER BY published_at DESC LIMIT 2', post.id);
  res.render('public/post', { post, more, meta: meta(post.meta_title || post.title, post.meta_desc || post.excerpt) });
});

router.get('/sitemap.xml', (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  const urls = ['/', '/services', '/pricing', '/book', '/about', '/contact', '/faq', '/areas', '/blog', '/track',
    ...all('SELECT slug FROM services WHERE is_active = 1').map((r) => `/services/${r.slug}`),
    ...all('SELECT slug FROM posts WHERE is_published = 1').map((r) => `/blog/${r.slug}`),
    ...all('SELECT slug FROM pages WHERE is_published = 1').map((r) => `/${r.slug}`)];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${base}${u}</loc></url>`).join('')}</urlset>`);
});

router.get('/robots.txt', (req, res) => res.type('text/plain').send(`User-agent: *\nDisallow: /admin\nDisallow: /account\nSitemap: ${req.protocol}://${req.get('host')}/sitemap.xml\n`));

/* ---------------- CMS pages (catch-all) ---------------- */
router.get('/:slug', (req, res, next) => {
  const page = get('SELECT * FROM pages WHERE slug = ? AND is_published = 1', req.params.slug);
  if (!page) return next();
  res.render('public/page', { page, meta: meta(page.meta_title || page.title, page.meta_desc || page.subtitle) });
});

module.exports = router;
