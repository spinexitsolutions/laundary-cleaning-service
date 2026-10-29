const bcrypt = require('bcryptjs');
const { db, get, run, all, tx } = require('./db');

function ensureSeeded(force = false) {
  if (!force && get('SELECT 1 FROM admins LIMIT 1')) return;
  seed();
}

function seed() {
  tx(() => {
    for (const t of ['order_history', 'order_items', 'orders', 'item_prices', 'items', 'item_categories', 'services', 'service_areas', 'time_slots', 'coupons', 'testimonials', 'faqs', 'posts', 'pages', 'team_members', 'menu_items', 'customer_addresses', 'customers', 'admins', 'messages', 'subscribers', 'settings', 'gallery']) {
      db.exec(`DELETE FROM ${t}`);
    }
    db.exec("DELETE FROM sqlite_sequence");

    const adminEmail = process.env.ADMIN_EMAIL || 'admin@tagandfold.in';
    const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
    run('INSERT INTO admins (name, email, password_hash, role) VALUES (?, ?, ?, ?)', 'Site Owner', adminEmail, bcrypt.hashSync(adminPass, 10), 'admin');
    run('INSERT INTO admins (name, email, password_hash, role, phone) VALUES (?, ?, ?, ?, ?)', 'Ravi (Pickup Valet)', 'ravi@tagandfold.in', bcrypt.hashSync('staff123', 10), 'staff', '+91 90000 11111');

    /* ---- Services ---- */
    const services = [
      ['Wash & Fold', 'wash-and-fold', 'Everyday laundry, by the kilo', 'washer', '#DCE6FB', 'per_kg', 89, 89, '24–48 hrs',
        'Your everyday clothes washed in a separate load, tumble dried, and neatly folded.',
        'Machine wash at the right temperature\nSeparate load — never mixed\nTumble dry & fold\nPacked in a reusable bag'],
      ['Wash & Iron', 'wash-and-iron', 'Washed, steamed and on hangers', 'iron', '#FDE6DC', 'per_kg', 129, 129, '48 hrs',
        'Everything from Wash & Fold, plus professional steam pressing. Shirts come back on hangers.',
        'Fabric-safe detergents\nSteam pressed\nShirts on hangers\nCollar & cuff care'],
      ['Dry Cleaning', 'dry-cleaning', 'For the pieces you love most', 'suit', '#E7E2F7', 'per_item', 0, 149, '72 hrs',
        'Suits, silk, wool and delicate ethnic wear cleaned with eco-friendly solvents and hand-finished.',
        'Eco-friendly solvents\nStain pre-treatment\nHand finishing\nBreathable garment cover'],
      ['Steam Ironing', 'steam-ironing', 'Crisp, crease-free, ready to wear', 'shirt', '#E1F1E8', 'per_item', 0, 15, 'Same day',
        'Already-clean clothes pressed with industrial steam irons for a sharp, professional finish.',
        'Industrial steam irons\nCreases where you want them\nFolded or on hangers'],
      ['Shoe Spa', 'shoe-spa', 'Sneakers, leather & suede revived', 'shoe', '#FBEFD5', 'per_item', 0, 299, '3–4 days',
        'Deep cleaning, deodorising and conditioning for sneakers, leather and suede footwear.',
        'Deep clean & deodorise\nSole whitening\nLeather conditioning\nSuede brushing'],
      ['Home Linen & Curtains', 'home-linen', 'Curtains, blankets, carpets', 'curtain', '#DDEFF0', 'per_item', 0, 199, '3–5 days',
        'Heavy and bulky home textiles — curtains, quilts, blankets and rugs — cleaned and sanitised.',
        'Dust & allergen removal\nAnti-bacterial wash\nCurtain take-down on request\nRolled carpet delivery'],
    ];
    services.forEach((sv, i) => {
      run(`INSERT INTO services (title, slug, tagline, icon, color, pricing_mode, price_per_kg, starting_price, turnaround, short_desc, features, content, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, sv[0], sv[1], sv[2], sv[3], sv[4], sv[5], sv[6], sv[7], sv[8], sv[9], sv[10],
      `<p>${sv[9]}</p><h3>What's included</h3><ul>${sv[10].split('\n').map((f) => `<li>${f}</li>`).join('')}</ul><p>Every garment is tagged on pickup, inspected before cleaning and checked again before it leaves our facility. Any pre-existing damage is photographed and shared with you.</p>`, i);
    });
    const sid = Object.fromEntries(all('SELECT id, slug FROM services').map((r) => [r.slug, r.id]));

    /* ---- Price list ---- */
    const cats = ['Men', 'Women', 'Kids', 'Household', 'Footwear'];
    cats.forEach((c, i) => run('INSERT INTO item_categories (name, sort_order) VALUES (?, ?)', c, i));
    const cid = Object.fromEntries(all('SELECT id, name FROM item_categories').map((r) => [r.name, r.id]));
    // [category, item, unit, dry clean, steam iron, shoe, home]
    const items = [
      ['Men', 'Shirt', 'pc', 129, 15], ['Men', 'T-Shirt', 'pc', 99, 12], ['Men', 'Trousers', 'pc', 139, 18],
      ['Men', 'Jeans', 'pc', 149, 20], ['Men', 'Suit (2 pc)', 'set', 449, 80], ['Men', 'Blazer', 'pc', 329, 60],
      ['Men', 'Kurta Pyjama', 'set', 199, 30], ['Men', 'Sherwani', 'pc', 699, 120], ['Men', 'Sweater', 'pc', 199, null],
      ['Women', 'Top / Blouse', 'pc', 129, 15], ['Women', 'Dress', 'pc', 249, 40], ['Women', 'Saree (Cotton)', 'pc', 199, 50],
      ['Women', 'Saree (Silk)', 'pc', 349, 70], ['Women', 'Lehenga', 'pc', 899, 150], ['Women', 'Salwar Suit (3 pc)', 'set', 249, 45],
      ['Women', 'Dupatta', 'pc', 99, 15], ['Women', 'Coat / Jacket', 'pc', 399, null],
      ['Kids', 'Kids Shirt / Top', 'pc', 79, 10], ['Kids', 'Kids Dress', 'pc', 149, 20], ['Kids', 'School Uniform', 'set', 129, 25],
      ['Household', 'Bedsheet (Single)', 'pc', 149, 35], ['Household', 'Bedsheet (Double)', 'pc', 199, 45], ['Household', 'Blanket', 'pc', 349, null],
      ['Household', 'Quilt / Razai', 'pc', 499, null], ['Household', 'Curtain (per panel)', 'pc', 249, 60], ['Household', 'Carpet (per sq.ft)', 'sq.ft', 39, null],
      ['Household', 'Sofa Cover (per seat)', 'pc', 149, null],
      ['Footwear', 'Sneakers', 'pair', null, null, 349], ['Footwear', 'Leather Shoes', 'pair', null, null, 399],
      ['Footwear', 'Suede Shoes', 'pair', null, null, 449], ['Footwear', 'Boots', 'pair', null, null, 499], ['Footwear', 'Sandals / Heels', 'pair', null, null, 299],
    ];
    items.forEach((it, i) => {
      const r = run('INSERT INTO items (category_id, name, unit, sort_order) VALUES (?, ?, ?, ?)', cid[it[0]], it[1], it[2], i);
      const id = Number(r.lastInsertRowid);
      const isHome = it[0] === 'Household';
      if (it[3] != null) run('INSERT INTO item_prices (item_id, service_id, price) VALUES (?, ?, ?)', id, isHome ? sid['home-linen'] : sid['dry-cleaning'], it[3]);
      if (it[4] != null) run('INSERT INTO item_prices (item_id, service_id, price) VALUES (?, ?, ?)', id, sid['steam-ironing'], it[4]);
      if (it[5] != null) run('INSERT INTO item_prices (item_id, service_id, price) VALUES (?, ?, ?)', id, sid['shoe-spa'], it[5]);
    });

    /* ---- Areas & slots ---- */
    [
      ['South Delhi', '110016 110017 110048 110049 110024 110065', 0],
      ['Central Delhi', '110001 110002 110003 110005 110055', 29],
      ['West Delhi', '110018 110026 110027 110015', 39],
      ['Gurugram', '122001 122002 122003 122018 122022', 49],
      ['Noida', '201301 201303 201304 201307', 49],
    ].forEach((a, i) => run('INSERT INTO service_areas (name, pincodes, delivery_fee, sort_order) VALUES (?, ?, ?, ?)', a[0], a[1], a[2], i));
    [['8:00 – 10:00 AM', '08:00', '10:00'], ['10:00 AM – 12:00 PM', '10:00', '12:00'], ['12:00 – 2:00 PM', '12:00', '14:00'],
      ['4:00 – 6:00 PM', '16:00', '18:00'], ['6:00 – 8:00 PM', '18:00', '20:00']]
      .forEach((t, i) => run('INSERT INTO time_slots (label, start_time, end_time, capacity, sort_order) VALUES (?, ?, ?, ?, ?)', t[0], t[1], t[2], 20, i));

    /* ---- Coupons ---- */
    run("INSERT INTO coupons (code, description, type, value, min_order, max_discount) VALUES ('FIRST20', '20% off your first order (up to ₹200)', 'percent', 20, 299, 200)");
    run("INSERT INTO coupons (code, description, type, value, min_order) VALUES ('FRESH100', 'Flat ₹100 off on orders above ₹999', 'flat', 100, 999)");

    /* ---- Testimonials ---- */
    [
      ['Ananya Kapoor', 'Architect, Vasant Kunj', 'My silk sarees came back looking better than the day I bought them. The tissue-folding is such a lovely touch.'],
      ['Rohan Mehta', 'Founder, Gurugram', 'I haven’t done laundry in eight months. Pickup is always on time and the tracking is spot on. Worth every rupee.'],
      ['Dr. Sana Iqbal', 'Paediatrician, Noida', 'With two toddlers, the separate-load promise matters to me. Gentle detergents, zero rashes, zero stress.'],
      ['Karan & Meera', 'Newlyweds, Saket', 'They restored my sherwani and her lehenga after the wedding — stains we thought were permanent, just gone.'],
      ['Vikram Singh', 'Consultant, CP', 'Shirts on hangers, collars crisp, every single week. It feels like having a personal valet.'],
    ].forEach((t, i) => run('INSERT INTO testimonials (name, role, content, rating, sort_order) VALUES (?, ?, ?, 5, ?)', t[0], t[1], t[2], i));

    /* ---- FAQs ---- */
    [
      ['How does pickup and delivery work?', 'Book a slot online or on WhatsApp. Our valet arrives in that window, tags your clothes in front of you and hands over a digital receipt. We deliver back in your chosen slot.', 'Orders'],
      ['How do you charge for Wash & Fold?', 'Wash & Fold and Wash & Iron are priced per kilogram. We weigh your bag at pickup and share the exact amount before cleaning starts.', 'Pricing'],
      ['What if a garment gets damaged?', 'It is rare, but if it happens we cover up to 10× the cleaning cost of that item. Pre-existing damage is photographed at pickup so there are no surprises.', 'Care'],
      ['Are my clothes washed with others’ clothes?', 'Never. Every order is washed in its own load and tracked with barcoded tags from start to finish.', 'Care'],
      ['Is there a minimum order?', 'Yes — the minimum order is ₹199. Pickup & delivery is free above ₹499.', 'Pricing'],
      ['Do you offer express service?', 'Yes. Choose Express at checkout and we will deliver within 24 hours for a small surcharge.', 'Orders'],
      ['How can I pay?', 'Cash, UPI or card at the time of delivery. Corporate customers can opt for monthly billing.', 'Payments'],
    ].forEach((f, i) => run('INSERT INTO faqs (question, answer, category, sort_order) VALUES (?, ?, ?, ?)', f[0], f[1], f[2], i));

    /* ---- Blog ---- */
    [
      ['How to read the care label on your clothes', 'how-to-read-care-labels', 'Those tiny tub, triangle and circle symbols tell you everything. Here’s a cheat-sheet you’ll actually remember.', 'Fabric Care'],
      ['5 stains you should never treat with hot water', 'stains-never-hot-water', 'Blood, egg, dairy and two more — heat sets proteins into fibres. What to do instead.', 'Stain Guide'],
      ['Storing wedding wear: a 6-step guide', 'storing-wedding-wear', 'Zari, sequins and silk need room to breathe. How to keep heirloom pieces looking new for decades.', 'Ethnic Wear'],
    ].forEach((p, i) => run(`INSERT INTO posts (title, slug, excerpt, category, author, content, published_at) VALUES (?, ?, ?, ?, 'Tag & Fold Team', ?, date('now', ?))`,
      p[0], p[1], p[2], p[3], `<p>${p[2]}</p><h2>Start with the basics</h2><p>Every garment comes with instructions sewn right into it. The <strong>wash tub</strong> tells you the water temperature, the <strong>triangle</strong> is about bleach, the <strong>square</strong> is drying, the <strong>iron</strong> is pressing and the <strong>circle</strong> means professional cleaning.</p><blockquote>When in doubt, cold water and a gentle cycle will rarely ruin anything.</blockquote><h2>Our rule of thumb</h2><ul><li>Separate darks, lights and delicates.</li><li>Turn printed clothes inside out.</li><li>Never tumble dry wool or silk.</li></ul><p>Or, simply hand it to us — we read every label so you don’t have to.</p>`, `-${i * 9} days`));

    /* ---- CMS pages ---- */
    run(`INSERT INTO pages (title, slug, subtitle, content) VALUES ('Terms & Conditions', 'terms', 'The fine print, written plainly.', ?)`,
      '<h2>1. Orders</h2><p>All orders are subject to availability of pickup slots in your area. Final pricing for weight-based services is confirmed after weighing.</p><h2>2. Liability</h2><p>Our liability for any damaged or lost garment is limited to 10 times the cleaning charge of that garment.</p><h2>3. Unclaimed garments</h2><p>Garments unclaimed for 30 days after the delivery attempt may be donated.</p>');
    run(`INSERT INTO pages (title, slug, subtitle, content) VALUES ('Privacy Policy', 'privacy', 'How we handle your information.', ?)`,
      '<p>We collect only the information needed to pick up, clean and deliver your order — your name, phone, email and address. We never sell your data.</p><h2>Cookies</h2><p>We use essential cookies to keep you signed in.</p>');
    run(`INSERT INTO pages (title, slug, subtitle, content) VALUES ('Corporate & Bulk Laundry', 'corporate', 'For hotels, salons, gyms and offices.', ?)`,
      '<p>We handle linen and uniforms for 40+ businesses across NCR. Dedicated account manager, monthly billing and guaranteed daily pickup windows.</p><ul><li>Hotels & Airbnbs</li><li>Salons & spas</li><li>Gyms & studios</li><li>Restaurants & cafés</li></ul><p><a href="/contact">Talk to our business team →</a></p>');

    /* ---- Team ---- */
    [['Aditi Sharma', 'Founder & CEO'], ['Imran Khan', 'Head of Operations'], ['Priya Nair', 'Fabric Care Specialist'], ['Rahul Verma', 'Customer Happiness']]
      .forEach((m, i) => run('INSERT INTO team_members (name, role, sort_order) VALUES (?, ?, ?)', m[0], m[1], i));

    /* ---- Menus ---- */
    [
      ['header', 'Services', '/services'], ['header', 'Pricing', '/pricing'], ['header', 'How it works', '/#process'],
      ['header', 'About', '/about'], ['header', 'Journal', '/blog'], ['header', 'Contact', '/contact'],
      ['footer_company', 'About us', '/about'], ['footer_company', 'Journal', '/blog'], ['footer_company', 'Corporate laundry', '/corporate'], ['footer_company', 'Contact', '/contact'],
      ['footer_help', 'Track order', '/track'], ['footer_help', 'FAQs', '/faq'], ['footer_help', 'Service areas', '/areas'], ['footer_help', 'Terms', '/terms'], ['footer_help', 'Privacy', '/privacy'],
    ].forEach((m, i) => run('INSERT INTO menu_items (location, label, url, sort_order) VALUES (?, ?, ?, ?)', m[0], m[1], m[2], i));

    /* ---- Demo customers & orders (so the dashboard isn't empty) ---- */
    const custs = [
      ['Neha Gupta', '9811000001', 'neha@example.com', 'C-12, Green Park Extn', '110016'],
      ['Arjun Malhotra', '9811000002', 'arjun@example.com', 'Flat 402, DLF Phase 2', '122002'],
      ['Ishita Roy', '9811000003', 'ishita@example.com', 'B-7, Sector 50', '201301'],
      ['Sameer Khan', '9811000004', 'sameer@example.com', '22 Hauz Khas Village', '110016'],
    ];
    custs.forEach((c) => run('INSERT INTO customers (name, phone, email, address, pincode, password_hash) VALUES (?, ?, ?, ?, ?, ?)', c[0], c[1], c[2], c[3], c[4], bcrypt.hashSync('customer123', 10)));

    const flow = ['pending', 'confirmed', 'picked_up', 'processing', 'ready', 'out_for_delivery', 'delivered'];
    const priced = all('SELECT ip.item_id, ip.service_id, ip.price, i.name, i.unit, s.title FROM item_prices ip JOIN items i ON i.id = ip.item_id JOIN services s ON s.id = ip.service_id');
    for (let n = 0; n < 18; n++) {
      const c = custs[n % custs.length];
      const cust = get('SELECT id FROM customers WHERE phone = ?', c[1]);
      const daysAgo = Math.floor(n * 1.6);
      const stage = n < 3 ? n : n < 5 ? 3 + (n % 3) : 6;
      const status = n === 7 ? 'cancelled' : flow[stage];
      const lines_ = [];
      for (let k = 0; k < 2 + (n % 3); k++) {
        const p = priced[(n * 7 + k * 5) % priced.length];
        const qty = 1 + ((n + k) % 3);
        lines_.push([p.service_id, p.title, p.item_id, p.name, p.unit, qty, p.price, p.price * qty]);
      }
      if (n % 2 === 0) lines_.push([sid['wash-and-fold'], 'Wash & Fold', null, 'Wash & Fold (by weight)', 'kg', 4 + (n % 4), 89, 89 * (4 + (n % 4))]);
      const subtotal = lines_.reduce((a, l) => a + l[7], 0);
      const delivery = subtotal >= 499 ? 0 : 49;
      const tax = Math.round((subtotal + delivery) * 0.18 * 100) / 100;
      const total = subtotal + delivery + tax;
      const created = `datetime('now', '-${daysAgo} days', '-${(n * 37) % 600} minutes')`;
      const r = run(`INSERT INTO orders (order_no, customer_id, name, phone, email, address, pincode, pickup_date, pickup_slot, delivery_date, services, subtotal, delivery_fee, tax, total, status, payment_method, payment_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, date('now', '-${daysAgo} days', '+1 day'), '10:00 AM – 12:00 PM', date('now', '-${daysAgo} days', '+3 days'), ?, ?, ?, ?, ?, ?, 'cod', ?, ${created}, ${created})`,
      `TF-${2041 + n}`, cust.id, c[0], c[1], c[2], c[3], c[4], [...new Set(lines_.map((l) => l[1]))].join(', '), subtotal, delivery, tax, total, status, status === 'delivered' ? 'paid' : 'unpaid');
      const oid = Number(r.lastInsertRowid);
      for (const l of lines_) run('INSERT INTO order_items (order_id, service_id, service_title, item_id, item_name, unit, qty, unit_price, line_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', oid, ...l);
      const upto = status === 'cancelled' ? 1 : flow.indexOf(status);
      for (let k = 0; k <= upto; k++) run(`INSERT INTO order_history (order_id, status, note, created_at) VALUES (?, ?, ?, datetime('now', '-${daysAgo} days', '+${k * 6} hours'))`, oid, flow[k], k === 0 ? 'Order placed on website' : null);
      if (status === 'cancelled') run(`INSERT INTO order_history (order_id, status, note, created_at) VALUES (?, 'cancelled', 'Customer requested cancellation', datetime('now', '-${daysAgo} days', '+8 hours'))`, oid);
    }

    run("INSERT INTO messages (name, email, phone, subject, message) VALUES ('Pooja Arora', 'pooja@example.com', '9822000001', 'Bulk order for a boutique', 'Hi, we run a boutique in Khan Market and need weekly steam pressing for ~150 garments. Can you share a quote?')");
    run("INSERT INTO subscribers (email) VALUES ('hello@example.com')");
  });
}

if (require.main === module) {
  ensureSeeded(process.argv.includes('--reset'));
  console.log('Database seeded.');
}

module.exports = { ensureSeeded, seed };
