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

// ============================================================
// UPLOAD GENERIK — dipakai bareng untuk thumbnail & video.
// Semua endpoint/API key/format respons diambil dari settings/site
// (diisi lewat tab Pengaturan), bukan hardcode di kode.
// ============================================================

function getByPath(obj, path) {
  if (!path) return undefined;
  return path.split(".").reduce((o, k) => (o ? o[k] : undefined), obj);
}

let settingsCache = null;
async function getSiteSettings(forceRefresh = false) {
  if (settingsCache && !forceRefresh) return settingsCache;
  const snap = await getDoc(doc(db, "settings", "site"));
  settingsCache = snap.exists() ? snap.data() : {};
  return settingsCache;
}

/**
 * Upload file/blob ke host manapun (foto/video) berdasarkan config dinamis.
 * config: { endpoint, apiKey, urlField, fileFieldName, authType, fileName }
 */
async function uploadToHost(fileOrBlob, config) {
  const { endpoint, apiKey, urlField, fileFieldName = "file", authType = "query", fileName } = config;
  if (!endpoint || !apiKey) {
    throw new Error("Endpoint atau API key belum diatur di tab Pengaturan.");
  }

  const formData = new FormData();
  formData.append(fileFieldName, fileOrBlob, fileName || fileOrBlob.name || "upload");

  let url = endpoint;
  const headers = {};

  if (authType === "header") {
    headers["Authorization"] = `Bearer ${apiKey}`;
    headers["AccessKey"] = apiKey;
  } else {
    const sep = endpoint.includes("?") ? "&" : "?";
    url = `${endpoint}${sep}key=${encodeURIComponent(apiKey)}`;
  }

  const res = await fetch(url, { method: "POST", body: formData, headers });
  const data = await res.json();

  if (data.success === false || data.error) {
    throw new Error(data.error?.message || data.message || "Upload gagal.");
  }

  const resultUrl = getByPath(data, urlField || "data.url");
  if (!resultUrl) {
    throw new Error("URL tidak ditemukan di respons API. Cek isian 'Field URL di Respons' pada Pengaturan.");
  }
  return resultUrl;
}

/**
 * Polling status upload video (opsional).
 */
async function pollVideoStatus(idOrUrl, statusConfig) {
  const { statusEndpoint, apiKey, authType = "query", urlField, statusField, readyValue = "ready" } = statusConfig;
  if (!statusEndpoint) return idOrUrl;

  const maxAttempts = 24;
  const delayMs = 5000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let url = `${statusEndpoint}${statusEndpoint.includes("?") ? "&" : "?"}id=${encodeURIComponent(idOrUrl)}`;
    const headers = {};
    if (authType === "header") {
      headers["Authorization"] = `Bearer ${apiKey}`;
      headers["AccessKey"] = apiKey;
    } else {
      url += `&key=${encodeURIComponent(apiKey)}`;
    }

    const res = await fetch(url, { headers });
    const data = await res.json();
    const status = getByPath(data, statusField || "status");

    if (status === readyValue) {
      return getByPath(data, urlField || "data.url") || idOrUrl;
    }
    await new Promise(r => setTimeout(r, delayMs));
  }
  throw new Error("Video masih diproses, coba cek lagi beberapa saat lagi.");
}

// ============================================================
// CROP/ZOOM THUMBNAIL (pakai Cropper.js, dimuat via CDN di dashboard.html)
// ============================================================
let cropperInstance = null;
let pendingCropResolve = null;

function openCropModal(file) {
  return new Promise((resolve) => {
    const modal = document.getElementById("crop-modal");
    const img = document.getElementById("crop-image");
    if (!modal || !img || typeof Cropper === "undefined") {
      // Cropper.js belum termuat (mis. offline) — langsung pakai file asli tanpa crop
      resolve(file);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      img.src = reader.result;
      modal.style.display = "flex";
      if (cropperInstance) cropperInstance.destroy();
      cropperInstance = new Cropper(img, { aspectRatio: 16 / 9, viewMode: 1, autoCropArea: 1, background: false });
      pendingCropResolve = resolve;
    };
    reader.readAsDataURL(file);
  });
}

