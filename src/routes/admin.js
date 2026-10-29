const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { get, all, run, tx } = require('../db');
const { GROUPS, FIELD_INDEX, getSettings, saveSettings } = require('../settings');
const { RESOURCES } = require('../admin-resources');
const { ICON_NAMES } = require('../icons');
const H = require('../helpers');

const router = express.Router();
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}${path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '')}`),
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(png|jpe?g|webp|gif|x-icon|vnd\.microsoft\.icon|avif)$/.test(file.mimetype)),
});

function storeFile(f) {
  run('INSERT INTO media (filename, original_name, mime, size) VALUES (?, ?, ?, ?)', f.filename, f.originalname, f.mimetype, f.size);
  return `/uploads/${f.filename}`;
}

/* ---------------- auth ---------------- */
const attempts = new Map();

router.get('/login', (req, res) => {
  if (res.locals.admin) return res.redirect('/admin');
  res.render('admin/login', { layout: false });
});

router.post('/login', (req, res) => {
  const key = req.ip;
  const a = attempts.get(key) || { n: 0, t: Date.now() };
  if (Date.now() - a.t > 15 * 60 * 1000) { a.n = 0; a.t = Date.now(); }
  if (a.n >= 10) { H.flash(req, 'error', 'Too many attempts. Please wait 15 minutes.'); return res.redirect('/admin/login'); }
  const u = get('SELECT * FROM admins WHERE lower(email) = lower(?) AND is_active = 1', String(req.body.email || '').trim());
  if (!u || !bcrypt.compareSync(String(req.body.password || ''), u.password_hash)) {
    a.n++; attempts.set(key, a);
    H.flash(req, 'error', 'Invalid email or password.');
    return res.redirect('/admin/login');
  }
  attempts.delete(key);
  run("UPDATE admins SET last_login_at = datetime('now') WHERE id = ?", u.id);
  const customerId = req.session.customerId;
  req.session.regenerate(() => {
    req.session.adminId = u.id;
    if (customerId) req.session.customerId = customerId;
    res.redirect('/admin');
  });
});

router.post('/logout', (req, res) => {
  delete req.session.adminId;
  res.redirect('/admin/login');
});

router.use((req, res, next) => {
  if (!res.locals.admin) return res.redirect('/admin/login');
  res.locals.unread = get('SELECT COUNT(*) n FROM messages WHERE is_read = 0').n;
  res.locals.pendingCount = get("SELECT COUNT(*) n FROM orders WHERE status = 'pending'").n;
  res.locals.RESOURCES = RESOURCES;
  res.locals.can = (roles) => !roles || roles.includes(res.locals.admin.role);
  next();
});

const role = (...roles) => (req, res, next) => (roles.includes(res.locals.admin.role) ? next() : res.status(403).render('admin/denied'));
const MANAGE = role('admin', 'manager');

/* ---------------- dashboard ---------------- */
router.get('/', (req, res) => {
  const t = H.today();
  const stats = {
    today: get("SELECT COUNT(*) n FROM orders WHERE date(created_at, 'localtime') = ?", t).n,
    active: get("SELECT COUNT(*) n FROM orders WHERE status NOT IN ('delivered','cancelled')").n,
    revenueMonth: get("SELECT COALESCE(SUM(total),0) v FROM orders WHERE status != 'cancelled' AND strftime('%Y-%m', created_at) = strftime('%Y-%m','now')").v,
    revenueAll: get("SELECT COALESCE(SUM(total),0) v FROM orders WHERE status != 'cancelled'").v,
    customers: get('SELECT COUNT(*) n FROM customers').n,
    newCustomers: get("SELECT COUNT(*) n FROM customers WHERE created_at >= datetime('now','-30 days')").n,
    aov: get("SELECT COALESCE(AVG(total),0) v FROM orders WHERE status != 'cancelled'").v,
    unpaid: get("SELECT COALESCE(SUM(total),0) v FROM orders WHERE payment_status = 'unpaid' AND status = 'delivered'").v,
  };
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = H.addDays(t, -i);
    const r = get("SELECT COUNT(*) n, COALESCE(SUM(total),0) v FROM orders WHERE status != 'cancelled' AND date(created_at) = ?", d);
    days.push({ d, n: r.n, v: r.v });
  }
  const byStatus = all('SELECT status, COUNT(*) n FROM orders GROUP BY status');
  const topServices = all("SELECT service_title AS t, SUM(line_total) v, COUNT(DISTINCT order_id) n FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.status != 'cancelled' GROUP BY service_title ORDER BY v DESC LIMIT 5");
  res.render('admin/dashboard', {
    stats, days, byStatus, topServices,
    recent: all('SELECT * FROM orders ORDER BY created_at DESC LIMIT 8'),
    pickups: all("SELECT * FROM orders WHERE pickup_date = ? AND status IN ('pending','confirmed') ORDER BY pickup_slot", t),
    deliveries: all("SELECT * FROM orders WHERE delivery_date = ? AND status IN ('ready','out_for_delivery','processing') ORDER BY id", t),
    messages: all('SELECT * FROM messages WHERE is_read = 0 ORDER BY created_at DESC LIMIT 4'),
    title: 'Dashboard',
  });
});

/* ---------------- orders ---------------- */
function orderFilters(q) {
  const where = [];
  const p = [];
  if (q.status) { where.push('status = ?'); p.push(q.status); }
  if (q.payment) { where.push('payment_status = ?'); p.push(q.payment); }
  if (q.from) { where.push('date(created_at) >= ?'); p.push(q.from); }
  if (q.to) { where.push('date(created_at) <= ?'); p.push(q.to); }
  if (q.pickup) { where.push('pickup_date = ?'); p.push(q.pickup); }
  if (q.q) { where.push('(order_no LIKE ? OR name LIKE ? OR phone LIKE ? OR email LIKE ?)'); p.push(...Array(4).fill(`%${q.q}%`)); }
  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', p };
}

router.get('/orders', (req, res) => {
  const f = orderFilters(req.query);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const per = 20;
  const total = get(`SELECT COUNT(*) n FROM orders ${f.sql}`, ...f.p).n;
  const orders = all(`SELECT o.*, a.name AS staff FROM orders o LEFT JOIN admins a ON a.id = o.assigned_to ${f.sql.replace(/(status|payment_status|created_at|pickup_date|order_no|name|phone|email)/g, 'o.$1')} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`, ...f.p, per, (page - 1) * per);
  const counts = Object.fromEntries(all('SELECT status, COUNT(*) n FROM orders GROUP BY status').map((r) => [r.status, r.n]));
  res.render('admin/orders', { orders, total, page, pages: Math.ceil(total / per), q: req.query, counts, title: 'Orders' });
});

router.get('/orders.csv', (req, res) => {
  const f = orderFilters(req.query);
  const rows = all(`SELECT * FROM orders ${f.sql} ORDER BY created_at DESC`, ...f.p);
  const cols = ['order_no', 'created_at', 'name', 'phone', 'email', 'address', 'pincode', 'services', 'pickup_date', 'pickup_slot', 'delivery_date', 'delivery_type', 'subtotal', 'discount', 'coupon_code', 'delivery_fee', 'express_fee', 'tax', 'total', 'status', 'payment_method', 'payment_status'];
  csv(res, 'orders.csv', cols, rows);
});

function csv(res, name, cols, rows) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"` });
  res.send('﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => q(r[c])).join(','))].join('\n'));
}

