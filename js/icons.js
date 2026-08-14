// ============================================================
// NOKT HUB — Pustaka ikon kategori (dipakai bareng oleh
// js/categories.js untuk menampilkan chip, dan js/admin.js untuk
// pemilih ikon manual di panel admin).
//
// Prioritas pemilihan ikon untuk 1 kategori (lihat resolveCategoryIcon):
//   1. Ikon MANUAL yang dipilih admin (field `icon` di dokumen
//      Firestore categories/{slug}) -- termasuk pilihan "none" (Tanpa
//      Ikon), yang membuat kategori itu tampil teks polos meski
//      kategori lain masih pakai ikon.
//   2. Kalau belum diisi manual: dicocokkan OTOMATIS dari kata kunci
//      yang ada di nama kategori.
//   3. Kalau kata kunci juga tidak ada yang cocok: fallback ke ikon
//      berdasarkan HASH nama kategori (stabil, tidak goyah).
//
// Selain itu, ada saklar GLOBAL terpisah (field `hideCategoryIcons` di
// settings/site, diatur lewat admin -> Pengaturan) yang kalau aktif
// akan mematikan SEMUA ikon di SEMUA kategori sekaligus (termasuk
// "Semua"), apapun pilihan manual per kategori -- lihat categories.js.
// ============================================================

// ---------- Daftar ikon (id -> path SVG) ----------
export const ICON_LIBRARY = {
  none:     { label: "Tanpa Ikon (kategori ini saja)", svg: "" },
  globe:    { label: "Semua/Umum",     svg: `<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>` },
  football: { label: "Olahraga",       svg: `<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18M6 6l12 12M18 6 6 18"/>` },
  sparkle:  { label: "Kecantikan",     svg: `<path d="M12 3v3M12 18v3M5 12H2M22 12h-3M6.3 6.3 4.2 4.2M19.8 19.8l-2.1-2.1M6.3 17.7l-2.1 2.1M19.8 4.2l-2.1 2.1"/><circle cx="12" cy="12" r="4"/>` },
  music:    { label: "Musik",          svg: `<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>` },
  gamepad:  { label: "Game",           svg: `<path d="M6 12h4m-2-2v4M17.5 12h.01M15 10h.01"/><path d="M17.32 5H6.68a4 4 0 0 0-3.98 3.6l-.9 9A2 2 0 0 0 3.79 20a2.5 2.5 0 0 0 2.2-1.3l.7-1.4a2 2 0 0 1 1.8-1.1h7.02a2 2 0 0 1 1.8 1.1l.7 1.4a2.5 2.5 0 0 0 2.2 1.3 2 2 0 0 0 1.99-2.4l-.9-9A4 4 0 0 0 17.32 5Z"/>` },
  camera:   { label: "Vlog",           svg: `<rect x="2" y="6" width="14" height="12" rx="2"/><path d="M22 8.5v7l-6-3.5 6-3.5Z"/>` },
  smile:    { label: "Komedi",         svg: `<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>` },
  trending: { label: "Trending",       svg: `<path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/>` },
  heart:    { label: "Romantis",       svg: `<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"/>` },
  book:     { label: "Edukasi",        svg: `<path d="M2 3h20v14H2z"/><path d="M8 21h8M12 17v4"/>` },
  megaphone:{ label: "Berita",         svg: `<path d="M3 11 18 5v14L3 13"/><path d="M11 13v6a2 2 0 0 1-4 0v-5"/>` },
  food:     { label: "Kuliner",        svg: `<path d="M3 2v7c0 1.1.9 2 2 2s2-.9 2-2V2M5 11v11M15 2c-1.7 0-3 2.7-3 6s1.3 6 3 6v9"/>` },
  compass:  { label: "Travel",         svg: `<circle cx="12" cy="12" r="9"/><path d="m14.5 9.5-1.8 5.2-5.2 1.8 1.8-5.2z"/>` },
  bolt:     { label: "Aksi/Umum",      svg: `<path d="M13 2 3 14h8l-1 8 10-12h-8l1-8Z"/>` },
  film:     { label: "Film/Umum",      svg: `<path d="M2 3h20v14H2z"/><path d="M8 21h8M12 17v4M2 8h20M7 3v5M17 3v5"/>` },
  ghost:    { label: "Horror",         svg: `<path d="M9 10h.01M15 10h.01"/><path d="M12 3a7 7 0 0 0-7 7v9l2.5-2 2.5 2 2-2 2 2 2.5-2 2.5 2v-9a7 7 0 0 0-7-7Z"/>` },
  rocket:   { label: "Sci-Fi",         svg: `<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09Z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2Z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>` },
  baby:     { label: "Anak-anak",      svg: `<circle cx="12" cy="8" r="4"/><path d="M6 21v-2a6 6 0 0 1 12 0v2"/>` },
  crown:    { label: "Premium/Eksklusif", svg: `<path d="m2 20 2-10 5 4 3-7 3 7 5-4 2 10Z"/>` },
  live:     { label: "Live/Siaran",    svg: `<circle cx="12" cy="12" r="3"/><path d="M7 8.5a6.5 6.5 0 0 0 0 7M17 8.5a6.5 6.5 0 0 1 0 7M4 5a11 11 0 0 0 0 14M20 5a11 11 0 0 1 0 14"/>` },
  tool:     { label: "DIY/Tutorial Kerja", svg: `<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>` },
  shirt:    { label: "Fashion",        svg: `<path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23Z"/>` },
  cpu:      { label: "Teknologi",      svg: `<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/>` },
  drama:    { label: "Drama",          svg: `<path d="M12 3v18M3 12h18M6.3 6.3l11.4 11.4M17.7 6.3 6.3 17.7"/><circle cx="12" cy="12" r="9"/>` },
};

