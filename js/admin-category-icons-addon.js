// ============================================================
// TAMBAHAN untuk js/admin.js — Kelola Ikon Kategori (manual, opsional)
// ============================================================
// CARA PASANG:
// 1. Tambahkan baris import ini di paling atas admin.js, sejajar
//    import lain yang sudah ada:
//
//      import { resolveCategoryIcon, iconSvg, allIconIds, ICON_LIBRARY } from "./icons.js";
//
// 2. Tempel SELURUH blok kode di bawah ini ke bagian paling bawah
//    admin.js (boleh di atas atau di bawah blok "KATEGORI & TAG" yang
//    sudah ada -- tidak menimpa apapun, cuma menambah).
//
// 3. Di dashboard.html, tambahkan 1 elemen kosong ini di tab Pengaturan
//    (tab-settings), di posisi mana saja yang masuk akal (misal di
//    bawah form pengaturan umum):
//
//      <div class="form-grid full" style="margin-top:20px">
//        <label style="font-weight:600">Ikon Kategori (opsional)</label>
//        <p style="font-size:.8rem;color:var(--text-muted);margin-bottom:10px">
//          Kategori otomatis dapat ikon dari tebakan nama. Kalau ada yang
//          kurang pas, pilih ikon manual di sini -- pilihan ini akan
//          selalu dipakai dan tidak akan pernah diganti otomatis lagi.
//        </p>
//        <div id="category-icon-manager"></div>
//      </div>
// ============================================================

async function loadCategoryIconManager() {
  const wrap = document.getElementById("category-icon-manager");
  if (!wrap) return;

  const snap = await getDocs(query(collection(db, "categories"), orderBy("name")));
  const categories = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  if (!categories.length) {
    wrap.innerHTML = `<p style="color:var(--text-muted);font-size:.82rem">Belum ada kategori. Kategori akan muncul otomatis setelah kamu upload video pertama.</p>`;
    return;
  }

  wrap.innerHTML = categories.map(cat => {
    const currentIcon = resolveCategoryIcon(cat);
    const isManual = !!cat.icon;
    return `
      <div class="cat-icon-row" data-slug="${cat.slug}" style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
        <span style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;flex-shrink:0">${iconSvg(currentIcon)}</span>
        <span style="flex:1;font-size:.88rem">${cat.name}</span>
        <select class="cat-icon-select" data-slug="${cat.slug}" style="background:var(--surface);border:1px solid var(--border);color:var(--text);padding:6px 8px;border-radius:6px;font-size:.8rem">
          <option value="">Otomatis (tebak dari nama)</option>
          ${allIconIds().map(id => `
            <option value="${id}" ${isManual && cat.icon === id ? "selected" : ""}>${ICON_LIBRARY[id].label}</option>
          `).join("")}
        </select>
        <span class="cat-icon-status" data-slug="${cat.slug}" style="font-size:.72rem;color:var(--text-muted);min-width:60px"></span>
      </div>`;
  }).join("");
}

document.addEventListener("change", async (e) => {
  if (!e.target.classList.contains("cat-icon-select")) return;
  const slug = e.target.dataset.slug;
  const iconId = e.target.value; // "" = balik ke otomatis
  const statusEl = document.querySelector(`.cat-icon-status[data-slug="${slug}"]`);
  const iconPreview = document.querySelector(`.cat-icon-row[data-slug="${slug}"] span`);

  try {
    if (iconId) {
      await updateDoc(doc(db, "categories", slug), { icon: iconId });
    } else {
      // "Otomatis" dipilih lagi -> hapus field icon manual, balik ke
      // logic kata kunci/hash. Firestore updateDoc dengan nilai null
      // sederhana tidak menghapus field, jadi pakai deleteField().
      const { deleteField } = await import("./firebase-config.js");
      await updateDoc(doc(db, "categories", slug), { icon: deleteField ? deleteField() : "" });
    }
    if (statusEl) { statusEl.textContent = "Tersimpan ✓"; setTimeout(() => statusEl.textContent = "", 1500); }
    if (iconPreview) {
      const resolved = resolveCategoryIcon({ slug, icon: iconId || undefined, name: e.target.closest(".cat-icon-row").querySelector("span:nth-child(2)").textContent });
      iconPreview.innerHTML = iconSvg(resolved);
    }
  } catch (err) {
    if (statusEl) statusEl.textContent = "Gagal: " + err.message;
  }
});

// Panggil loadCategoryIconManager() setiap kali tab "Pengaturan" dibuka.
// Cara paling gampang: tambahkan baris ini di dalam initTabs(), pada
// listener klik tab -- taruh setelah baris yang menampilkan tab settings:
//
//   if (link.dataset.tab === "settings") loadCategoryIconManager();
//
// ATAU, cara paling simpel tanpa mengedit initTabs() sama sekali: panggil
// langsung di sini juga sekali saat admin.js dimuat pertama kali (aman
// dipanggil kapan saja karena dia sendiri sudah cek elemen ada atau tidak):
document.addEventListener("DOMContentLoaded", () => {
  setTimeout(loadCategoryIconManager, 500); // beri jeda sedikit untuk auth guard selesai dulu
});
