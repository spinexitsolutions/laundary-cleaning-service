const { all, run } = require('./db');

/*
 * Every editable site-wide value lives here. The admin "Settings" and
 * "Homepage" screens are generated from these groups, so adding a field
 * here is all it takes to make something editable from the panel.
 */
const GROUPS = [
  {
    key: 'general', title: 'General', icon: 'settings', screen: 'settings',
    fields: [
      { name: 'site_name', label: 'Business name', type: 'text', default: 'Tag & Fold' },
      { name: 'site_tagline', label: 'Tagline', type: 'text', default: 'Laundry Atelier' },
      { name: 'logo', label: 'Logo (optional — replaces the text wordmark)', type: 'image', default: '' },
      { name: 'favicon', label: 'Favicon', type: 'image', default: '' },
      { name: 'currency', label: 'Currency symbol', type: 'text', default: '₹' },
      { name: 'announcement', label: 'Top announcement bar (leave empty to hide)', type: 'text', default: 'Flat 20% off your first pickup — use code FIRST20' },
      { name: 'announcement_link', label: 'Announcement link', type: 'text', default: '/book' },
    ],
  },
  {
    key: 'branding', title: 'Branding & Colours', icon: 'palette', screen: 'settings',
    fields: [
      { name: 'color_primary', label: 'Primary colour', type: 'color', default: '#2B44E0' },
      { name: 'color_accent', label: 'Accent colour', type: 'color', default: '#FF6A3D' },
      { name: 'color_ink', label: 'Ink (dark) colour', type: 'color', default: '#111827' },
      { name: 'color_paper', label: 'Paper (background) colour', type: 'color', default: '#F4F0E8' },
    ],
  },
  {
    key: 'contact', title: 'Contact Details', icon: 'phone', screen: 'settings',
    fields: [
      { name: 'phone', label: 'Phone', type: 'text', default: '+91 98765 43210' },
      { name: 'whatsapp', label: 'WhatsApp number (digits with country code)', type: 'text', default: '919876543210' },
      { name: 'email', label: 'Email', type: 'text', default: 'hello@tagandfold.in' },
      { name: 'address', label: 'Address', type: 'textarea', default: 'Shop 4, Green Park Market,\nNew Delhi 110016' },
      { name: 'hours', label: 'Working hours', type: 'text', default: 'Mon – Sun · 8:00 AM – 9:00 PM' },
      { name: 'map_embed', label: 'Google Maps embed URL', type: 'text', default: 'https://www.google.com/maps?q=Green+Park+New+Delhi&output=embed' },
      { name: 'show_whatsapp_button', label: 'Show floating WhatsApp button', type: 'checkbox', default: '1' },
    ],
  },
  {
    key: 'social', title: 'Social Links', icon: 'share', screen: 'settings',
    fields: [
      { name: 'social_instagram', label: 'Instagram URL', type: 'text', default: 'https://instagram.com' },
      { name: 'social_facebook', label: 'Facebook URL', type: 'text', default: 'https://facebook.com' },
      { name: 'social_x', label: 'X / Twitter URL', type: 'text', default: '' },
      { name: 'social_youtube', label: 'YouTube URL', type: 'text', default: '' },
      { name: 'social_linkedin', label: 'LinkedIn URL', type: 'text', default: '' },
    ],
  },
  {
    key: 'booking', title: 'Booking & Charges', icon: 'receipt', screen: 'settings',
    fields: [
      { name: 'booking_enabled', label: 'Accept online bookings', type: 'checkbox', default: '1' },
      { name: 'min_order', label: 'Minimum order value', type: 'number', default: '199' },
      { name: 'delivery_fee', label: 'Default pickup & delivery fee', type: 'number', default: '49' },
      { name: 'free_delivery_above', label: 'Free pickup & delivery above (0 = never)', type: 'number', default: '499' },
      { name: 'express_fee', label: 'Express (24h) surcharge', type: 'number', default: '99' },
      { name: 'standard_days', label: 'Standard turnaround (days)', type: 'number', default: '2' },
      { name: 'tax_percent', label: 'Tax / GST %', type: 'number', default: '18' },
      { name: 'tax_label', label: 'Tax label', type: 'text', default: 'GST' },
      { name: 'booking_days_ahead', label: 'Pickup can be booked up to (days ahead)', type: 'number', default: '10' },
      { name: 'restrict_pincodes', label: 'Only accept pincodes listed in Service Areas', type: 'checkbox', default: '1' },
      { name: 'payment_methods', label: 'Payment methods (one per line: code|Label)', type: 'textarea', default: 'cod|Cash on delivery\nupi|UPI on delivery\ncard|Card on delivery' },
      { name: 'order_prefix', label: 'Order number prefix', type: 'text', default: 'TF' },
      { name: 'invoice_note', label: 'Invoice footer note', type: 'textarea', default: 'Thank you for trusting us with your wardrobe. Garments unclaimed for 30 days may be donated.' },
      { name: 'gstin', label: 'GSTIN (printed on invoice)', type: 'text', default: '07ABCDE1234F1Z5' },
    ],
  },
  {
    key: 'seo', title: 'SEO & Scripts', icon: 'search', screen: 'settings',
    fields: [
      { name: 'meta_title', label: 'Default meta title', type: 'text', default: 'Tag & Fold — Doorstep Laundry & Dry Cleaning' },
      { name: 'meta_desc', label: 'Default meta description', type: 'textarea', default: 'Free doorstep pickup, expert washing, dry cleaning, steam ironing and shoe care. Fresh, folded and delivered back in 48 hours.' },
      { name: 'og_image', label: 'Social share image', type: 'image', default: '' },
      { name: 'head_scripts', label: 'Extra code in <head> (analytics etc.)', type: 'code', default: '' },
    ],
  },
  {
    key: 'footer', title: 'Footer', icon: 'layout', screen: 'settings',
    fields: [
      { name: 'footer_about', label: 'Footer about text', type: 'textarea', default: 'A modern laundry atelier. We pick up, we clean with care, we bring it back folded — so your weekends stay yours.' },
      { name: 'footer_copyright', label: 'Copyright line', type: 'text', default: '© {year} Tag & Fold Laundry Pvt. Ltd. All rights reserved.' },
      { name: 'newsletter_title', label: 'Newsletter heading', type: 'text', default: 'Fresh offers, folded into your inbox.' },
    ],
  },

  /* ---------------- Homepage content ---------------- */
  {
    key: 'home_hero', title: 'Hero', icon: 'star', screen: 'homepage',
    fields: [
      { name: 'hero_eyebrow', label: 'Small label above heading', type: 'text', default: 'Doorstep laundry · Since 2016' },
      { name: 'hero_title', label: 'Heading (*stars* = accent style, | = line break)', type: 'text', default: 'Clean clothes, *zero* chores.' },
      { name: 'hero_subtitle', label: 'Sub heading', type: 'textarea', default: 'We pick up from your door, wash with care, steam-press and deliver back folded — in as little as 24 hours.' },
      { name: 'hero_cta_label', label: 'Primary button label', type: 'text', default: 'Schedule a free pickup' },
      { name: 'hero_cta_link', label: 'Primary button link', type: 'text', default: '/book' },
      { name: 'hero_cta2_label', label: 'Secondary button label', type: 'text', default: 'See prices' },
      { name: 'hero_cta2_link', label: 'Secondary button link', type: 'text', default: '/pricing' },
      { name: 'hero_image', label: 'Photo inside the washing-machine door (optional)', type: 'image', default: '' },
      { name: 'hero_photo_1', label: 'Floating photo card 1 — top left (optional, replaces the shirt illustration)', type: 'image', default: '' },
      { name: 'hero_photo_1_caption', label: 'Photo card 1 caption', type: 'text', default: 'Hand-finished shirts' },
      { name: 'hero_photo_2', label: 'Floating photo card 2 — bottom left (optional, replaces the towel stack)', type: 'image', default: '' },
      { name: 'hero_photo_2_caption', label: 'Photo card 2 caption', type: 'text', default: 'Folded & fresh' },
      { name: 'hero_rating', label: 'Rating badge text', type: 'text', default: '4.9 · 12,400+ reviews' },
      { name: 'hero_ticket_text', label: 'Floating ticket text', type: 'text', default: 'Ready for delivery' },
      { name: 'hero_ring_text', label: 'Rotating badge text', type: 'text', default: 'PICK UP · WASH · DRY · PRESS · FOLD · DELIVER · ' },
    ],
  },
  {
    key: 'home_sections', title: 'Sections on/off', icon: 'layers', screen: 'homepage',
    fields: [
      { name: 'home_show_marquee', label: 'Scrolling care-label strip', type: 'checkbox', default: '1' },
      { name: 'home_show_services', label: 'Services', type: 'checkbox', default: '1' },
      { name: 'home_show_process', label: 'How it works', type: 'checkbox', default: '1' },
      { name: 'home_show_stats', label: 'Numbers / stats', type: 'checkbox', default: '1' },
      { name: 'home_show_pricing', label: 'Price list preview', type: 'checkbox', default: '1' },
      { name: 'home_show_why', label: 'Why choose us', type: 'checkbox', default: '1' },
      { name: 'home_show_testimonials', label: 'Testimonials', type: 'checkbox', default: '1' },
      { name: 'home_show_areas', label: 'Service area checker', type: 'checkbox', default: '1' },
      { name: 'home_show_faq', label: 'FAQ', type: 'checkbox', default: '1' },
      { name: 'home_show_blog', label: 'Latest from the journal', type: 'checkbox', default: '1' },
      { name: 'home_show_cta', label: 'Bottom call-to-action', type: 'checkbox', default: '1' },
    ],
  },
  {
    key: 'home_marquee', title: 'Care-label strip', icon: 'tag', screen: 'homepage',
    fields: [
      { name: 'marquee_items', label: 'Words (one per line)', type: 'textarea', default: 'Wash & Fold\nDry Cleaning\nSteam Ironing\nShoe Spa\nCurtain Care\nCarpet Cleaning\nBridal Wear\nStain Removal' },
    ],
  },
  {
    key: 'home_services', title: 'Services section', icon: 'sparkles', screen: 'homepage',
    fields: [
      { name: 'services_kicker', label: 'Kicker', type: 'text', default: 'What we do' },
      { name: 'services_title', label: 'Heading', type: 'text', default: 'Every fabric, *properly* looked after.' },
      { name: 'services_text', label: 'Intro', type: 'textarea', default: 'From your everyday cottons to a once-in-a-lifetime lehenga — each garment is tagged, treated by fabric type and quality-checked by hand.' },
    ],
  },
  {
    key: 'home_process', title: 'How it works', icon: 'route', screen: 'homepage',
    fields: [
      { name: 'process_kicker', label: 'Kicker', type: 'text', default: 'How it works' },
      { name: 'process_title', label: 'Heading', type: 'text', default: 'Four steps. *You* only do the first.' },
      {
        name: 'process_steps', label: 'Steps', type: 'repeater',
        subfields: [
          { name: 'icon', label: 'Icon', type: 'icon' },
          { name: 'title', label: 'Title', type: 'text' },
          { name: 'text', label: 'Text', type: 'textarea' },
        ],
        default: JSON.stringify([
          { icon: 'calendar', title: 'Book a pickup', text: 'Pick a slot online or on WhatsApp. Takes under a minute.' },
          { icon: 'truck', title: 'We collect', text: 'Our valet arrives on time, tags every garment and hands you a receipt.' },
          { icon: 'washer', title: 'We clean', text: 'Fabric-specific washing, dry cleaning, steam pressing and a hand check.' },
          { icon: 'box', title: 'We deliver', text: 'Fresh, folded or on hangers — back at your door in 24–48 hours.' },
        ]),
      },
    ],
  },
  {
    key: 'home_stats', title: 'Numbers', icon: 'chart', screen: 'homepage',
    fields: [
      {
        name: 'stats', label: 'Stats', type: 'repeater',
        subfields: [
          { name: 'value', label: 'Number', type: 'text' },
          { name: 'suffix', label: 'Suffix', type: 'text' },
          { name: 'label', label: 'Label', type: 'text' },
        ],
        default: JSON.stringify([
          { value: '2.4', suffix: 'M+', label: 'Garments cleaned' },
          { value: '38', suffix: 'k', label: 'Happy households' },
          { value: '48', suffix: 'h', label: 'Standard turnaround' },
          { value: '99.7', suffix: '%', label: 'On-time deliveries' },
        ]),
      },
    ],
  },
  {
    key: 'home_why', title: 'Why choose us', icon: 'shield', screen: 'homepage',
    fields: [
      { name: 'why_kicker', label: 'Kicker', type: 'text', default: 'Why Tag & Fold' },
      { name: 'why_title', label: 'Heading', type: 'text', default: 'The details *other* laundries skip.' },
      { name: 'why_image', label: 'Side image (optional)', type: 'image', default: '' },
      {
        name: 'why_items', label: 'Features', type: 'repeater',
        subfields: [
          { name: 'icon', label: 'Icon', type: 'icon' },
          { name: 'title', label: 'Title', type: 'text' },
          { name: 'text', label: 'Text', type: 'textarea' },
        ],
        default: JSON.stringify([
          { icon: 'leaf', title: 'Eco-friendly detergents', text: 'Plant-based, skin-safe and gentle on colours. No harsh optical brighteners.' },
          { icon: 'tag', title: 'Every garment tagged', text: 'Barcoded tags mean nothing gets mixed up — ever. Track each piece.' },
          { icon: 'shield', title: 'Damage cover', text: 'Up to 10× the cleaning cost covered, no arguments, if we ever slip.' },
          { icon: 'clock', title: 'On-time, every time', text: 'Live order tracking and SMS updates from pickup to delivery.' },
          { icon: 'drop', title: 'Separate washes', text: 'Your clothes are never mixed with anyone else’s load.' },
          { icon: 'iron', title: 'Hand-finished', text: 'Steam pressed, collars shaped, folded with tissue for silk & wool.' },
        ]),
      },
    ],
  },
  {
    key: 'home_misc', title: 'Other sections', icon: 'edit', screen: 'homepage',
    fields: [
      { name: 'pricing_kicker', label: 'Pricing kicker', type: 'text', default: 'Honest pricing' },
      { name: 'pricing_title', label: 'Pricing heading', type: 'text', default: 'Know the price *before* we pick up.' },
      { name: 'testimonials_kicker', label: 'Testimonials kicker', type: 'text', default: 'Kind words' },
      { name: 'testimonials_title', label: 'Testimonials heading', type: 'text', default: 'Loved by *very* particular people.' },
      { name: 'areas_kicker', label: 'Service areas kicker', type: 'text', default: 'Where we deliver' },
      { name: 'areas_title', label: 'Service areas heading', type: 'text', default: 'Do we pick up *near you?*' },
      { name: 'faq_kicker', label: 'FAQ kicker', type: 'text', default: 'Questions' },
      { name: 'faq_title', label: 'FAQ heading', type: 'text', default: 'Good to *know*.' },
      { name: 'blog_kicker', label: 'Blog kicker', type: 'text', default: 'The Journal' },
      { name: 'blog_title', label: 'Blog heading', type: 'text', default: 'Fabric care, *decoded*.' },
      { name: 'cta_title', label: 'Bottom CTA heading', type: 'text', default: 'Your laundry day just got *cancelled*.' },
      { name: 'cta_text', label: 'Bottom CTA text', type: 'textarea', default: 'First pickup is on us. Book in 60 seconds and get 20% off with code FIRST20.' },
      { name: 'cta_button', label: 'Bottom CTA button', type: 'text', default: 'Book my pickup' },
    ],
  },
  {
    key: 'about_page', title: 'About page', icon: 'info', screen: 'homepage',
    fields: [
      { name: 'about_title', label: 'Heading', type: 'text', default: 'A laundry, *re-thought* from the hanger up.' },
      { name: 'about_intro', label: 'Intro', type: 'textarea', default: 'Tag & Fold started in 2016 with one machine, one scooter and a simple belief: people deserve their time back, and clothes deserve better than a rushed wash.' },
      { name: 'about_body', label: 'Story', type: 'richtext', default: '<p>Today we run a 12,000 sq.ft. facility with industrial-grade washers, eco dry-cleaning solvents and a team of 60 garment specialists. But the idea is the same: treat every piece as if it were our own.</p><p>Each item is tagged on arrival, sorted by fabric and colour, cleaned with the right process, inspected by hand and packed with care. You can track every step from your phone.</p>' },
      { name: 'about_image', label: 'Image (optional)', type: 'image', default: '' },
      {
        name: 'about_values', label: 'Values', type: 'repeater',
        subfields: [
          { name: 'title', label: 'Title', type: 'text' },
          { name: 'text', label: 'Text', type: 'textarea' },
        ],
        default: JSON.stringify([
          { title: 'Care over speed', text: 'Fast is good. Right is better. We never skip a step to hit a deadline.' },
          { title: 'Radically transparent', text: 'Fixed prices, itemised bills and photos of any pre-existing damage.' },
          { title: 'Kind to the planet', text: 'Water recycling, biodegradable detergents and reusable garment bags.' },
        ]),
      },
    ],
  },
];

const FIELD_INDEX = {};
for (const g of GROUPS) for (const f of g.fields) FIELD_INDEX[f.name] = f;

let cache = null;

function load() {
  const rows = all('SELECT key, value FROM settings');
  const s = {};
  for (const f of Object.values(FIELD_INDEX)) s[f.name] = f.default ?? '';
  for (const r of rows) s[r.key] = r.value;
  // Parse repeaters into arrays for templates.
  for (const f of Object.values(FIELD_INDEX)) {
    if (f.type === 'repeater') {
      try { s[f.name] = JSON.parse(s[f.name] || '[]'); } catch { s[f.name] = []; }
    }
  }
  cache = s;
  return s;
}

function getSettings() {
  return cache || load();
}

function saveSettings(values) {
  const stmt = 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value';
  for (const [k, v] of Object.entries(values)) run(stmt, k, v == null ? '' : String(v));
  cache = null;
}

module.exports = { GROUPS, FIELD_INDEX, getSettings, saveSettings };
