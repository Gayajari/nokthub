// ============================================================
// NOKT HUB — Kategori dinamis (versi chip-row scroll horizontal)
// PATCH: kategori terbaru sekarang tampil di posisi PALING KIRI
// (setelah "Semua"), kategori lama terdorong ke kanan.
// Tidak ada perubahan pada skema Firestore — hanya urutan query.
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
    // PATCH #1 — dulu: orderBy("name") -> alfabetis, jadi kategori baru
    // bisa nyempil di tengah/akhir tergantung namanya.
    // Sekarang: orderBy field waktu pembuatan, descending, supaya
    // kategori yang paling BARU ditambahkan admin selalu jadi item
    // PERTAMA di hasil query -> otomatis jadi item paling kiri saat
    // di-append ke row (karena forEach di bawah cuma appendChild
    // berurutan sesuai hasil query, tidak perlu unshift manual).
    //
    // PENTING: sesuaikan nama field "createdAt" ini dengan field yang
    // benar-benar dipakai upsertCategory() di admin.js. Kalau field
    // itu belum ada di dokumen kategori lama, kategori lama akan
    // muncul di akhir urutan (undefined field diurutkan Firestore
    // paling akhir untuk "desc") — bukan hilang, cuma urutannya ikut
    // fallback. Kalau field-nya bernama lain (mis. "createdTime",
    // "timestamp"), ganti string di bawah ini saja.
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
      row.appendChild(chip);
    });
  } catch (e) {
    console.warn("Gagal memuat kategori:", e);
  }

  applyScrollPosition(row, activeSlug);
}

// ---------- FIX: browser "mengingat" posisi scroll baris kategori ----------
// (tidak diubah dari versi sebelumnya — logic ini sudah benar untuk
// memastikan row selalu mulai dari kiri saat "Semua" aktif, sehingga
// kategori terbaru hasil PATCH #1 di atas langsung kelihatan.)
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
