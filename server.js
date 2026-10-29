const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const compression = require('compression');

const { get, all } = require('./src/db');
const { getSettings } = require('./src/settings');
const SQLiteStore = require('./src/session-store');
const H = require('./src/helpers');
const { icon, care } = require('./src/icons');
const { ensureSeeded } = require('./src/seed');

ensureSeeded();

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(compression());
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'SAMEORIGIN' });
  next();
});
app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '7d' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), { maxAge: '30d' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '1mb' }));

const secretFile = path.join(__dirname, 'data', '.session-secret');
let secret = process.env.SESSION_SECRET;
if (!secret) {
  if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'));
  secret = fs.readFileSync(secretFile, 'utf8');
}
app.use(session({
  store: new SQLiteStore(),
  secret,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== '0', maxAge: 1000 * 60 * 60 * 24 * 14 },
}));

// Locals available in every template.
app.use((req, res, next) => {
  const s = getSettings();
  res.locals.s = s;
  res.locals.H = H;
  res.locals.icon = icon;
  res.locals.care = care;
  res.locals.path = req.path;
  res.locals.csrf = H.csrfToken(req);
  res.locals.flash = req.session.flash || [];
  req.session.flash = [];
  res.locals.customer = req.session.customerId ? get('SELECT id, name, phone, email FROM customers WHERE id = ?', req.session.customerId) : null;
  res.locals.admin = req.session.adminId ? get('SELECT id, name, email, role FROM admins WHERE id = ? AND is_active = 1', req.session.adminId) : null;
  res.locals.meta = { title: s.meta_title, desc: s.meta_desc };
  next();
});

app.use(H.verifyCsrf);

app.use('/admin', require('./src/routes/admin'));
app.use('/account', require('./src/routes/account'));
app.use('/', require('./src/routes/public'));

app.use((req, res) => {
  res.status(404).render('public/404', { meta: { title: 'Page not found' } });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('<h1>Something went wrong</h1><p>Please try again in a moment.</p>');
});

app.listen(PORT, () => {
  console.log(`Laundry site running → http://localhost:${PORT}`);
  console.log(`Admin panel        → http://localhost:${PORT}/admin`);
});