function orderFormData() {
  const services = all('SELECT * FROM services WHERE is_active = 1 ORDER BY sort_order');
  const priced = all(`SELECT p.item_id, p.service_id, p.price, i.name, i.unit, c.name AS cat FROM item_prices p JOIN items i ON i.id = p.item_id
    LEFT JOIN item_categories c ON c.id = i.category_id WHERE i.is_active = 1 ORDER BY c.sort_order, i.sort_order`);
  return {
    services, priced,
    slots: all('SELECT * FROM time_slots WHERE is_active = 1 ORDER BY sort_order'),
    staff: all('SELECT id, name, role FROM admins WHERE is_active = 1 ORDER BY name'),
    methods: H.paymentMethods(),
  };
}

router.get('/orders/new', (req, res) => {
  let prefill = {};
  if (req.query.customer) prefill = get('SELECT name, phone, email, address, pincode FROM customers WHERE id = ?', req.query.customer) || {};
  res.render('admin/order-form', { order: { ...prefill, status: 'confirmed', payment_status: 'unpaid', delivery_type: 'standard', pickup_date: H.today() }, items: [], ...orderFormData(), title: 'New order' });
});

function readLines(body) {
  const lines = [];
  const names = [].concat(body.li_name || []);
  for (let i = 0; i < names.length; i++) {
    const name = String(names[i] || '').trim();
    if (!name) continue;
    const qty = parseFloat([].concat(body.li_qty)[i]) || 0;
    const price = parseFloat([].concat(body.li_price)[i]) || 0;
    const sidv = parseInt([].concat(body.li_service)[i], 10) || null;
    const sv = sidv ? get('SELECT title FROM services WHERE id = ?', sidv) : null;
    lines.push({ service_id: sidv, service_title: sv ? sv.title : [].concat(body.li_service_title || [])[i] || null, item_id: parseInt([].concat(body.li_item)[i], 10) || null, item_name: name, unit: [].concat(body.li_unit)[i] || 'pc', qty, unit_price: price, line_total: Math.round(qty * price * 100) / 100 });
  }
  return lines;
}