function initCropModalButtons() {
  const confirmBtn = document.getElementById("crop-confirm");
  const cancelBtn = document.getElementById("crop-cancel");
  const modal = document.getElementById("crop-modal");
  if (!confirmBtn || !cancelBtn) return;

  confirmBtn.addEventListener("click", () => {
    if (!cropperInstance) return;
    cropperInstance.getCroppedCanvas({ width: 640, height: 360 }).toBlob((blob) => {
      modal.style.display = "none";
      cropperInstance.destroy();
      cropperInstance = null;
      pendingCropResolve?.(blob);
      pendingCropResolve = null;
    }, "image/jpeg", 0.92);
  });

  cancelBtn.addEventListener("click", () => {
    modal.style.display = "none";
    if (cropperInstance) { cropperInstance.destroy(); cropperInstance = null; }
    pendingCropResolve?.(null); // batal
    pendingCropResolve = null;
  });
}

// ---------- Upload Thumbnail (manual link ATAU upload file + crop) ----------
function initThumbUpload() {
  const fileInput = document.getElementById("f-thumb-file");
  const urlInput = document.getElementById("f-thumb"); // sekarang input teks biasa, bisa diisi manual
  const preview = document.getElementById("thumb-preview");
  const status = document.getElementById("thumb-upload-status");
  if (!urlInput) return;

  // Preview otomatis kalau admin ketik/tempel link manual
  urlInput.addEventListener("change", () => {
    preview.innerHTML = urlInput.value.trim()
      ? `<img src="${urlInput.value.trim()}" alt="preview thumbnail">` : "";
  });

  if (!fileInput) return;
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;

    const cropped = await openCropModal(file); // buka modal crop/zoom dulu
    fileInput.value = ""; // reset supaya file yang sama bisa dipilih ulang nanti
    if (!cropped) return; // user membatalkan crop

    status.textContent = "Mengupload gambar...";
    preview.innerHTML = "";
    try {
      const s = await getSiteSettings(true);
      const url = await uploadToHost(cropped, {
        endpoint: s.thumbEndpoint,
        apiKey: s.thumbApiKey,
        urlField: s.thumbField,
        fileFieldName: "image",
        authType: "query",
        fileName: "thumbnail.jpg"
      });
      urlInput.value = url; // isi otomatis field manual, tetap bisa diedit/diganti tangan
      preview.innerHTML = `<img src="${url}" alt="preview thumbnail">`;
      status.textContent = "Berhasil diupload.";
    } catch (err) {
      status.textContent = "Gagal upload: " + err.message;
    }
  });
}

// ============================================================
// AUTO-THUMBNAIL — dipanggil saat Simpan Video kalau field
// thumbnail dikosongkan (sengaja atau lupa). Urutan percobaan:
// 1) YouTube (thumbnail resmi via img.youtube.com)
// 2) Vimeo (thumbnail resmi via vumbnail.com)
// 3) File video langsung (.mp4/.webm/dst) -> ambil 1 frame via canvas,
//    lalu upload otomatis ke host thumbnail yang sudah diatur.
//    Catatan: langkah ini bisa gagal kalau server video tidak
//    mengizinkan akses cross-origin (CORS) — di luar kendali kode ini.
// Kalau semua gagal, kembalikan null; app.js akan tetap menampilkan
// placeholder rapi sebagai jaring pengaman terakhir (bukan gambar pecah).
// ============================================================
function extractAutoThumbFromEmbed(embedUrl) {
  if (!embedUrl) return null;
  const yt = embedUrl.match(/youtu\.be\/([a-zA-Z0-9_-]+)/)
          || embedUrl.match(/[?&]v=([a-zA-Z0-9_-]+)/)
          || embedUrl.match(/embed\/([a-zA-Z0-9_-]+)/);
  if (yt) return `https://img.youtube.com/vi/${yt[1]}/hqdefault.jpg`;

  const vimeo = embedUrl.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vimeo) return `https://vumbnail.com/${vimeo[1]}.jpg`;

  return null;
}

function captureFrameFromVideoUrl(url) {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "auto";
    video.src = url;

    const cleanupResolve = (val) => { resolve(val); };

    video.addEventListener("loadeddata", () => {
      try { video.currentTime = Math.min(1, (video.duration || 2) / 2); }
      catch (e) { cleanupResolve(null); }
    });
    video.addEventListener("seeked", () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 360;
        canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => cleanupResolve(blob), "image/jpeg", 0.85);
      } catch (e) {
        cleanupResolve(null); // biasanya kena batasan CORS dari server video
      }
    });
    video.addEventListener("error", () => cleanupResolve(null));
    setTimeout(() => cleanupResolve(null), 8000); // timeout pengaman
  });
}

