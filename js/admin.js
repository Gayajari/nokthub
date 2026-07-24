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

// id video yang sedang diedit; null berarti mode "upload baru"
let editingId = null;

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

function switchToTab(tabName) {
  document.querySelectorAll(".sidebar a[data-tab]").forEach(a =>
    a.classList.toggle("active", a.dataset.tab === tabName)
  );
  ["upload", "videos", "settings"].forEach(t => {
    document.getElementById(`tab-${t}`).style.display = t === tabName ? "block" : "none";
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

// ---------- Isi form upload dengan data video yang mau diedit ----------
async function loadVideoIntoForm(id) {
  const snap = await getDoc(doc(db, "videos", id));
  if (!snap.exists()) { alert("Video tidak ditemukan."); return; }
  const v = snap.data();

  editingId = id;

  document.getElementById("f-title").value = v.title || "";
  document.getElementById("f-category").value = v.category || "";
  document.getElementById("f-desc").value = v.description || "";
  document.getElementById("f-tags").value = (v.tags || []).join(", ");
  document.getElementById("f-status").value = v.status || "draft";
  document.getElementById("f-thumb").value = v.thumbnail || "";
  document.getElementById("f-embed").value = v.embedUrl || "";
  document.getElementById("f-seo-title").value = v.seoTitle || "";
  document.getElementById("f-seo-desc").value = v.seoDescription || "";
  document.getElementById("f-keywords").value = v.metaKeywords || "";
  document.getElementById("f-admin-name").value = v.adminName || "";

  const btn = document.getElementById("btn-upload");
  if (btn) btn.textContent = "Simpan Perubahan";
  const msg = document.getElementById("upload-msg");
  if (msg) msg.textContent = `Mode edit: "${v.title}". Ubah field lalu klik Simpan Perubahan.`;

  switchToTab("upload");
}

function resetUploadForm() {
  editingId = null;
  document.querySelectorAll("#tab-upload input, #tab-upload textarea").forEach(i => i.value = "");
  const btn = document.getElementById("btn-upload");
  if (btn) btn.textContent = "Upload Video";
}

// ---------- Upload / Simpan perubahan video ----------
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
    if (editingId) {
      // ---- Mode edit: perbarui dokumen yang sama, JANGAN bikin video baru ----
      await updateDoc(doc(db, "videos", editingId), {
        title, slug: slugify(title), description, category, tags,
        thumbnail, embedUrl, status, adminName,
        seoTitle, seoDescription, metaKeywords
      });
      await upsertCategory(category);
      await upsertTags(tags);
      msg.textContent = "Perubahan video berhasil disimpan.";
      resetUploadForm();
    } else {
      // ---- Mode upload baru ----
      await addDoc(collection(db, "videos"), {
        title, slug: slugify(title), description, category, tags,
        thumbnail, embedUrl, status, uploadedAt: serverTimestamp(), adminName,
        seoTitle, seoDescription, metaKeywords,
        viewCount: 0, likeCount: 0, shareCount: 0, searchTagCount: 0
      });
      await upsertCategory(category);
      await upsertTags(tags);
      msg.textContent = "Video berhasil disimpan.";
      resetUploadForm();
    }
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
    return;
  }

  const editId = e.target.dataset.edit;
  if (editId) {
    loadVideoIntoForm(editId);
  }
});