function saveOrderFromForm(req, existing) {
  const b = req.body;
  const lines = readLines(b);
  const totals = H.computeTotals(lines, {
    express: b.delivery_type === 'express', coupon: b.coupon_code, pincode: b.pincode,
    deliveryOverride: b.delivery_fee === '' || b.delivery_fee == null ? null : b.delivery_fee,
  });
  let discount = totals.discount;
  if (b.manual_discount !== undefined && b.manual_discount !== '') discount = Math.max(0, parseFloat(b.manual_discount) || 0);
  const s = getSettings();
  const taxable = Math.max(0, totals.subtotal - discount) + totals.delivery_fee + totals.express_fee;
  const tax = Math.round(taxable * Number(s.tax_percent || 0)) / 100;
  const total = Math.round((taxable + tax) * 100) / 100;
  const services = [...new Set(lines.map((l) => l.service_title).filter(Boolean))].join(', ') || b.services || null;
  const area = H.findArea(b.pincode);

  return tx(() => {
    let customerId = existing?.customer_id || null;
    const phone = String(b.phone || '').replace(/[^\d+]/g, '');
    if (!customerId && phone) {
      const ex = get('SELECT id FROM customers WHERE phone = ?', phone);
      customerId = ex ? ex.id : Number(run('INSERT INTO customers (name, phone, email, address, pincode) VALUES (?, ?, ?, ?, ?)', b.name, phone, b.email || null, b.address || null, b.pincode || null).lastInsertRowid);
    }
    const vals = [b.name, phone, b.email || null, b.address || null, b.pincode || null, area?.id || null, b.pickup_date || null, b.pickup_slot || null, b.delivery_date || null, b.delivery_type || 'standard', services,
      lines.length ? 0 : 1, b.notes || null, totals.subtotal, discount, b.coupon_code || null, totals.express_fee, totals.delivery_fee, tax, total, b.payment_method || 'cod', b.payment_status || 'unpaid', b.assigned_to || null, b.admin_notes || null];
    let id;
    if (existing) {
      id = existing.id;
      run(`UPDATE orders SET name=?, phone=?, email=?, address=?, pincode=?, area_id=?, pickup_date=?, pickup_slot=?, delivery_date=?, delivery_type=?, services=?, count_at_pickup=?, notes=?,
        subtotal=?, discount=?, coupon_code=?, express_fee=?, delivery_fee=?, tax=?, total=?, payment_method=?, payment_status=?, assigned_to=?, admin_notes=?, updated_at=datetime('now') WHERE id = ?`, ...vals, id);
      run('DELETE FROM order_items WHERE order_id = ?', id);
    } else {
      id = Number(run(`INSERT INTO orders (name, phone, email, address, pincode, area_id, pickup_date, pickup_slot, delivery_date, delivery_type, services, count_at_pickup, notes,
        subtotal, discount, coupon_code, express_fee, delivery_fee, tax, total, payment_method, payment_status, assigned_to, admin_notes, order_no, customer_id, status, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin')`, ...vals, H.nextOrderNo(), customerId, b.status || 'confirmed').lastInsertRowid);
      run('INSERT INTO order_history (order_id, status, note, by_admin) VALUES (?, ?, ?, ?)', id, b.status || 'confirmed', 'Order created by staff', req.session.adminId);
    }
    for (const l of lines) {
      run('INSERT INTO order_items (order_id, service_id, service_title, item_id, item_name, unit, qty, unit_price, line_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', id, l.service_id, l.service_title, l.item_id, l.item_name, l.unit, l.qty, l.unit_price, l.line_total);
    }
    return id;
  });
}

