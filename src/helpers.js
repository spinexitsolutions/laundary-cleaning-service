const crypto = require('crypto');
const { get, all } = require('./db');
const { getSettings } = require('./settings');

const ORDER_STATUSES = [
  { key: 'pending', label: 'Order placed', short: 'Pending', color: '#B7791F' },
  { key: 'confirmed', label: 'Pickup confirmed', short: 'Confirmed', color: '#2B6CB0' },
  { key: 'picked_up', label: 'Picked up', short: 'Picked up', color: '#6B46C1' },
  { key: 'processing', label: 'Cleaning in progress', short: 'Processing', color: '#2C7A7B' },
  { key: 'ready', label: 'Ready for delivery', short: 'Ready', color: '#0E7490' },
  { key: 'out_for_delivery', label: 'Out for delivery', short: 'Out for delivery', color: '#C05621' },
  { key: 'delivered', label: 'Delivered', short: 'Delivered', color: '#2F855A' },
  { key: 'cancelled', label: 'Cancelled', short: 'Cancelled', color: '#C53030' },
];
const STATUS_MAP = Object.fromEntries(ORDER_STATUSES.map((s) => [s.key, s]));
const PAYMENT_STATUSES = ['unpaid', 'paid', 'refunded'];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// "Clean clothes, *zero* chores." -> accent-styled <em>
function emph(s) {
  return esc(s).replace(/\*(.+?)\*/g, '<em>$1</em>');
}

function money(n) {
  const cur = getSettings().currency || '₹';
  const v = Number(n || 0);
  const str = v.toLocaleString('en-IN', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
  return cur + str;
}

function slugify(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '').replace(/[\s-]+/g, '-').replace(/^-|-$/g, '') || 'item';
}

function fmtDate(d, withTime = false) {
  if (!d) return '—';
  const dt = new Date(String(d).length <= 10 ? d + 'T00:00:00' : d.replace(' ', 'T') + (d.includes('Z') ? '' : 'Z'));
  if (isNaN(dt)) return d;
  const opts = { day: 'numeric', month: 'short', year: 'numeric' };
  if (withTime) Object.assign(opts, { hour: 'numeric', minute: '2-digit' });
  return dt.toLocaleString('en-IN', opts);
}

function initials(name) {
  return String(name || '').split(/\s+/).filter((w) => /^[a-z0-9]/i.test(w)).map((w) => w[0].toUpperCase()).slice(0, 2).join('') || '•';
}

// Hero heading: "|" forces a line break, otherwise break after commas.
function heroLines(t) {
  const parts = String(t || '').includes('|') ? t.split('|') : String(t || '').split(/(?<=,)\s+/);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function nl2br(s) {
  return esc(s).replace(/\n/g, '<br>');
}

function lines(s) {
  return String(s || '').split('\n').map((l) => l.trim()).filter(Boolean);
}

function paymentMethods() {
  return lines(getSettings().payment_methods).map((l) => {
    const [code, label] = l.split('|');
    return { code: code.trim(), label: (label || code).trim() };
  });
}

/* ---------------- CSRF + flash ---------------- */
function csrfToken(req) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  return req.session.csrf;
}

function verifyCsrf(req, res, next) {
  if (req.method !== 'POST') return next();
  // Multipart forms are parsed later by multer, so they pass the token in the query string.
  const token = req.body?._csrf || req.query._csrf || req.get('x-csrf-token');
  if (!token || token !== req.session.csrf) {
    return res.status(403).send('Session expired or invalid form token. Please go back, refresh and try again.');
  }
  next();
}

function flash(req, type, msg) {
  req.session.flash = req.session.flash || [];
  req.session.flash.push({ type, msg });
}

/* ---------------- Pricing engine ---------------- */
function findArea(pincode) {
  const pin = String(pincode || '').trim();
  if (!pin) return null;
  const areas = all('SELECT * FROM service_areas WHERE is_active = 1');
  return areas.find((a) => String(a.pincodes || '').split(/[\s,]+/).includes(pin)) || null;
}