async function autoGenerateThumbnail(embedUrl) {
  const staticThumb = extractAutoThumbFromEmbed(embedUrl);
  if (staticThumb) return staticThumb;

  const isDirectVideoFile = /\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(embedUrl);
  if (isDirectVideoFile) {
    const blob = await captureFrameFromVideoUrl(embedUrl);
    if (blob) {
      try {
        const s = await getSiteSettings(true);
        return await uploadToHost(blob, {
          endpoint: s.thumbEndpoint,
          apiKey: s.thumbApiKey,
          urlField: s.thumbField,
          fileFieldName: "image",
          authType: "query",
          fileName: "auto-thumb.jpg"
        });
      } catch (e) { return null; }
    }
  }
  return null; // tidak bisa diambil otomatis — dibiarkan kosong, app.js yang tangani fallback
}

// ---------- Upload Video dari Galeri ----------
function initVideoUpload() {
  const fileInput = document.getElementById("f-video-file");
  const embedInput = document.getElementById("f-embed");
  const status = document.getElementById("video-upload-status");
  if (!fileInput) return;

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    status.textContent = "Mengupload video...";
    try {
      const s = await getSiteSettings(true);
      let url = await uploadToHost(file, {
        endpoint: s.videoEndpoint,
        apiKey: s.videoApiKey,
        urlField: s.videoField,
        fileFieldName: "file",
        authType: s.videoAuthType || "query",
        fileName: file.name
      });

      if (s.videoStatusEndpoint) {
        status.textContent = "Video sedang diproses server, mohon tunggu...";
        url = await pollVideoStatus(url, {
          statusEndpoint: s.videoStatusEndpoint,
          apiKey: s.videoApiKey,
          authType: s.videoAuthType || "query",
          urlField: s.videoField,
          statusField: s.videoStatusField,
          readyValue: s.videoReadyValue || "ready"
        });
      }

      embedInput.value = url; // otomatis isi field embed manual, tetap bisa diedit
      status.textContent = "Video berhasil diupload, link embed terisi otomatis.";
    } catch (err) {
      status.textContent = "Gagal upload video: " + err.message;
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initThumbUpload();
  initVideoUpload();
  initCropModalButtons();
});

// ============================================================
// AUTH GUARD
// ============================================================
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
  loadSettings();
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

// ============================================================
// PENGATURAN (Data Utama)
// ============================================================
async function loadSettings() {
  const s = await getSiteSettings(true);
  const map = {
    "s-name": s.siteName,
    "s-logo": s.logoUrl,
    "s-favicon": s.favicon,
    "s-theme": s.themeColor,
    "s-email": s.contactEmail,
    "s-ga": s.gaId,
    "s-thumb-api-key": s.thumbApiKey,
    "s-thumb-endpoint": s.thumbEndpoint,
    "s-thumb-field": s.thumbField,
    "s-video-api-key": s.videoApiKey,
    "s-video-endpoint": s.videoEndpoint,
    "s-video-field": s.videoField,
    "s-video-auth-type": s.videoAuthType,
    "s-video-status-endpoint": s.videoStatusEndpoint,
    "s-video-status-field": s.videoStatusField,
    "s-video-ready-value": s.videoReadyValue
  };
  Object.entries(map).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el && val) el.value = val;
  });
}

document.addEventListener("click", async (e) => {
  if (e.target.id !== "btn-save-settings") return;
  const val = (id) => document.getElementById(id)?.value.trim() || "";
  await setDoc(doc(db, "settings", "site"), {
    siteName: val("s-name"),
    logoUrl: val("s-logo"),
    favicon: val("s-favicon"),
    themeColor: val("s-theme"),
    contactEmail: val("s-email"),
    gaId: val("s-ga"),
    thumbApiKey: val("s-thumb-api-key"),
    thumbEndpoint: val("s-thumb-endpoint"),
    thumbField: val("s-thumb-field"),
    videoApiKey: val("s-video-api-key"),
    videoEndpoint: val("s-video-endpoint"),
    videoField: val("s-video-field"),
    videoAuthType: val("s-video-auth-type"),
    videoStatusEndpoint: val("s-video-status-endpoint"),
    videoStatusField: val("s-video-status-field"),
    videoReadyValue: val("s-video-ready-value")
  }, { merge: true });
  settingsCache = null;
  alert("Pengaturan tersimpan.");
});