router.post('/orders', (req, res) => {
  if (!req.body.name || !req.body.phone) { H.flash(req, 'error', 'Customer name and phone are required.'); return res.redirect('/admin/orders/new'); }
  const id = saveOrderFromForm(req, null);
  H.flash(req, 'success', 'Order created.');
  res.redirect(`/admin/orders/${id}`);
});

router.get('/orders/:id', (req, res, next) => {
  const order = get('SELECT o.*, a.name AS staff FROM orders o LEFT JOIN admins a ON a.id = o.assigned_to WHERE o.id = ?', req.params.id);
  if (!order) return next();
  res.render('admin/order', {
    order,
    items: all('SELECT * FROM order_items WHERE order_id = ?', order.id),
    history: all('SELECT h.*, a.name AS admin_name FROM order_history h LEFT JOIN admins a ON a.id = h.by_admin WHERE order_id = ? ORDER BY h.created_at, h.id', order.id),
    customerOrders: order.customer_id ? get('SELECT COUNT(*) n FROM orders WHERE customer_id = ?', order.customer_id).n : 0,
    staff: all('SELECT id, name FROM admins WHERE is_active = 1 ORDER BY name'),
    title: `Order ${order.order_no}`,
  });
});

router.get('/orders/:id/edit', (req, res, next) => {
  const order = get('SELECT * FROM orders WHERE id = ?', req.params.id);
  if (!order) return next();
  res.render('admin/order-form', { order, items: all('SELECT * FROM order_items WHERE order_id = ?', order.id), ...orderFormData(), title: `Edit ${order.order_no}` });
});

router.post('/orders/:id/edit', (req, res, next) => {
  const order = get('SELECT * FROM orders WHERE id = ?', req.params.id);
  if (!order) return next();
  saveOrderFromForm(req, order);
  H.flash(req, 'success', 'Order updated and totals recalculated.');
  res.redirect(`/admin/orders/${order.id}`);
});

router.post('/orders/:id/status', (req, res) => {
  const order = get('SELECT * FROM orders WHERE id = ?', req.params.id);
  if (!order || !H.STATUS_MAP[req.body.status]) return res.redirect('/admin/orders');
  run("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?", req.body.status, order.id);
  if (req.body.status === 'delivered' && req.body.mark_paid === '1') run("UPDATE orders SET payment_status = 'paid' WHERE id = ?", order.id);
  run('INSERT INTO order_history (order_id, status, note, by_admin) VALUES (?, ?, ?, ?)', order.id, req.body.status, req.body.note || null, req.session.adminId);
  H.flash(req, 'success', `Status changed to “${H.STATUS_MAP[req.body.status].label}”.`);
  res.redirect(req.body.back || `/admin/orders/${order.id}`);
});

router.post('/orders/:id/meta', (req, res) => {
  const b = req.body;
  if (b.payment_status && H.PAYMENT_STATUSES.includes(b.payment_status)) run('UPDATE orders SET payment_status = ? WHERE id = ?', b.payment_status, req.params.id);
  if (b.assigned_to !== undefined) run('UPDATE orders SET assigned_to = ? WHERE id = ?', b.assigned_to || null, req.params.id);
  if (b.admin_notes !== undefined) run('UPDATE orders SET admin_notes = ? WHERE id = ?', b.admin_notes, req.params.id);
  run("UPDATE orders SET updated_at = datetime('now') WHERE id = ?", req.params.id);
  H.flash(req, 'success', 'Order updated.');
  res.redirect(`/admin/orders/${req.params.id}`);
});

router.post('/orders/:id/delete', role('admin'), (req, res) => {
  run('DELETE FROM orders WHERE id = ?', req.params.id);
  H.flash(req, 'success', 'Order deleted.');
  res.redirect('/admin/orders');
});

router.get('/orders/:id/invoice', (req, res, next) => {
  const order = get('SELECT * FROM orders WHERE id = ?', req.params.id);
  if (!order) return next();
  res.render('invoice', { order, items: all('SELECT * FROM order_items WHERE order_id = ?', order.id) });
});

