// ============================================================
// NOKT HUB — Kategori dinamis
// Kategori TIDAK dibuat manual: otomatis muncul saat admin
// mengupload video dengan kategori baru (lihat admin.js: upsertCategory).
// ============================================================
import { db, collection, getDocs, orderBy, query } from "./firebase-config.js";

async function loadCategoryDropdown() {
  const select = document.getElementById("category-select");
  if (!select) return;
  try {
    const q = query(collection(db, "categories"), orderBy("name"));
    const snap = await getDocs(q);
    snap.forEach(d => {
      const cat = d.data();
      const opt = document.createElement("option");
      opt.value = cat.slug;
      opt.textContent = cat.name;
      select.appendChild(opt);
    });
  } catch (e) {
    console.warn("Gagal memuat kategori:", e);
  }

  select.addEventListener("change", () => {
    if (select.value) window.location.href = `category.html?c=${select.value}`;
  });
}

document.addEventListener("DOMContentLoaded", loadCategoryDropdown);
