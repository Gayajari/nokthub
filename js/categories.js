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

  // Cuma scroll-ke-tengah kalau yang aktif itu kategori asli (bukan
  // "Semua" yang sticky) -- lihat penjelasan lengkap di riwayat chat.
  if (activeSlug) {
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