/* ---------------- customers ---------------- */
router.get('/customers', (req, res) => {
  const q = req.query.q ? `%${req.query.q}%` : null;
  const customers = all(`SELECT c.*, COUNT(o.id) orders, COALESCE(SUM(CASE WHEN o.status != 'cancelled' THEN o.total END),0) spent, MAX(o.created_at) last_order
    FROM customers c LEFT JOIN orders o ON o.customer_id = c.id ${q ? 'WHERE c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?' : ''}
    GROUP BY c.id ORDER BY c.created_at DESC LIMIT 500`, ...(q ? [q, q, q] : []));
  res.render('admin/customers', { customers, q: req.query.q || '', title: 'Customers' });
});

router.get('/customers.csv', (req, res) => {
  const rows = all(`SELECT c.name, c.phone, c.email, c.address, c.pincode, c.created_at, COUNT(o.id) orders, COALESCE(SUM(o.total),0) spent
    FROM customers c LEFT JOIN orders o ON o.customer_id = c.id AND o.status != 'cancelled' GROUP BY c.id ORDER BY c.created_at DESC`);
  csv(res, 'customers.csv', ['name', 'phone', 'email', 'address', 'pincode', 'created_at', 'orders', 'spent'], rows);
});

router.get('/customers/:id', (req, res, next) => {
  const c = get('SELECT * FROM customers WHERE id = ?', req.params.id);
  if (!c) return next();
  res.render('admin/customer', {
    c,
    orders: all('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC', c.id),
    addresses: all('SELECT * FROM customer_addresses WHERE customer_id = ?', c.id),
    title: c.name,
  });
});

router.post('/customers/:id', (req, res) => {
  const b = req.body;
  run('UPDATE customers SET name = ?, email = ?, address = ?, pincode = ?, notes = ?, is_active = ? WHERE id = ?', b.name, b.email || null, b.address || null, b.pincode || null, b.notes || null, b.is_active ? 1 : 0, req.params.id);
  if (b.password) run('UPDATE customers SET password_hash = ? WHERE id = ?', bcrypt.hashSync(b.password, 10), req.params.id);
  H.flash(req, 'success', 'Customer saved.');
  res.redirect(`/admin/customers/${req.params.id}`);
});

router.post('/customers/:id/delete', role('admin'), (req, res) => {
  run('DELETE FROM customers WHERE id = ?', req.params.id);
  H.flash(req, 'success', 'Customer deleted (their orders were kept).');
  res.redirect('/admin/customers');
});

/* ---------------- price list matrix ---------------- */
router.get('/pricing', MANAGE, (req, res) => {
  const services = all("SELECT * FROM services WHERE pricing_mode = 'per_item' ORDER BY sort_order, id");
  const kgServices = all("SELECT * FROM services WHERE pricing_mode = 'per_kg' ORDER BY sort_order, id");
  const cats = all('SELECT * FROM item_categories ORDER BY sort_order, id');
  const items = all('SELECT * FROM items ORDER BY sort_order, id');
  const pmap = {};
  for (const p of all('SELECT * FROM item_prices')) pmap[`${p.item_id}_${p.service_id}`] = p.price;
  res.render('admin/pricing', { services, kgServices, cats, items, pmap, title: 'Price List' });
});

router.post('/pricing', MANAGE, (req, res) => {
  tx(() => {
    for (const [k, v] of Object.entries(req.body)) {
      let m = k.match(/^p_(\d+)_(\d+)$/);
      if (m) {
        if (v === '' || v == null) run('DELETE FROM item_prices WHERE item_id = ? AND service_id = ?', m[1], m[2]);
        else run('INSERT INTO item_prices (item_id, service_id, price) VALUES (?, ?, ?) ON CONFLICT(item_id, service_id) DO UPDATE SET price = excluded.price', m[1], m[2], parseFloat(v) || 0);
      }
      m = k.match(/^kg_(\d+)$/);
      if (m) run('UPDATE services SET price_per_kg = ? WHERE id = ?', parseFloat(v) || 0, m[1]);
    }
    const newName = String(req.body.new_item || '').trim();
    if (newName) run('INSERT INTO items (name, category_id, unit, sort_order) VALUES (?, ?, ?, 999)', newName, req.body.new_item_cat || null, req.body.new_item_unit || 'pc');
  });
  H.flash(req, 'success', 'Price list saved.');
  res.redirect('/admin/pricing');
});