const ICON_IDS = Object.keys(ICON_LIBRARY);

// ---------- Pencocokan kata kunci otomatis (langkah 2) ----------
const KEYWORD_MAP = [
  { icon: "football",  match: ["bola", "sport", "olahraga", "futsal", "basket"] },
  { icon: "sparkle",   match: ["cantik", "kecantikan", "beauty", "makeup", "skincare"] },
  { icon: "music",     match: ["musik", "music", "lagu", "song"] },
  { icon: "gamepad",   match: ["game", "gaming", "play", "main"] },
  { icon: "camera",    match: ["vlog", "vlogger", "daily", "keseharian"] },
  { icon: "smile",     match: ["komedi", "lucu", "funny", "comedy", "meme"] },
  { icon: "trending",  match: ["trending", "viral", "populer", "hot"] },
  { icon: "heart",     match: ["romantis", "cinta", "love", "couple", "pacar"] },
  { icon: "book",      match: ["edukasi", "tutorial", "belajar", "education", "sekolah"] },
  { icon: "megaphone", match: ["berita", "news", "info", "informasi"] },
  { icon: "food",      match: ["masak", "kuliner", "makan", "food", "resep"] },
  { icon: "compass",   match: ["travel", "wisata", "jalan", "liburan"] },
  { icon: "ghost",     match: ["horror", "horor", "seram", "hantu"] },
  { icon: "rocket",    match: ["scifi", "sci-fi", "luar angkasa", "space", "fiksi ilmiah"] },
  { icon: "baby",      match: ["anak", "kids", "balita", "parenting"] },
  { icon: "crown",     match: ["premium", "eksklusif", "vip", "exclusive"] },
  { icon: "live",      match: ["live", "siaran", "langsung"] },
  { icon: "tool",      match: ["diy", "kerajinan", "renovasi", "perbaikan"] },
  { icon: "shirt",     match: ["fashion", "outfit", "baju", "style"] },
  { icon: "cpu",       match: ["teknologi", "tech", "gadget", "komputer"] },
  { icon: "drama",     match: ["drama", "sinetron", "series", "serial"] },
];

function matchKeywordIcon(name) {
  const lower = (name || "").toLowerCase();
  const found = KEYWORD_MAP.find(entry => entry.match.some(k => lower.includes(k)));
  return found ? found.icon : null;
}

// ---------- Hash fallback (langkah 3) ----------
function hashIcon(name) {
  const str = name || "";
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  const neutralIds = ["globe", "bolt", "film"];
  return neutralIds[hash % neutralIds.length];
}

// ---------- Fungsi utama: resolve ikon final untuk 1 kategori ----------
export function resolveCategoryIcon(cat) {
  // "none" TERMASUK pilihan manual yang sah -- kalau admin sengaja
  // pilih "Tanpa Ikon" untuk kategori ini, itu dihormati juga (beda
  // dari cat.icon kosong/undefined yang berarti "belum diatur sama
  // sekali", makanya dicek eksplisit di sini, bukan cuma `if (cat.icon)`).
  if (cat && (cat.icon === "none" || (cat.icon && ICON_LIBRARY[cat.icon]))) {
    return cat.icon;
  }
  const keywordMatch = matchKeywordIcon(cat?.name);
  if (keywordMatch) return keywordMatch;
  return hashIcon(cat?.name || cat?.slug || "");
}

export function iconSvg(iconId) {
  if (iconId === "none") return "";
  const entry = ICON_LIBRARY[iconId] || ICON_LIBRARY.globe;
  if (!entry.svg) return "";
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${entry.svg}</svg>`;
}

export function allIconIds() {
  return ICON_IDS;
}

// ---------- Saklar global: matikan SEMUA ikon di seluruh web ----------
// Dibaca dari cache localStorage "nokt_settings_cache" (yang sudah
// dipelihara oleh js/app.js di semua halaman untuk keperluan anti-flash
// nama/warna situs) -- jadi TIDAK perlu Firestore read tambahan khusus
// untuk ini, cukup numpang di cache yang sudah ada.
export function areIconsGloballyHidden() {
  try {
    const cached = JSON.parse(localStorage.getItem("nokt_settings_cache") || "null");
    return !!(cached && cached.hideCategoryIcons);
  } catch (e) {
    return false;
  }
}
