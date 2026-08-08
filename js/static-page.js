// ============================================================
// NOKT HUB — Loader Halaman Statis (Kontak, Privacy Policy, dst.)
// Dipakai oleh contact.html, privacy-policy.html, terms.html,
// dmca.html, disclaimer.html. Halaman menaruh slug-nya di
// <body data-slug="...">, script ini yang ambil isinya dari
// koleksi Firestore "pages".
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
      contentEl.innerHTML = data.content || "<p>Konten belum diisi.</p>";
    } else {
      contentEl.innerHTML = "<p>Konten belum diisi oleh admin.</p>";
    }
  } catch (err) {
    contentEl.innerHTML = "<p>Gagal memuat konten. Coba lagi nanti.</p>";
  }
}

document.addEventListener("DOMContentLoaded", loadStaticPage);