/* ---------------- messages & subscribers ---------------- */
router.get('/messages', (req, res) => {
  res.render('admin/messages', { messages: all('SELECT * FROM messages ORDER BY created_at DESC'), open: req.query.open, title: 'Messages' });
});
router.post('/messages/:id/read', (req, res) => { run('UPDATE messages SET is_read = 1 - is_read WHERE id = ?', req.params.id); res.redirect('/admin/messages'); });
router.post('/messages/:id/delete', (req, res) => { run('DELETE FROM messages WHERE id = ?', req.params.id); res.redirect('/admin/messages'); });

router.get('/subscribers', MANAGE, (req, res) => res.render('admin/subscribers', { subs: all('SELECT * FROM subscribers ORDER BY created_at DESC'), title: 'Subscribers' }));
router.get('/subscribers.csv', MANAGE, (req, res) => csv(res, 'subscribers.csv', ['email', 'created_at'], all('SELECT * FROM subscribers ORDER BY created_at DESC')));
router.post('/subscribers/:id/delete', MANAGE, (req, res) => { run('DELETE FROM subscribers WHERE id = ?', req.params.id); res.redirect('/admin/subscribers'); });

/* ---------------- media ---------------- */
router.get('/media', MANAGE, (req, res) => res.render('admin/media', { media: all('SELECT * FROM media ORDER BY id DESC'), title: 'Media Library' }));
router.post('/media', MANAGE, upload.array('files', 20), (req, res) => {
  (req.files || []).forEach(storeFile);
  H.flash(req, req.files?.length ? 'success' : 'error', req.files?.length ? `${req.files.length} file(s) uploaded.` : 'No valid images were uploaded (PNG, JPG, WEBP, GIF, AVIF, ICO).');
  res.redirect('/admin/media');
});
router.post('/media/:id/delete', MANAGE, (req, res) => {
  const m = get('SELECT * FROM media WHERE id = ?', req.params.id);
  if (m) {
    fs.rm(path.join(UPLOAD_DIR, path.basename(m.filename)), { force: true }, () => {});
    run('DELETE FROM media WHERE id = ?', m.id);
  }
  res.redirect('/admin/media');
});
router.get('/media.json', (req, res) => res.json(all('SELECT id, filename, original_name FROM media ORDER BY id DESC LIMIT 200').map((m) => ({ ...m, url: `/uploads/${m.filename}` }))));

/* ---------------- settings & homepage CMS ---------------- */
function settingsScreen(screen) {
  return (req, res) => {
    const groups = GROUPS.filter((g) => g.screen === screen);
    const tab = groups.find((g) => g.key === req.query.tab) ? req.query.tab : groups[0].key;
    res.render('admin/settings', { groups, tab, screen, ICON_NAMES, title: screen === 'homepage' ? 'Homepage & About' : 'Settings' });
  };
}
router.get('/settings', MANAGE, settingsScreen('settings'));
router.get('/homepage', MANAGE, settingsScreen('homepage'));

router.post('/settings', MANAGE, upload.any(), (req, res) => {
  const group = GROUPS.find((g) => g.key === req.body._group);
  if (!group) return res.redirect('/admin/settings');
  const files = Object.fromEntries((req.files || []).map((f) => [f.fieldname, f]));
  const out = {};
  for (const f of group.fields) {
    const v = req.body[f.name];
    if (f.type === 'checkbox') out[f.name] = v ? '1' : '0';
    else if (f.type === 'image') out[f.name] = files[f.name] ? storeFile(files[f.name]) : req.body[`${f.name}__remove`] ? '' : (v || '');
    else if (f.type === 'repeater') {
      const rows = [];
      const count = Math.max(0, ...f.subfields.map((sf) => [].concat(req.body[`${f.name}__${sf.name}`] || []).length));
      for (let i = 0; i < count; i++) {
        const row = {};
        for (const sf of f.subfields) row[sf.name] = [].concat(req.body[`${f.name}__${sf.name}`] || [])[i] || '';
        if (Object.values(row).some((x) => String(x).trim())) rows.push(row);
      }
      out[f.name] = JSON.stringify(rows);
    } else out[f.name] = v ?? '';
  }
  saveSettings(out);
  H.flash(req, 'success', `${group.title} saved.`);
  res.redirect(`/admin/${group.screen === 'homepage' ? 'homepage' : 'settings'}?tab=${group.key}`);
});

