// ============================================================
// NOKT HUB — Kategori dinamis (versi chip-row scroll horizontal)
// Kategori TIDAK dibuat manual: otomatis muncul saat admin
// mengupload video dengan kategori baru (lihat admin.js: upsertCategory).
// Ikon per kategori diambil dari js/icons.js.
// ============================================================
import { db, collection, getDocs, orderBy, query } from "./firebase-config.js";
import { resolveCategoryIcon, iconSvg } from "./icons.js";

async function loadCategoryChips() {
  const row = document.getElementById("category-row");
  if (!row) return;

  const params = new URLSearchParams(window.location.search);
  const activeSlug = window.location.pathname.endsWith("category.html")
    ? (params.get("c") || "")
    : null;

  // ---------- FIX UTAMA: bangun SEMUA chip dulu, baru render 1x ----------
  // Sebelumnya: chip "Semua" di-render duluan lewat innerHTML, baru chip
  // kategori lain ditambahkan SATU-SATU belakangan lewat appendChild
  // setelah data Firestore selesai diambil. Itu artinya ukuran baris
  // kategori berubah beberapa kali SETELAH halaman sempat digambar --
  // dan browser (terutama Chrome) punya fitur otomatis bernama "scroll
  // anchoring" yang menggeser-geser posisi scroll untuk "mengkompensasi"
  // perubahan ukuran konten seperti itu. Ini kemungkinan besar biang
  // kerok tarikan-ke-kiri yang terus terjadi.
  //
  // Sekarang: kumpulkan HTML seluruh chip (Semua + semua kategori) dulu
  // di memori, baru pasang ke DOM SEKALI SAJA lewat satu innerHTML. Baris
  // kategori jadi langsung "jadi" dalam ukuran final sejak awal render --
  // tidak ada perubahan ukuran susulan yang bisa memicu scroll anchoring.
  const chipsHtml = [
    `<a href="index.html" class="catnav-chip${activeSlug === null ? " active" : ""}" data-cat="all">
      ${iconSvg("globe")} Semua
    </a>`
  ];

  try {
    const q = query(collection(db, "categories"), orderBy("name"));
    const snap = await getDocs(q);
    snap.forEach(d => {
      const cat = d.data();
      const isActive = activeSlug !== null && activeSlug === cat.slug;
      const iconId = resolveCategoryIcon(cat);
      chipsHtml.push(`
        <a href="category.html?c=${encodeURIComponent(cat.slug)}" class="catnav-chip${isActive ? " active" : ""}" data-cat="${cat.slug}">
          ${iconSvg(iconId)} ${escapeHtml(cat.name)}
        </a>`);
    });
  } catch (e) {
    console.warn("Gagal memuat kategori:", e);
  }

  row.innerHTML = chipsHtml.join("");

  applyScrollPosition(row, activeSlug);
}

function applyScrollPosition(row, activeSlug) {
  if (activeSlug === null) {
    row.scrollLeft = 0;
    requestAnimationFrame(() => { row.scrollLeft = 0; });
  } else {
    const activeChip = row.querySelector(".catnav-chip.active");
    if (activeChip) {
      activeChip.scrollIntoView({ behavior: "instant", inline: "center", block: "nearest" });
    }
  }
}

function escapeHtml(s = "") {
  return s.replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

document.addEventListener("DOMContentLoaded", loadCategoryChips);

window.addEventListener("pageshow", (e) => {
  if (e.persisted) loadCategoryChips();
});
