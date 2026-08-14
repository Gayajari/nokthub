// ============================================================
// NOKT HUB — Kategori dinamis (versi chip-row scroll horizontal)
// Kategori TIDAK dibuat manual: otomatis muncul saat admin
// mengupload video dengan kategori baru (lihat admin.js: upsertCategory).
// Ikon per kategori diambil dari js/icons.js.
// ============================================================
import { db, collection, getDocs, orderBy, query } from "./firebase-config.js";
import { resolveCategoryIcon, iconSvg, areIconsGloballyHidden } from "./icons.js";

const SCROLL_KEY = "nokt_catnav_scroll";

async function loadCategoryChips() {
  const row = document.getElementById("category-row");
  if (!row) return;

  const params = new URLSearchParams(window.location.search);
  const activeSlug = window.location.pathname.endsWith("category.html")
    ? (params.get("c") || "")
    : null;

  // Bangun semua chip dulu, render 1x (hindari scroll-anchoring browser
  // -- lihat riwayat chat untuk penjelasan lengkap).
  // Saklar global "matikan semua ikon" -- kalau aktif, ikon-nya dilewati
  // untuk SEMUA chip (termasuk "Semua"), apapun pilihan ikon manual per
  // kategori. Diatur admin lewat Pengaturan -> "Sembunyikan Ikon Kategori".
  const hideIcons = areIconsGloballyHidden();

  const chipsHtml = [
    `<a href="index.html" class="catnav-chip${activeSlug === null ? " active" : ""}" data-cat="all">
      ${hideIcons ? "" : iconSvg("globe")} Semua
    </a>`
  ];

  try {
    const q = query(collection(db, "categories"), orderBy("name"));
    const snap = await getDocs(q);
    snap.forEach(d => {
      const cat = d.data();
      const isActive = activeSlug !== null && activeSlug === cat.slug;
      const iconId = resolveCategoryIcon(cat);
      const iconHtml = hideIcons ? "" : iconSvg(iconId);
      chipsHtml.push(`
        <a href="category.html?c=${encodeURIComponent(cat.slug)}" class="catnav-chip${isActive ? " active" : ""}" data-cat="${cat.slug}">
          ${iconHtml} ${escapeHtml(cat.name)}
        </a>`);
    });
  } catch (e) {
    console.warn("Gagal memuat kategori:", e);
  }

  row.innerHTML = chipsHtml.join("");

  // ---------- Bedakan: navigasi baru/refresh VS balik lewat back/forward ----------
  // performance navigation type memberi tahu PERSIS bagaimana halaman ini
  // sampai dibuka:
  //   "navigate" -> user klik link / ketik URL / klik chip kategori (baru)
  //   "reload"   -> user refresh halaman
  //   "back_forward" -> user pakai tombol back/forward
  //
  // Untuk "navigate"/"reload": ini kunjungan BARU ke halaman ini -> pakai
  // posisi default (Semua di awal / kategori yang dipilih di tengah),
  // sesuai permintaan "klik Semua = balik ke 3 chip awal".
  //
  // Untuk "back_forward": user sedang KEMBALI ke halaman yang tadi dia
  // tinggalkan -> JANGAN reset apapun. Kalau browser mendukung bfcache,
  // dia sudah otomatis mengembalikan posisi scroll persis seperti
  // terakhir kali (tidak perlu kita sentuh sama sekali). Kalau browser
  // TIDAK memakai bfcache untuk kasus ini (reload penuh terjadi), kita
  // bantu manual pakai posisi yang sempat disimpan ke sessionStorage
  // setiap kali user menggeser baris ini.
  const navType = getNavigationType();

  if (navType === "back_forward") {
    let saved = null;
    try { saved = sessionStorage.getItem(SCROLL_KEY); } catch (e) {}
    if (saved !== null) {
      row.scrollLeft = parseInt(saved, 10) || 0;
    } else {
      applyDefaultScrollPosition(row, activeSlug);
    }
  } else {
    applyDefaultScrollPosition(row, activeSlug);
  }

  // Simpan posisi scroll tiap kali user menggeser baris ini secara manual
  // -- supaya kalau nanti dia pencet back, ada data buat direstore kalau
  // browser tidak pakai bfcache untuk kasus tersebut.
  row.addEventListener("scroll", () => {
    try { sessionStorage.setItem(SCROLL_KEY, String(row.scrollLeft)); } catch (e) {}
  }, { passive: true });
}

function getNavigationType() {
  try {
    const entries = performance.getEntriesByType("navigation");
    return entries.length ? entries[0].type : null;
  } catch (e) {
    return null;
  }
}

function applyDefaultScrollPosition(row, activeSlug) {
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

// CATATAN: listener "pageshow" (yang sebelumnya ada di sini untuk jaga-
// jaga bfcache) SENGAJA DIHAPUS. Itu ternyata biang kerok yang membuat
// posisi scroll selalu reset walau user pencet tombol back -- karena
// setiap halaman "dibangunkan" dari bfcache, listener itu ikut memaksa
// reset ke 0, padahal browser sendiri SUDAH otomatis mengembalikan
// posisi scroll dengan benar lewat bfcache. Sekarang dibiarkan sepenuhnya
// ke bfcache untuk kasus itu; logic sessionStorage di atas hanya jadi
// cadangan untuk browser yang tidak memakai bfcache pada kasus tertentu.