// ============================================================
// KATEGORI & TAG (tidak berubah)
// ============================================================
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

// ============================================================
// FORM VIDEO
// ============================================================
let editingVideoId = null;

function fillForm(v) {
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
  const preview = document.getElementById("thumb-preview");
  preview.innerHTML = v.thumbnail ? `<img src="${v.thumbnail}" alt="preview thumbnail">` : "";
}

function resetForm() {
  editingVideoId = null;
  document.querySelectorAll("#tab-upload input, #tab-upload textarea").forEach(i => i.value = "");
  document.getElementById("thumb-preview").innerHTML = "";
  document.getElementById("thumb-upload-status").textContent = "";
  const videoStatus = document.getElementById("video-upload-status");
  if (videoStatus) videoStatus.textContent = "";
  document.getElementById("btn-upload").textContent = "Simpan Video";
  document.getElementById("upload-msg").textContent = "";
}

async function startEdit(videoId) {
  const snap = await getDoc(doc(db, "videos", videoId));
  if (!snap.exists()) return;
  editingVideoId = videoId;
  fillForm(snap.data());
  document.getElementById("btn-upload").textContent = "Update Video";
  document.querySelector('.sidebar a[data-tab="upload"]').click();
  window.scrollTo(0, 0);
}

document.addEventListener("click", async (e) => {
  if (e.target.id !== "btn-upload") return;
  const title = document.getElementById("f-title").value.trim();
  const category = document.getElementById("f-category").value.trim();
  const description = document.getElementById("f-desc").value.trim();
  const tags = document.getElementById("f-tags").value.split(",").map(t => t.trim()).filter(Boolean);
  const status = document.getElementById("f-status").value;
  let thumbnail = document.getElementById("f-thumb").value.trim();
  const embedUrl = document.getElementById("f-embed").value.trim();
  const seoTitle = document.getElementById("f-seo-title").value.trim();
  const seoDescription = document.getElementById("f-seo-desc").value.trim();
  const metaKeywords = document.getElementById("f-keywords").value.trim();
  const adminName = document.getElementById("f-admin-name").value.trim();
  const msg = document.getElementById("upload-msg");

  if (!title || !embedUrl) { msg.textContent = "Judul dan Link Embed wajib diisi."; return; }

  // Thumbnail kosong (sengaja/lupa) -> coba buat otomatis dari video sebelum simpan
  if (!thumbnail) {
    msg.textContent = "Membuat thumbnail otomatis dari video...";
    const auto = await autoGenerateThumbnail(embedUrl);
    if (auto) thumbnail = auto;
    msg.textContent = "";
  }

  try {
    if (editingVideoId) {
      await updateDoc(doc(db, "videos", editingVideoId), {
        title, slug: slugify(title), description, category, tags,
        thumbnail, embedUrl, status, adminName,
        seoTitle, seoDescription, metaKeywords
      });
      await upsertCategory(category);
      await upsertTags(tags);
      msg.textContent = "Video berhasil diupdate.";
    } else {
      await addDoc(collection(db, "videos"), {
        title, slug: slugify(title), description, category, tags,
        thumbnail, embedUrl, status, uploadedAt: serverTimestamp(), adminName,
        seoTitle, seoDescription, metaKeywords,
        viewCount: 0, likeCount: 0, shareCount: 0, searchTagCount: 0
      });
      await upsertCategory(category);
      await upsertTags(tags);
      msg.textContent = "Video berhasil disimpan.";
    }
    resetForm();
    loadVideoTable();
  } catch (err) {
    msg.textContent = "Gagal menyimpan: " + err.message;
  }
});

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
  const editId = e.target.dataset.edit;
  if (editId) { startEdit(editId); return; }
  const delId = e.target.dataset.del;
  if (delId && confirm("Hapus video ini?")) {
    await deleteDoc(doc(db, "videos", delId));
    loadVideoTable();
  }
});
