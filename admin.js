// ============================================================
// NOKT HUB — Admin Dashboard Logic
// ============================================================
import {
  auth, db, onAuthStateChanged, collection, doc, getDoc, getDocs, addDoc,
  setDoc, updateDoc, deleteDoc, query, where, orderBy, serverTimestamp
} from "./firebase-config.js";

function slugify(str) {
  return str.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

// ---------- Guard: hanya role === 'admin' yang bisa masuk ----------
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "../login.html"; return; }
  const snap = await getDoc(doc(db, "users", user.uid));
  const role = snap.exists() ? snap.data().role : "user";
  if (role !== "admin") {
    document.getElementById("admin-guard").style.display = "block";
    return;
  }
  document.getElementById("admin-app").style.display = "grid";
  initTabs();
  loadVideoTable();
});

function initTabs() {
  document.querySelectorAll(".sidebar a[data-tab]").forEach(link => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      document.querySelectorAll(".sidebar a[data-tab]").forEach(a => a.classList.remove("active"));
      link.classList.add("active");
      ["upload", "videos", "settings"].forEach(t => {
        document.getElementById(`tab-${t}`).style.display = t === link.dataset.tab ? "block" : "none";
      });
    });
  });
}

// ---------- Auto-create category & tags jika belum ada ----------
async function upsertCategory(name) {
  if (!name) return;
  const slug = slugify(name);
  const ref = doc(db, "categories", slug);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, { name, slug, videoCount: 1 });
  } else {
    await updateDoc(ref, { videoCount: (snap.data().videoCount || 0) + 1 });
  }
}

async function upsertTags(tags) {
  for (const t of tags) {
    const slug = slugify(t);
    if (!slug) continue;
    const ref = doc(db, "tags", slug);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, { name: t, slug, searchCount: 0, videoCount: 1 });
    } else {
      await updateDoc(ref, { videoCount: (snap.data().videoCount || 0) + 1 });
    }
  }
}

// ---------- Upload video ----------
document.addEventListener("click", async (e) => {
  if (e.target.id !== "btn-upload") return;
  const title = document.getElementById("f-title").value.trim();
  const category = document.getElementById("f-category").value.trim();
  const description = document.getElementById("f-desc").value.trim();
  const tags = document.getElementById("f-tags").value.split(",").map(t => t.trim()).filter(Boolean);
  const status = document.getElementById("f-status").value;
  const thumbnail = document.getElementById("f-thumb").value.trim();
  const embedUrl = document.getElementById("f-embed").value.trim();
  const seoTitle = document.getElementById("f-seo-title").value.trim();
  const seoDescription = document.getElementById("f-seo-desc").value.trim();
  const metaKeywords = document.getElementById("f-keywords").value.trim();
  const adminName = document.getElementById("f-admin-name").value.trim();
  const msg = document.getElementById("upload-msg");

  if (!title || !embedUrl) { msg.textContent = "Judul dan Link Embed wajib diisi."; return; }

  try {
    await addDoc(collection(db, "videos"), {
      title, slug: slugify(title), description, category, tags,
      thumbnail, embedUrl, status, uploadedAt: serverTimestamp(), adminName,
      seoTitle, seoDescription, metaKeywords,
      viewCount: 0, likeCount: 0, shareCount: 0, searchTagCount: 0
    });
    await upsertCategory(category);
    await upsertTags(tags);
    msg.textContent = "Video berhasil disimpan.";
    document.querySelectorAll("#tab-upload input, #tab-upload textarea").forEach(i => i.value = "");
    loadVideoTable();
  } catch (err) {
    msg.textContent = "Gagal menyimpan: " + err.message;
  }
});

// ---------- Tabel semua video (edit/hapus) ----------
async function loadVideoTable() {
  const body = document.getElementById("video-table-body");
  if (!body) return;
  const snap = await getDocs(query(collection(db, "videos"), orderBy("uploadedAt", "desc")));
  body.innerHTML = snap.docs.map(d => {
    const v = d.data();
    return `
      <tr>
        <td>${v.title}</td>
        <td>${v.category || "-"}</td>
        <td>${v.status}</td>
        <td>${v.viewCount || 0}</td>
        <td class="row-actions">
          <button class="share-btn" data-edit="${d.id}">Edit</button>
          <button class="share-btn" data-del="${d.id}">Hapus</button>
        </td>
      </tr>`;
  }).join("");
}

document.addEventListener("click", async (e) => {
  const delId = e.target.dataset.del;
  if (delId && confirm("Hapus video ini?")) {
    await deleteDoc(doc(db, "videos", delId));
    loadVideoTable();
  }
  // Edit sederhana: muat data ke form upload untuk diedit lalu simpan ulang (contoh dasar,
  // untuk produksi sebaiknya buat form edit terpisah dengan updateDoc pada id yang sama)
});
