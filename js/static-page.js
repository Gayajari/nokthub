// ============================================================
// NOKT HUB — Loader Halaman Statis (Kontak, Privacy Policy, dst.)
// Dipakai oleh contact.html, privacy-policy.html, terms.html,
// dmca.html, disclaimer.html. Halaman menaruh slug-nya di
// <body data-slug="...">, script ini yang ambil isinya dari
// koleksi Firestore "pages".
//
// PERUBAHAN: kalau dokumen di Firestore belum ada (admin belum
// pernah simpan lewat dashboard), konten DEFAULT yang sudah
// ditulis langsung di HTML (di dalam #page-content) TIDAK ditimpa
// — dibiarkan tampil apa adanya. Begitu admin mengisi & menyimpan
// lewat dashboard, isi dari Firestore akan otomatis menggantikan
// default ini.
// ============================================================
import { db, doc, getDoc } from "./firebase-config.js";

async function loadStaticPage() {
  const slug = document.body.dataset.slug;
  const titleEl = document.getElementById("page-title");
  const contentEl = document.getElementById("page-content");
  if (!slug || !contentEl) return;

  try {
    const snap = await getDoc(doc(db, "pages", slug));
    if (snap.exists()) {
      const data = snap.data();
      if (titleEl && data.title) titleEl.textContent = data.title;
      if (data.title) document.title = `${data.title} — NOKT HUB`;
      if (data.content) contentEl.innerHTML = data.content;
      // Kalau field content kosong di Firestore, biarkan default HTML tetap tampil.
    }
    // Kalau dokumen belum ada sama sekali, biarkan default HTML tetap tampil
    // (tidak ditimpa dengan pesan "Konten belum diisi").
  } catch (err) {
    // Kalau gagal fetch (mis. offline), biarkan default HTML tetap tampil
    // daripada menimpanya dengan pesan error.
    console.warn("Gagal memuat konten dari Firestore, menampilkan default:", err);
  }
}

document.addEventListener("DOMContentLoaded", loadStaticPage);
