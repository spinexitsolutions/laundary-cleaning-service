# Tag & Fold — Laundry & Dry-Cleaning Website + Admin CMS

A complete laundry service website with online pickup booking, order tracking, customer accounts and a full admin panel where **everything** on the site can be changed without touching code.

Stack: Node.js (≥ 22.5) · Express · EJS · SQLite (built-in `node:sqlite`, no native build) · plain CSS/JS.

## Run it

```bash
npm install
npm start
```

- Website → http://localhost:3000
- Admin → http://localhost:3000/admin

On first start the database (`data/laundry.db`) is created and filled with demo content, and an admin account is created from the `ADMIN_EMAIL` / `ADMIN_PASSWORD` env vars (see `src/seed.js` for the demo defaults used when they're not set). **Change the admin password right after the first login** (Admin → your name → My profile). `npm run seed` wipes the database and reloads the demo data.

Other env vars: `PORT`, `DB_PATH`, `SESSION_SECRET`, `NODE_ENV=production` (secure cookies; set `COOKIE_SECURE=0` if not behind HTTPS).

## Website

- Home: animated washing-machine hero, care-label marquee, services as garment tags, "clothesline" how-it-works, stats, receipt-style price list, why-us, testimonials, pincode checker, FAQ, journal, CTA
- Services list + detail pages with per-service price list
- Full pricing page (per-kg + per-item matrix, category filter)
- **4-step booking**: services → items (qty steppers / kg slider / "count at pickup") → pincode, date, slot, express → address & payment. Live receipt with server-side pricing, coupons, GST, area delivery fee, free-delivery threshold, minimum order, slot capacity
- Booking confirmation ticket, public **order tracking** (order no + phone) with progress bar and timeline
- Customer accounts: register/login (guest bookings are claimed by phone), order history, order detail, cancel before pickup, printable invoice, profile, saved addresses
- About, FAQ, service areas, gallery, contact form (honeypot spam guard), blog + categories, CMS pages, newsletter, WhatsApp button, sitemap.xml, robots.txt, SEO meta
- Responsive, reduced-motion aware

## Admin panel

- **Dashboard**: revenue, orders today, customers, AOV, 14-day revenue chart, pipeline, today's pickups & deliveries, top services, new messages
- **Orders**: filters (status, payment, dates, pickup day, search), CSV export, one-click status stages with customer-visible notes, payment status, staff assignment, internal notes, edit items/charges with auto recalculation, create walk-in/phone orders, invoice, WhatsApp the customer
- **Customers**: search, lifetime value, edit, reset password, notes, CSV export
- **Catalogue**: services (icon, colour, per-item/per-kg pricing, content, SEO), price-list matrix editor, garments, categories
- **Operations**: service areas & pincodes with per-area delivery fee, pickup slots with daily capacity, coupons (percent/flat, min order, cap, limit, expiry)
- **Website CMS**: homepage text & every section on/off, hero, steps, stats, features, About page, pages, blog (rich-text editor), testimonials, FAQs, team, gallery, header/footer menus, media library, subscribers
- **Settings**: business name/logo/favicon, brand colours (whole site re-themes), contact, social, booking charges & tax, payment methods, invoice/GSTIN, SEO, analytics scripts, footer
- **Staff roles**: Administrator / Manager / Staff (staff see orders & customers only)

Security: bcrypt passwords, CSRF tokens on every form, sessions stored in SQLite, login rate-limiting, server-side price calculation, image-only uploads.