/* ---------------- own profile ---------------- */
router.get('/profile', (req, res) => res.render('admin/profile', { title: 'My profile' }));
router.post('/profile', (req, res) => {
  const me = get('SELECT * FROM admins WHERE id = ?', req.session.adminId);
  const { name, current, password } = req.body;
  if (name) run('UPDATE admins SET name = ? WHERE id = ?', name, me.id);
  if (password) {
    if (!bcrypt.compareSync(current || '', me.password_hash)) { H.flash(req, 'error', 'Current password is incorrect.'); return res.redirect('/admin/profile'); }
    if (password.length < 8) { H.flash(req, 'error', 'New password must be at least 8 characters.'); return res.redirect('/admin/profile'); }
    run('UPDATE admins SET password_hash = ? WHERE id = ?', bcrypt.hashSync(password, 10), me.id);
  }
  H.flash(req, 'success', 'Profile updated.');
  res.redirect('/admin/profile');
});

/* ---------------- generic resource CRUD ---------------- */
function resource(req, res, next) {
  const r = RESOURCES[req.params.res];
  if (!r) return next('router');
  const roles = r.roles || ['admin', 'manager'];
  if (!roles.includes(res.locals.admin.role)) return res.status(403).render('admin/denied');
  req.R = r;
  res.locals.R = r;
  res.locals.resKey = req.params.res;
  next();
}

const resolveOptions = (f) => (typeof f.options === 'function' ? f.options() : f.options || []);

function collectValues(R, req, existing) {
  const b = req.body;
  const files = Object.fromEntries((req.files || []).map((f) => [f.fieldname, f]));
  const vals = {};
  for (const f of R.fields) {
    let v = b[f.name];
    switch (f.type) {
      case 'checkbox': vals[f.name] = v ? 1 : 0; break;
      case 'number': vals[f.name] = v === '' || v == null ? 0 : parseFloat(v) || 0; break;
      case 'image': vals[f.name] = files[f.name] ? storeFile(files[f.name]) : b[`${f.name}__remove`] ? '' : (v || null); break;
      case 'password': if (v) vals.password_hash = bcrypt.hashSync(v, 10); break;
      case 'slug': {
        let base = H.slugify(v || b[f.from]);
        let slug = base;
        let i = 2;
        while (get(`SELECT 1 FROM ${R.table} WHERE slug = ? AND id != ?`, slug, existing?.id || 0)) slug = `${base}-${i++}`;
        vals.slug = slug;
        break;
      }
      default:
        v = v == null ? null : String(v).trim();
        if (f.upper && v) v = v.toUpperCase();
        vals[f.name] = v === '' && (f.type === 'select' || f.type === 'date') ? null : v;
    }
  }
  return vals;
}

router.get('/:res', resource, (req, res) => {
  const R = req.R;
  const where = [];
  const p = [];
  if (R.search && req.query.q) { where.push('(' + R.search.map((c) => `${c} LIKE ?`).join(' OR ') + ')'); R.search.forEach(() => p.push(`%${req.query.q}%`)); }
  if (R.filter && req.query.f) { where.push(`${R.filter.name} = ?`); p.push(req.query.f); }
  const rows = all(`SELECT * FROM ${R.table} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${R.order || 'id DESC'}`, ...p);
  for (const c of R.list.filter((x) => x.lookup)) {
    const cache = {};
    for (const r of rows) {
      const v = r[c.name];
      if (!(v in cache)) { const hit = v ? get(c.lookup, v) : null; cache[v] = hit ? Object.values(hit)[0] : '—'; }
      r[`__${c.name}`] = cache[v];
    }
  }
  res.render('admin/resource-list', { rows, q: req.query.q || '', fv: req.query.f || '', filterOptions: R.filter ? resolveOptions(R.filter) : [], title: R.title });
});

router.get('/:res/new', resource, (req, res) => {
  const row = {};
  for (const f of req.R.fields) if (f.default !== undefined) row[f.name] = f.default;
  res.render('admin/resource-form', { row, isNew: true, resolveOptions, ICON_NAMES, title: `New ${req.R.singular}` });
});

router.get('/:res/:id/edit', resource, (req, res, next) => {
  const row = get(`SELECT * FROM ${req.R.table} WHERE id = ?`, req.params.id);
  if (!row) return next();
  res.render('admin/resource-form', { row, isNew: false, resolveOptions, ICON_NAMES, title: `Edit ${req.R.singular}` });
});

