// ============================================================
// NOKT HUB — Kategori dinamis (versi chip-row scroll horizontal)
// Kategori TIDAK dibuat manual: otomatis muncul saat admin
// mengupload video dengan kategori baru (lihat admin.js: upsertCategory).
// ============================================================
import { db, collection, getDocs, orderBy, query } from "./firebase-config.js";

// Sekumpulan ikon garis generik yang di-cycle otomatis untuk tiap
// kategori (karena data kategori di Firestore cuma { name, slug,
// videoCount } -- tidak ada field ikon per kategori). Ikon "Semua"
// dikecualikan, selalu pakai ikon globe di bawah.
const CHIP_ICONS = [
  // play/film
  `<path d="M2 3h20v14H2z"/><path d="M8 21h8M12 17v4"/>`,
  // musik
  `<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>`,
  // gamepad
  `<path d="M6 12h4m-2-2v4M17.5 12h.01M15 10h.01"/><path d="M17.32 5H6.68a4 4 0 0 0-3.98 3.6l-.9 9A2 2 0 0 0 3.79 20a2.5 2.5 0 0 0 2.2-1.3l.7-1.4a2 2 0 0 1 1.8-1.1h7.02a2 2 0 0 1 1.8 1.1l.7 1.4a2.5 2.5 0 0 0 2.2 1.3 2 2 0 0 0 1.99-2.4l-.9-9A4 4 0 0 0 17.32 5Z"/>`,
  // trending
  `<path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/>`,
  // camera/vlog
  `<rect x="2" y="6" width="14" height="12" rx="2"/><path d="M22 8.5v7l-6-3.5 6-3.5Z"/>`,
  // smile/komedi
  `<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>`,
  // heart
  `<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"/>`,
  // bolt/aksi
  `<path d="M13 2 3 14h8l-1 8 10-12h-8l1-8Z"/>`,
];

function iconFor(index) {
  const path = CHIP_ICONS[index % CHIP_ICONS.length];
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

const ICON_ALL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>`;

async function loadCategoryChips() {
  const row = document.getElementById("category-row");
  if (!row) return;

  // Kategori aktif ditentukan dari URL saat ini:
  // - Di category.html?c=slug -> chip dengan slug itu yang aktif.
  // - Di halaman lain (index, watch, tag, dst) -> "Semua" yang aktif.
  const params = new URLSearchParams(window.location.search);
  const activeSlug = window.location.pathname.endsWith("category.html")
    ? (params.get("c") || "")
    : null; // null = bukan di halaman category sama sekali -> "Semua" aktif

  row.innerHTML = `
    <a href="index.html" class="cat-chip${activeSlug === null ? " active" : ""}" data-cat="all">
      ${ICON_ALL} Semua
    </a>`;

  try {
    const q = query(collection(db, "categories"), orderBy("name"));
    const snap = await getDocs(q);
    let i = 0;
    snap.forEach(d => {
      const cat = d.data();
      const isActive = activeSlug !== null && activeSlug === cat.slug;
      const chip = document.createElement("a");
      chip.href = `category.html?c=${encodeURIComponent(cat.slug)}`;
      chip.className = "cat-chip" + (isActive ? " active" : "");
      chip.dataset.cat = cat.slug;
      chip.innerHTML = `${iconFor(i)} ${escapeHtml(cat.name)}`;
      row.appendChild(chip);
      i++;
    });
  } catch (e) {
    console.warn("Gagal memuat kategori:", e);
  }

  // Chip yang aktif otomatis di-scroll ke tengah biar kelihatan penuh,
  // terutama kalau posisinya jauh di sisi kanan daftar kategori.
  const activeChip = row.querySelector(".cat-chip.active");
  if (activeChip) {
    activeChip.scrollIntoView({ behavior: "instant", inline: "center", block: "nearest" });
  }
}

function escapeHtml(s = "") {
  return s.replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

document.addEventListener("DOMContentLoaded", loadCategoryChips);
