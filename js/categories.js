// ============================================================
// NOKT HUB — Kategori dinamis (versi chip-row scroll horizontal)
// PATCH:
//  1) "Semua" dipindah ke wrapper TERPISAH di luar area scroll
//     (fix: dulu overlap dengan chip lain karena position:sticky
//     dipakai DI DALAM container yang sama dengan area scroll —
//     lihat catnav-sticky vs catnav-scroll di CSS).
//  2) Kategori terbaru tampil paling kiri di area scroll (prepend).
// Struktur data/Firestore, filtering, dan class chip individual
// (.catnav-chip) TIDAK berubah — cuma dibungkus 2 wrapper baru.
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

  // AREA 1 (catnav-sticky): cuma berisi "Semua", TIDAK ikut ter-scroll
  // sama sekali karena berada di luar div overflow-x:auto.
  // AREA 2 (catnav-scroll): semua chip kategori lain, ini yang di-scroll.
  row.innerHTML = `
    <div class="catnav-sticky">
      <a href="index.html" class="catnav-chip${activeSlug === null ? " active" : ""}" data-cat="all">
        ${iconSvg("globe")} Semua
      </a>
    </div>
    <div class="catnav-scroll" id="category-scroll"></div>
  `;

  const scrollArea = row.querySelector("#category-scroll");

  try {
    // Kategori terbaru = paling kiri di area scroll.
    // orderBy("createdAt","desc") -> hasil query kategori terbaru duluan,
    // lalu di-appendChild berurutan seperti sebelumnya (tidak perlu
    // unshift manual). Sesuaikan nama field ini kalau di admin.js/
    // upsertCategory() field waktu-nya bukan "createdAt".
    const q = query(collection(db, "categories"), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    snap.forEach(d => {
      const cat = d.data();
      const isActive = activeSlug !== null && activeSlug === cat.slug;
      const iconId = resolveCategoryIcon(cat);
      const chip = document.createElement("a");
      chip.href = `category.html?c=${encodeURIComponent(cat.slug)}`;
      chip.className = "catnav-chip" + (isActive ? " active" : "");
      chip.dataset.cat = cat.slug;
      chip.innerHTML = `${iconSvg(iconId)} ${escapeHtml(cat.name)}`;
      scrollArea.appendChild(chip);
    });
  } catch (e) {
    console.warn("Gagal memuat kategori:", e);
  }

  applyScrollPosition(scrollArea, activeSlug);
}

// ---------- FIX: browser "mengingat" posisi scroll baris kategori ----------
// Sama seperti sebelumnya, tapi sekarang target-nya adalah #category-scroll
// (area scroll saja), bukan seluruh #category-row lagi.
function applyScrollPosition(scrollArea, activeSlug) {
  if (activeSlug === null) {
    scrollArea.scrollLeft = 0;
    requestAnimationFrame(() => { scrollArea.scrollLeft = 0; });
  } else {
    const activeChip = scrollArea.querySelector(".catnav-chip.active");
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
