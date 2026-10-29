const express = require('express');
const bcrypt = require('bcryptjs');
const { get, all, run } = require('../db');
const { getSettings } = require('../settings');
const H = require('../helpers');

const router = express.Router();

router.use((req, res, next) => {
  const menus = all('SELECT * FROM menu_items WHERE is_active = 1 ORDER BY sort_order, id');
  res.locals.menu = (loc) => menus.filter((m) => m.location === loc);
  res.locals.navServices = all('SELECT title, slug FROM services WHERE is_active = 1 ORDER BY sort_order, id');
  res.locals.meta = { title: `My account — ${getSettings().site_name}`, desc: '' };
  next();
});

const requireCustomer = (req, res, next) => (res.locals.customer ? next() : res.redirect(`/account/login?next=${encodeURIComponent(req.originalUrl)}`));
const safeNext = (n) => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') ? n : '/account');
const normPhone = (p) => String(p || '').replace(/[^\d+]/g, '');

router.get('/login', (req, res) => res.render('account/login', { mode: 'login', next: req.query.next || '' }));
router.get('/register', (req, res) => res.render('account/login', { mode: 'register', next: req.query.next || '' }));

router.post('/login', (req, res) => {
  const id = String(req.body.login || '').trim();
  const c = get('SELECT * FROM customers WHERE (phone = ? OR lower(email) = lower(?)) AND is_active = 1', normPhone(id), id);
  if (!c || !c.password_hash || !bcrypt.compareSync(String(req.body.password || ''), c.password_hash)) {
    H.flash(req, 'error', 'Those details don’t match. If you booked as a guest, create an account with the same phone number.');
    return res.redirect('/account/login');
  }
  req.session.regenerate(() => {
    req.session.customerId = c.id;
    res.redirect(safeNext(req.body.next));
  });
});

router.post('/register', (req, res) => {
  const { name, email, password } = req.body;
  const phone = normPhone(req.body.phone);
  if (!name || phone.replace(/\D/g, '').length < 10 || String(password || '').length < 6) {
    H.flash(req, 'error', 'Please enter your name, a valid phone number and a password of at least 6 characters.');
    return res.redirect('/account/register');
  }
  const ex = get('SELECT * FROM customers WHERE phone = ?', phone);
  if (ex && ex.password_hash) {
    H.flash(req, 'error', 'An account with this phone already exists. Please sign in.');
    return res.redirect('/account/login');
  }
  const hash = bcrypt.hashSync(password, 10);
  let id;
  if (ex) { // guest who booked before — claim the record and its orders
    run('UPDATE customers SET name = ?, email = COALESCE(?, email), password_hash = ? WHERE id = ?', name, email || null, hash, ex.id);
    id = ex.id;
  } else {
    id = Number(run('INSERT INTO customers (name, phone, email, password_hash) VALUES (?, ?, ?, ?)', name, phone, email || null, hash).lastInsertRowid);
  }
  req.session.regenerate(() => {
    req.session.customerId = id;
    H.flash(req, 'success', `Welcome, ${name.split(' ')[0]}! Your account is ready.`);
    res.redirect(safeNext(req.body.next));
  });
});

router.post('/logout', (req, res) => {
  delete req.session.customerId;
  res.redirect('/');
});

router.get('/', requireCustomer, (req, res) => {
  const id = res.locals.customer.id;
  const orders = all('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC', id);
  const stats = get("SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total END), 0) spent FROM orders WHERE customer_id = ?", id);
  res.render('account/dashboard', { orders, stats, active: orders.filter((o) => !['delivered', 'cancelled'].includes(o.status)) });
});

router.get('/orders/:no', requireCustomer, (req, res, next) => {
  const order = get('SELECT * FROM orders WHERE order_no = ? AND customer_id = ?', req.params.no, res.locals.customer.id);
  if (!order) return next();
  res.render('account/order', {
    order,
    items: all('SELECT * FROM order_items WHERE order_id = ?', order.id),
    history: all('SELECT * FROM order_history WHERE order_id = ? ORDER BY created_at, id', order.id),
  });
});

router.post('/orders/:no/cancel', requireCustomer, (req, res) => {
  const order = get('SELECT * FROM orders WHERE order_no = ? AND customer_id = ?', req.params.no, res.locals.customer.id);
  if (order && ['pending', 'confirmed'].includes(order.status)) {
    run("UPDATE orders SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?", order.id);
    run("INSERT INTO order_history (order_id, status, note) VALUES (?, 'cancelled', 'Cancelled by customer')", order.id);
    H.flash(req, 'success', 'Your order has been cancelled.');
  } else H.flash(req, 'error', 'This order can no longer be cancelled online — please call us.');
  res.redirect(`/account/orders/${req.params.no}`);
});

router.get('/orders/:no/invoice', requireCustomer, (req, res, next) => {
  const order = get('SELECT * FROM orders WHERE order_no = ? AND customer_id = ?', req.params.no, res.locals.customer.id);
  if (!order) return next();
  res.render('invoice', { order, items: all('SELECT * FROM order_items WHERE order_id = ?', order.id) });
});

router.get('/profile', requireCustomer, (req, res) => {
  res.render('account/profile', {
    c: get('SELECT * FROM customers WHERE id = ?', res.locals.customer.id),
    addresses: all('SELECT * FROM customer_addresses WHERE customer_id = ? ORDER BY id', res.locals.customer.id),
  });
});

router.post('/profile', requireCustomer, (req, res) => {
  const { name, email, address, pincode, password } = req.body;
  if (!name) { H.flash(req, 'error', 'Name is required.'); return res.redirect('/account/profile'); }
  run('UPDATE customers SET name = ?, email = ?, address = ?, pincode = ? WHERE id = ?', name, email || null, address || null, pincode || null, res.locals.customer.id);
  if (password) {
    if (password.length < 6) { H.flash(req, 'error', 'Password must be at least 6 characters.'); return res.redirect('/account/profile'); }
    run('UPDATE customers SET password_hash = ? WHERE id = ?', bcrypt.hashSync(password, 10), res.locals.customer.id);
  }
  H.flash(req, 'success', 'Profile saved.');
  res.redirect('/account/profile');
});

router.post('/addresses', requireCustomer, (req, res) => {
  const { label, address, pincode, landmark } = req.body;
  if (address) run('INSERT INTO customer_addresses (customer_id, label, address, pincode, landmark) VALUES (?, ?, ?, ?, ?)', res.locals.customer.id, label || 'Home', address, pincode || null, landmark || null);
  res.redirect('/account/profile');
});

router.post('/addresses/:id/delete', requireCustomer, (req, res) => {
  run('DELETE FROM customer_addresses WHERE id = ? AND customer_id = ?', req.params.id, res.locals.customer.id);
  res.redirect('/account/profile');
});

module.exports = router;
