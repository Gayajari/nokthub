// ============================================================
// NOKT HUB — Kategori dinamis (versi chip-row scroll horizontal)
// Kategori TIDAK dibuat manual: otomatis muncul saat admin
// mengupload video dengan kategori baru (lihat admin.js: upsertCategory).
// Ikon per kategori diambil dari js/icons.js (lihat file itu untuk
// urutan prioritas: manual admin -> kata kunci otomatis -> hash fallback).
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

  row.innerHTML = `
    <a href="index.html" class="catnav-chip${activeSlug === null ? " active" : ""}" data-cat="all">
      ${iconSvg("globe")} Semua
    </a>`;

  try {
    const q = query(collection(db, "categories"), orderBy("name"));
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
      row.appendChild(chip);
    });
  } catch (e) {
    console.warn("Gagal memuat kategori:", e);
  }

  applyScrollPosition(row, activeSlug);
}

// ---------- FIX: browser "mengingat" posisi scroll baris kategori ----------
// Beberapa browser (terutama Chrome) otomatis me-restore posisi scroll
// elemen yang bisa di-scroll (bukan cuma scroll halaman utama) dari
// kunjungan sebelumnya -- termasuk kalau halamannya dibuka ulang lewat
// cache/back-forward (bfcache), atau bahkan kadang di reload biasa.
// Efeknya: walau kode kita TIDAK pernah menyuruh geser baris kategori,
// baris itu bisa muncul dalam kondisi sudah tergeser dari kunjungan
// sebelumnya -- membuat chip "Semua" yang sticky kelihatan menutupi
// sebagian chip lain secara aneh sejak awal halaman dibuka.
//
// Solusi: begitu tahu "Semua" yang harusnya aktif (activeSlug === null),
// PAKSA posisi scroll balik ke 0 secara eksplisit -- jangan cuma
// "membiarkan" default browser, karena defaultnya kadang bukan 0.
function applyScrollPosition(row, activeSlug) {
  if (activeSlug === null) {
    // "Semua" aktif -> selalu mulai dari posisi paling awal (0), apapun
    // yang coba di-restore browser. requestAnimationFrame dipakai supaya
    // ini dipaksakan SETELAH browser selesai mencoba restore-nya sendiri
    // (yang kadang terjadi tepat setelah render/paint pertama).
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

// FIX tambahan: saat halaman dibuka lagi lewat tombol back/forward
// browser, DOMContentLoaded TIDAK selalu jalan ulang (halaman diambil
// dari bfcache) -- padahal posisi scroll baris kategori bisa saja masih
// "nyangkut" dari sebelum user pindah halaman. "pageshow" jalan di kedua
// kasus (baik load normal maupun restore dari bfcache), jadi dipakai
// sebagai jaring pengaman tambahan supaya baris kategori selalu benar
// posisinya, dari jalur manapun halaman ini dibuka.
window.addEventListener("pageshow", (e) => {
  if (e.persisted) loadCategoryChips();
});
