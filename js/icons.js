// ============================================================
// NOKT HUB — Pustaka ikon kategori (dipakai bareng oleh
// js/categories.js untuk menampilkan chip, dan js/admin.js untuk
// pemilih ikon manual di panel admin).
//
// Prioritas pemilihan ikon untuk 1 kategori (lihat resolveCategoryIcon):
//   1. Ikon MANUAL yang dipilih admin (field `icon` di dokumen
//      Firestore categories/{slug}) -- kalau ada, ini selalu menang.
//   2. Kalau belum diisi manual: dicocokkan OTOMATIS dari kata kunci
//      yang ada di nama kategori.
//   3. Kalau kata kunci juga tidak ada yang cocok: fallback ke ikon
//      berdasarkan HASH nama kategori -- bukan "urutan ke berapa di
//      database" (supaya tidak goyah / ikut berubah kalau kategori lain
//      ditambah/dihapus), tapi tetap konsisten untuk kategori yang sama.
// ============================================================

// ---------- Daftar ikon (id -> path SVG) ----------
// id di sini yang disimpan sebagai field `icon` kategori di Firestore,
// dan yang dipilih admin lewat dropdown/galeri ikon di panel admin.
export const ICON_LIBRARY = {
  globe:    { label: "Semua/Umum",   svg: `<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>` },
  football: { label: "Olahraga",     svg: `<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18M6 6l12 12M18 6 6 18"/>` },
  sparkle:  { label: "Kecantikan",   svg: `<path d="M12 3v3M12 18v3M5 12H2M22 12h-3M6.3 6.3 4.2 4.2M19.8 19.8l-2.1-2.1M6.3 17.7l-2.1 2.1M19.8 4.2l-2.1 2.1"/><circle cx="12" cy="12" r="4"/>` },
  music:    { label: "Musik",        svg: `<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>` },
  gamepad:  { label: "Game",         svg: `<path d="M6 12h4m-2-2v4M17.5 12h.01M15 10h.01"/><path d="M17.32 5H6.68a4 4 0 0 0-3.98 3.6l-.9 9A2 2 0 0 0 3.79 20a2.5 2.5 0 0 0 2.2-1.3l.7-1.4a2 2 0 0 1 1.8-1.1h7.02a2 2 0 0 1 1.8 1.1l.7 1.4a2.5 2.5 0 0 0 2.2 1.3 2 2 0 0 0 1.99-2.4l-.9-9A4 4 0 0 0 17.32 5Z"/>` },
  camera:   { label: "Vlog",         svg: `<rect x="2" y="6" width="14" height="12" rx="2"/><path d="M22 8.5v7l-6-3.5 6-3.5Z"/>` },
  smile:    { label: "Komedi",       svg: `<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>` },
  trending: { label: "Trending",     svg: `<path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/>` },
  heart:    { label: "Romantis",     svg: `<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"/>` },
  book:     { label: "Edukasi",      svg: `<path d="M2 3h20v14H2z"/><path d="M8 21h8M12 17v4"/>` },
  megaphone:{ label: "Berita",       svg: `<path d="M3 11 18 5v14L3 13"/><path d="M11 13v6a2 2 0 0 1-4 0v-5"/>` },
  food:     { label: "Kuliner",      svg: `<path d="M3 2v7c0 1.1.9 2 2 2s2-.9 2-2V2M5 11v11M15 2c-1.7 0-3 2.7-3 6s1.3 6 3 6v9"/>` },
  compass:  { label: "Travel",       svg: `<circle cx="12" cy="12" r="9"/><path d="m14.5 9.5-1.8 5.2-5.2 1.8 1.8-5.2z"/>` },
  bolt:     { label: "Aksi/Umum",    svg: `<path d="M13 2 3 14h8l-1 8 10-12h-8l1-8Z"/>` },
  film:     { label: "Film/Umum",    svg: `<path d="M2 3h20v14H2z"/><path d="M8 21h8M12 17v4M2 8h20M7 3v5M17 3v5"/>` },
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
];

function matchKeywordIcon(name) {
  const lower = (name || "").toLowerCase();
  const found = KEYWORD_MAP.find(entry => entry.match.some(k => lower.includes(k)));
  return found ? found.icon : null;
}

// ---------- Hash fallback (langkah 3) ----------
// Ikon dipilih dari "sidik jari" nama kategori sendiri -- bukan urutan di
// database -- supaya SELALU sama untuk nama yang sama, stabil walau
// kategori lain berubah.
function hashIcon(name) {
  const str = name || "";
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  // Dikecualikan dari kandidat hash: ikon yang sudah dipakai spesifik
  // untuk keyword (biar fallback terasa "netral", tidak kebetulan sama
  // persis dengan makna ikon keyword tertentu).
  const neutralIds = ["globe", "bolt", "film"];
  return neutralIds[hash % neutralIds.length];
}

// ---------- Fungsi utama: resolve ikon final untuk 1 kategori ----------
// cat = { name, slug, icon? } -- `icon` adalah field opsional hasil
// pilihan manual admin (id dari ICON_LIBRARY).
export function resolveCategoryIcon(cat) {
  if (cat?.icon && ICON_LIBRARY[cat.icon]) return cat.icon;
  const keywordMatch = matchKeywordIcon(cat?.name);
  if (keywordMatch) return keywordMatch;
  return hashIcon(cat?.name || cat?.slug || "");
}

export function iconSvg(iconId) {
  const entry = ICON_LIBRARY[iconId] || ICON_LIBRARY.globe;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${entry.svg}</svg>`;
}

export function allIconIds() {
  return ICON_IDS;
}