function validateCoupon(code, subtotal) {
  if (!code) return { ok: false, discount: 0 };
  const c = get('SELECT * FROM coupons WHERE upper(code) = upper(?) AND is_active = 1', String(code).trim());
  if (!c) return { ok: false, discount: 0, error: 'That code isn’t valid.' };
  if (c.expires_at && new Date(c.expires_at + 'T23:59:59') < new Date()) return { ok: false, discount: 0, error: 'This code has expired.' };
  if (c.usage_limit && c.used_count >= c.usage_limit) return { ok: false, discount: 0, error: 'This code has reached its usage limit.' };
  if (subtotal < (c.min_order || 0)) return { ok: false, discount: 0, error: `Add items worth ${money(c.min_order)} to use this code.` };
  let discount = c.type === 'percent' ? (subtotal * c.value) / 100 : c.value;
  if (c.max_discount && discount > c.max_discount) discount = c.max_discount;
  discount = Math.min(discount, subtotal);
  return { ok: true, coupon: c, discount: Math.round(discount * 100) / 100, message: c.description || 'Code applied!' };
}

/*
 * Turns a cart ({ items: [{service_id, item_id, qty}], kg: {service_id: kg} })
 * into priced lines using server-side prices only, then applies charges.
 */
function priceCart({ items = [], kg = {}, express = false, coupon = '', pincode = '' }) {
  const s = getSettings();
  const lines_ = [];
  for (const it of items) {
    const qty = Math.max(0, Math.min(999, parseInt(it.qty, 10) || 0));
    if (!qty) continue;
    const row = get(`SELECT i.id, i.name, i.unit, p.price, sv.id AS sid, sv.title AS stitle
      FROM items i JOIN item_prices p ON p.item_id = i.id JOIN services sv ON sv.id = p.service_id
      WHERE i.id = ? AND sv.id = ? AND i.is_active = 1 AND sv.is_active = 1`, it.item_id, it.service_id);
    if (!row) continue;
    lines_.push({ service_id: row.sid, service_title: row.stitle, item_id: row.id, item_name: row.name, unit: row.unit || 'pc', qty, unit_price: row.price, line_total: row.price * qty });
  }
  for (const [sid, w] of Object.entries(kg || {})) {
    const weight = Math.max(0, Math.min(200, parseFloat(w) || 0));
    if (!weight) continue;
    const sv = get("SELECT * FROM services WHERE id = ? AND is_active = 1 AND pricing_mode = 'per_kg'", sid);
    if (!sv) continue;
    lines_.push({ service_id: sv.id, service_title: sv.title, item_id: null, item_name: `${sv.title} (by weight)`, unit: 'kg', qty: weight, unit_price: sv.price_per_kg, line_total: sv.price_per_kg * weight });
  }
  return computeTotals(lines_, { express, coupon, pincode });
}

function computeTotals(lines_, { express = false, coupon = '', pincode = '', deliveryOverride = null } = {}) {
  const s = getSettings();
  const r2 = (n) => Math.round(n * 100) / 100;
  const subtotal = r2(lines_.reduce((a, l) => a + Number(l.line_total || 0), 0));
  const c = validateCoupon(coupon, subtotal);
  const discount = c.ok ? c.discount : 0;
  const area = findArea(pincode);
  let delivery = deliveryOverride != null ? Number(deliveryOverride) : (area && area.delivery_fee != null ? Number(area.delivery_fee) : Number(s.delivery_fee || 0));
  const freeAbove = Number(s.free_delivery_above || 0);
  if (deliveryOverride == null && freeAbove && subtotal - discount >= freeAbove) delivery = 0;
  const expressFee = express ? Number(s.express_fee || 0) : 0;
  const taxable = Math.max(0, subtotal - discount) + delivery + expressFee;
  const tax = r2((taxable * Number(s.tax_percent || 0)) / 100);
  const total = r2(taxable + tax);
  return { lines: lines_, subtotal, discount, coupon: c, delivery_fee: r2(delivery), express_fee: expressFee, tax, total, area };
}

function nextOrderNo() {
  const prefix = (getSettings().order_prefix || 'ORD').toUpperCase();
  const last = get('SELECT id FROM orders ORDER BY id DESC LIMIT 1');
  const n = 2040 + (last ? last.id : 0) + 1;
  let no = `${prefix}-${n}`;
  while (get('SELECT 1 FROM orders WHERE order_no = ?', no)) no = `${prefix}-${n}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  return no;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function today() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

module.exports = {
  ORDER_STATUSES, STATUS_MAP, PAYMENT_STATUSES,
  esc, emph, money, initials, heroLines, slugify, fmtDate, nl2br, lines, paymentMethods,
  csrfToken, verifyCsrf, flash,
  findArea, validateCoupon, priceCart, computeTotals, nextOrderNo, addDays, today,
};