function validate(R, vals) {
  for (const f of R.fields) if (f.required && f.type !== 'password' && (vals[f.name] == null || vals[f.name] === '')) return `${f.label} is required.`;
  return null;
}

router.post('/:res', resource, upload.any(), (req, res) => {
  const R = req.R;
  const vals = collectValues(R, req, null);
  const err = validate(R, vals);
  if (err) { H.flash(req, 'error', err); return res.redirect(`/admin/${req.params.res}/new`); }
  if (R.table === 'admins' && !vals.password_hash) { H.flash(req, 'error', 'Password is required for new users.'); return res.redirect(`/admin/${req.params.res}/new`); }
  const cols = Object.keys(vals);
  try {
    run(`INSERT INTO ${R.table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...cols.map((c) => vals[c]));
  } catch (e) {
    H.flash(req, 'error', /UNIQUE/.test(e.message) ? 'That value is already in use — it must be unique.' : e.message);
    return res.redirect(`/admin/${req.params.res}/new`);
  }
  H.flash(req, 'success', `${R.singular} created.`);
  res.redirect(`/admin/${req.params.res}`);
});

router.post('/:res/:id', resource, upload.any(), (req, res, next) => {
  const R = req.R;
  const existing = get(`SELECT * FROM ${R.table} WHERE id = ?`, req.params.id);
  if (!existing) return next();
  const vals = collectValues(R, req, existing);
  const err = validate(R, vals);
  if (err) { H.flash(req, 'error', err); return res.redirect(`/admin/${req.params.res}/${req.params.id}/edit`); }
  if (R.table === 'admins' && existing.id === req.session.adminId && (!vals.is_active || vals.role !== 'admin')) {
    H.flash(req, 'error', 'You can’t deactivate or demote your own account.');
    return res.redirect(`/admin/${req.params.res}/${req.params.id}/edit`);
  }
  const cols = Object.keys(vals);
  try {
    run(`UPDATE ${R.table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, ...cols.map((c) => vals[c]), existing.id);
  } catch (e) {
    H.flash(req, 'error', /UNIQUE/.test(e.message) ? 'That value is already in use — it must be unique.' : e.message);
    return res.redirect(`/admin/${req.params.res}/${req.params.id}/edit`);
  }
  H.flash(req, 'success', `${R.singular} saved.`);
  res.redirect(req.body._stay ? `/admin/${req.params.res}/${existing.id}/edit` : `/admin/${req.params.res}`);
});

router.post('/:res/:id/toggle/:field', resource, (req, res) => {
  const R = req.R;
  const f = R.list.find((c) => c.name === req.params.field && c.type === 'toggle');
  if (f && !(R.table === 'admins' && Number(req.params.id) === req.session.adminId)) run(`UPDATE ${R.table} SET ${f.name} = 1 - ${f.name} WHERE id = ?`, req.params.id);
  if (req.get('x-requested-with') === 'fetch') return res.json({ ok: true });
  res.redirect(`/admin/${req.params.res}`);
});

router.post('/:res/:id/delete', resource, (req, res) => {
  if (req.R.table === 'admins' && Number(req.params.id) === req.session.adminId) {
    H.flash(req, 'error', 'You can’t delete your own account.');
    return res.redirect(`/admin/${req.params.res}`);
  }
  run(`DELETE FROM ${req.R.table} WHERE id = ?`, req.params.id);
  H.flash(req, 'success', `${req.R.singular} deleted.`);
  res.redirect(`/admin/${req.params.res}`);
});

router.post('/:res/:id/duplicate', resource, (req, res, next) => {
  const R = req.R;
  const row = get(`SELECT * FROM ${R.table} WHERE id = ?`, req.params.id);
  if (!row || R.table === 'admins') return next();
  delete row.id;
  delete row.created_at;
  if ('slug' in row) row.slug = `${row.slug}-copy-${Date.now().toString(36)}`;
  if ('code' in row) row.code = `${row.code}-COPY`;
  if ('title' in row) row.title = `${row.title} (copy)`;
  if ('used_count' in row) row.used_count = 0;
  const cols = Object.keys(row);
  const id = run(`INSERT INTO ${R.table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...cols.map((c) => row[c])).lastInsertRowid;
  H.flash(req, 'success', `${R.singular} duplicated.`);
  res.redirect(`/admin/${req.params.res}/${id}/edit`);
});

router.use((req, res) => res.status(404).render('admin/denied', { notFound: true }));

module.exports = router;
