// ============================================================
// NOKT HUB — Admin Dashboard Logic
// ============================================================
import {
  auth, db, onAuthStateChanged, collection, doc, getDoc, getDocs, addDoc,
  setDoc, updateDoc, deleteDoc, query, where, orderBy, serverTimestamp,
  deleteField
} from "./firebase-config.js";
import { resolveCategoryIcon, iconSvg, allIconIds, ICON_LIBRARY } from "./icons.js";

function slugify(str) {
  return str.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

// ============================================================
// NORMALISASI LINK THUMBNAIL MANUAL
// Banyak link "gambar" yang ditempel orang sebenarnya link halaman
// viewer (Google Drive, Dropbox, dll), bukan link file gambar langsung.
// Fungsi ini kenali pola-pola umum dan ubah otomatis jadi link
// langsung yang bisa dipakai di <img src>. Kalau polanya tidak
// dikenali (termasuk link ImgBB/CDN yang memang sudah direct),
// link dipakai apa adanya tanpa diubah.
// ============================================================
function normalizeThumbLink(url) {
  if (!url) return url;
  const trimmed = url.trim();

  // Google Drive: /file/d/ID/view , open?id=ID , uc?id=ID -> uc?export=view&id=ID
  const gdrive = trimmed.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/)
              || trimmed.match(/drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/)
              || trimmed.match(/drive\.google\.com\/uc\?id=([a-zA-Z0-9_-]+)/);
  if (gdrive) return `https://drive.google.com/uc?export=view&id=${gdrive[1]}`;

  // Dropbox: ...?dl=0 -> ...?raw=1 (biar langsung tampil, bukan halaman preview)
  if (trimmed.includes("dropbox.com")) {
    if (trimmed.includes("dl=0")) return trimmed.replace("dl=0", "raw=1");
    if (!trimmed.includes("raw=1") && !trimmed.includes("dl=1")) {
      return trimmed + (trimmed.includes("?") ? "&raw=1" : "?raw=1");
    }
  }

  return trimmed; // sudah direct (ImgBB, CDN, dst) atau polanya belum dikenali
}

// ============================================================
// UPLOAD GENERIK
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

async function uploadToHost(fileOrBlob, config) {
  const { endpoint, apiKey, urlField, fileFieldName = "file", authType = "query", fileName } = config;
  if (!endpoint || !apiKey) {
    throw new Error("Endpoint atau API key host ini belum diisi lengkap di Pengaturan.");
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
    throw new Error("URL tidak ditemukan di respons API. Cek isian 'Field URL di Respons' pada host ini.");
  }
  return resultUrl;
}

async function pollUploadStatus(idOrUrl, statusConfig) {
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
// CROP/ZOOM THUMBNAIL (Cropper.js via CDN di dashboard.html)
// ============================================================
let cropperInstance = null;
let pendingCropResolve = null;

function openCropModal(file) {
  return new Promise((resolve) => {
    const modal = document.getElementById("crop-modal");
    const img = document.getElementById("crop-image");
    if (!modal || !img || typeof Cropper === "undefined") {
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
    pendingCropResolve?.(null);
    pendingCropResolve = null;
  });
}

// ---------- Upload Thumbnail (manual link ATAU upload file + crop) ----------
function initThumbUpload() {
  const fileInput = document.getElementById("f-thumb-file");
  const urlInput = document.getElementById("f-thumb");
  const preview = document.getElementById("thumb-preview");
  const status = document.getElementById("thumb-upload-status");
  if (!urlInput) return;

  urlInput.addEventListener("change", () => {
    const normalized = normalizeThumbLink(urlInput.value.trim());
    urlInput.value = normalized;
    preview.innerHTML = normalized ? `<img src="${normalized}" alt="preview thumbnail">` : "";
  });

  if (!fileInput) return;
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const cropped = await openCropModal(file);
    fileInput.value = "";
    if (!cropped) return;

    status.textContent = "Mengupload gambar...";
    preview.innerHTML = "";
    try {
      const s = await getSiteSettings(true);
      const url = await uploadToHost(cropped, {
        endpoint: s.thumbEndpoint, apiKey: s.thumbApiKey, urlField: s.thumbField,
        fileFieldName: "image", authType: "query", fileName: "thumbnail.jpg"
      });
      urlInput.value = url;
      preview.innerHTML = `<img src="${url}" alt="preview thumbnail">`;
      status.textContent = "Berhasil diupload.";
    } catch (err) {
      status.textContent = "Gagal upload: " + err.message;
    }
  });
}

// ============================================================
// AUTO-THUMBNAIL MULTI-HOST
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

function findMatchingHostProfile(embedUrl, profiles) {
  if (!embedUrl || !Array.isArray(profiles)) return null;
  return profiles.find(p => {
    if (!p.domainPattern) return false;
    try { return new RegExp(p.domainPattern, "i").test(embedUrl); }
    catch (e) { return false; }
  }) || null;
}

function extractCodeFromEmbed(embedUrl, codePattern) {
  if (!embedUrl || !codePattern) return null;
  try {
    const re = new RegExp(codePattern);
    const m = embedUrl.match(re);
    return m ? m[1] : null;
  } catch (e) { return null; }
}

async function fetchThumbnailFromHostProfile(embedUrl, profile) {
  const code = extractCodeFromEmbed(embedUrl, profile.codePattern);
  if (!code) return null;
  try {
    const sep = profile.infoEndpoint.includes("?") ? "&" : "?";
    const paramName = profile.codeParam || "file_code";
    const url = `${profile.infoEndpoint}${sep}key=${encodeURIComponent(profile.apiKey || "")}&${paramName}=${encodeURIComponent(code)}`;
    const res = await fetch(url);
    const data = await res.json();
    return getByPath(data, profile.thumbField || "result.0.player_img") || null;
  } catch (e) {
    return null;
  }
}

function captureFrameFromVideoUrl(url) {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "auto";
    video.src = url;

    video.addEventListener("loadeddata", () => {
      try { video.currentTime = Math.min(1, (video.duration || 2) / 2); }
      catch (e) { resolve(null); }
    });
    video.addEventListener("seeked", () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 360;
        canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.85);
      } catch (e) { resolve(null); }
    });
    video.addEventListener("error", () => resolve(null));
    setTimeout(() => resolve(null), 8000);
  });
}

async function autoGenerateThumbnail(embedUrl) {
  const staticThumb = extractAutoThumbFromEmbed(embedUrl);
  if (staticThumb) return staticThumb;

  const s = await getSiteSettings(true);

  const profile = findMatchingHostProfile(embedUrl, s.videoHostProfiles);
  if (profile) {
    const apiThumb = await fetchThumbnailFromHostProfile(embedUrl, profile);
    if (apiThumb) return apiThumb;
  }

  const isDirectVideoFile = /\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(embedUrl);
  if (isDirectVideoFile) {
    const blob = await captureFrameFromVideoUrl(embedUrl);
    if (blob) {
      try {
        return await uploadToHost(blob, {
          endpoint: s.thumbEndpoint, apiKey: s.thumbApiKey, urlField: s.thumbField,
          fileFieldName: "image", authType: "query", fileName: "auto-thumb.jpg"
        });
      } catch (e) { return null; }
    }
  }
  return null;
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

    const s = await getSiteSettings(true);
    const profiles = Array.isArray(s.videoHostProfiles) ? s.videoHostProfiles : [];
    const activeHost = profiles.find(p => p.name === s.activeUploadHostName);

    if (!activeHost) {
      status.textContent = "Belum ada host video yang dijadikan aktif untuk upload. Atur dulu di tab Pengaturan → Daftar Host Video.";
      return;
    }
    if (!activeHost.uploadEndpoint || !activeHost.apiKey) {
      status.textContent = `Endpoint/API key upload untuk "${activeHost.name}" belum lengkap di Pengaturan.`;
      return;
    }

    status.textContent = `Mengupload video ke ${activeHost.name}...`;
    try {
      let url = await uploadToHost(file, {
        endpoint: activeHost.uploadEndpoint,
        apiKey: activeHost.apiKey,
        urlField: activeHost.uploadUrlField,
        fileFieldName: "file",
        authType: activeHost.uploadAuthType || "query",
        fileName: file.name
      });

      if (activeHost.uploadStatusEndpoint) {
        status.textContent = "Video sedang diproses server, mohon tunggu...";
        url = await pollUploadStatus(url, {
          statusEndpoint: activeHost.uploadStatusEndpoint,
          apiKey: activeHost.apiKey,
          authType: activeHost.uploadAuthType || "query",
          urlField: activeHost.uploadUrlField,
          statusField: activeHost.uploadStatusField,
          readyValue: activeHost.uploadReadyValue || "ready"
        });
      }

      embedInput.value = url;
      status.textContent = `Video berhasil diupload ke ${activeHost.name}, link embed terisi otomatis.`;
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
  loadPageEditor(document.getElementById("p-slug")?.value || "contact");
});

function initTabs() {
  document.querySelectorAll(".sidebar a[data-tab]").forEach(link => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      document.querySelectorAll(".sidebar a[data-tab]").forEach(a => a.classList.remove("active"));
      link.classList.add("active");
      ["upload", "videos", "settings", "pages"].forEach(t => {
        document.getElementById(`tab-${t}`).style.display = t === link.dataset.tab ? "block" : "none";
      });
      // Kelola Ikon Kategori cukup dimuat sekali saat tab Pengaturan dibuka
      // (bukan setiap render), supaya tidak nge-fetch Firestore berulang
      // tiap ganti-ganti tab kalau isinya belum berubah.
      if (link.dataset.tab === "settings") loadCategoryIconManager();
    });
  });
}

// ============================================================
// PENGATURAN + Daftar Host Video terpadu
// ============================================================
let hostProfilesState = [];
let activeUploadHostName = "";

function renderHostProfilesTable() {
  const wrap = document.getElementById("video-host-list");
  if (!wrap) return;
  wrap.innerHTML = hostProfilesState.map((p, i) => `
    <div class="host-profile-row" data-i="${i}" style="border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:12px">
      <div class="form-grid">
        <div><label>Nama Host</label><input class="hp-name" value="${p.name || ""}" placeholder="mis. Vidara"></div>
        <div><label>Pola Domain (regex)</label><input class="hp-domain" value="${p.domainPattern || ""}" placeholder="mis. vidara\\.to"></div>
      </div>

      <div class="form-grid full" style="margin-top:10px"><label style="margin-bottom:0;font-weight:600">Untuk Auto-Thumbnail</label></div>
      <div class="form-grid">
        <div><label>Endpoint Info Video</label><input class="hp-endpoint" value="${p.infoEndpoint || ""}" placeholder="https://api.vidara.so/v1/file/info"></div>
        <div><label>API Key Host Ini</label><input class="hp-apikey" value="${p.apiKey || ""}" placeholder="API key dari akun host ini"></div>
        <div><label>Nama Parameter File Code</label><input class="hp-codeparam" value="${p.codeParam || ""}" placeholder="mis. file_code"></div>
        <div><label>Pola Ambil File Code dari Link (regex)</label><input class="hp-codepattern" value="${p.codePattern || ""}" placeholder="mis. /e/([a-zA-Z0-9]+)"></div>
        <div class="form-grid full"><label>Field Thumbnail di Respons</label><input class="hp-thumbfield" value="${p.thumbField || ""}" placeholder="mis. result.0.player_img"></div>
      </div>

      <div class="form-grid full" style="margin-top:10px"><label style="margin-bottom:0;font-weight:600">Untuk Upload Video dari Galeri</label></div>
      <div class="form-grid">
        <div><label>Endpoint Upload Video</label><input class="hp-upload-endpoint" value="${p.uploadEndpoint || ""}" placeholder="https://api.vidara.so/v1/upload"></div>
        <div><label>API Key Dikirim Sebagai</label>
          <select class="hp-upload-authtype">
            <option value="query" ${p.uploadAuthType !== "header" ? "selected" : ""}>Query Param</option>
            <option value="header" ${p.uploadAuthType === "header" ? "selected" : ""}>Header (Bearer/AccessKey)</option>
          </select>
        </div>
        <div><label>Field URL Video di Respons</label><input class="hp-upload-urlfield" value="${p.uploadUrlField || ""}" placeholder="mis. result.0.embed_url"></div>
        <div><label>Endpoint Cek Status (opsional)</label><input class="hp-upload-status-endpoint" value="${p.uploadStatusEndpoint || ""}"></div>
        <div><label>Field Status di Respons</label><input class="hp-upload-status-field" value="${p.uploadStatusField || ""}" placeholder="mis. status"></div>
        <div><label>Nilai Status "Siap"</label><input class="hp-upload-ready-value" value="${p.uploadReadyValue || ""}" placeholder="mis. ready"></div>
      </div>

      <label style="margin-top:10px;display:flex;align-items:center;gap:6px;cursor:pointer">
        <input type="radio" name="active-upload-host" class="hp-active-upload" style="width:auto" ${p.name && p.name === activeUploadHostName ? "checked" : ""}>
        Jadikan host ini aktif untuk "Upload Video dari Galeri"
      </label>

      <button type="button" class="share-btn hp-remove" style="margin-top:10px">Hapus Host Ini</button>
    </div>`).join("") || `<p style="color:var(--text-muted);font-size:.82rem">Belum ada host video ditambahkan.</p>`;
}

function collectHostProfilesFromUI() {
  const rows = document.querySelectorAll("#video-host-list .host-profile-row");
  return Array.from(rows).map(row => ({
    name: row.querySelector(".hp-name").value.trim(),
    domainPattern: row.querySelector(".hp-domain").value.trim(),
    infoEndpoint: row.querySelector(".hp-endpoint").value.trim(),
    apiKey: row.querySelector(".hp-apikey").value.trim(),
    codeParam: row.querySelector(".hp-codeparam").value.trim(),
    codePattern: row.querySelector(".hp-codepattern").value.trim(),
    thumbField: row.querySelector(".hp-thumbfield").value.trim(),
    uploadEndpoint: row.querySelector(".hp-upload-endpoint").value.trim(),
    uploadAuthType: row.querySelector(".hp-upload-authtype").value,
    uploadUrlField: row.querySelector(".hp-upload-urlfield").value.trim(),
    uploadStatusEndpoint: row.querySelector(".hp-upload-status-endpoint").value.trim(),
    uploadStatusField: row.querySelector(".hp-upload-status-field").value.trim(),
    uploadReadyValue: row.querySelector(".hp-upload-ready-value").value.trim()
  })).filter(p => p.name || p.domainPattern);
}

function getActiveUploadHostNameFromUI() {
  const checked = document.querySelector("#video-host-list .hp-active-upload:checked");
  if (!checked) return "";
  const row = checked.closest(".host-profile-row");
  return row.querySelector(".hp-name").value.trim();
}

document.addEventListener("click", (e) => {
  if (e.target.id === "btn-add-host-profile") {
    hostProfilesState.push({});
    renderHostProfilesTable();
  }
  if (e.target.classList.contains("hp-remove")) {
    const row = e.target.closest(".host-profile-row");
    const i = parseInt(row.dataset.i, 10);
    hostProfilesState.splice(i, 1);
    renderHostProfilesTable();
  }
});

async function loadSettings() {
  const s = await getSiteSettings(true);
  const map = {
    "s-name": s.siteName, "s-logo": s.logoUrl, "s-favicon": s.favicon,
    "s-theme": s.themeColor, "s-email": s.contactEmail, "s-dmca-email": s.dmcaEmail, "s-ga": s.gaId,
    "s-thumb-api-key": s.thumbApiKey, "s-thumb-endpoint": s.thumbEndpoint, "s-thumb-field": s.thumbField,
    "s-default-thumb": s.defaultThumbnail
  };
  Object.entries(map).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el && val) el.value = val;
  });

  // Checkbox "Matikan SEMUA ikon kategori" -- terpisah dari map di atas
  // karena checkbox pakai .checked, bukan .value.
  const hideIconsEl = document.getElementById("s-hide-category-icons");
  if (hideIconsEl) hideIconsEl.checked = !!s.hideCategoryIcons;

  hostProfilesState = Array.isArray(s.videoHostProfiles) ? s.videoHostProfiles : [];
  activeUploadHostName = s.activeUploadHostName || "";
  renderHostProfilesTable();
}

document.addEventListener("click", async (e) => {
  if (e.target.id !== "btn-save-settings") return;
  const val = (id) => document.getElementById(id)?.value.trim() || "";
  const hideCategoryIcons = !!document.getElementById("s-hide-category-icons")?.checked;
  await setDoc(doc(db, "settings", "site"), {
    siteName: val("s-name"), logoUrl: val("s-logo"), favicon: val("s-favicon"),
    themeColor: val("s-theme"), contactEmail: val("s-email"), dmcaEmail: val("s-dmca-email"), gaId: val("s-ga"),
    thumbApiKey: val("s-thumb-api-key"), thumbEndpoint: val("s-thumb-endpoint"), thumbField: val("s-thumb-field"),
    defaultThumbnail: val("s-default-thumb"),
    videoHostProfiles: collectHostProfilesFromUI(),
    activeUploadHostName: getActiveUploadHostNameFromUI(),
    hideCategoryIcons
  }, { merge: true });
  settingsCache = null;
  // Sinkronkan juga ke cache localStorage supaya categories.js di
  // halaman lain langsung ikut perubahan tanpa nunggu Firestore round-
  // trip (sama seperti mekanisme cache nama/warna situs yang sudah ada).
  try {
    const cached = JSON.parse(localStorage.getItem("nokt_settings_cache") || "null") || {};
    cached.hideCategoryIcons = hideCategoryIcons;
    localStorage.setItem("nokt_settings_cache", JSON.stringify(cached));
  } catch (e) {}
  alert("Pengaturan tersimpan.");
});

// ============================================================
// KELOLA IKON KATEGORI (manual, opsional)
// ============================================================
async function loadCategoryIconManager() {
  const wrap = document.getElementById("category-icon-manager");
  if (!wrap) return;

  wrap.innerHTML = `<p style="color:var(--text-muted);font-size:.8rem">Memuat kategori...</p>`;

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
        <span class="cat-icon-preview" style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--text)">${iconSvg(currentIcon)}</span>
        <span style="flex:1;font-size:.88rem">${cat.name}</span>
        <select class="cat-icon-select" data-slug="${cat.slug}" data-name="${cat.name}" style="width:auto;background:var(--surface);border:1px solid var(--border);color:var(--text);padding:6px 8px;border-radius:6px;font-size:.8rem">
          <option value="">Otomatis (tebak dari nama)</option>
          ${allIconIds().map(id => `
            <option value="${id}" ${isManual && cat.icon === id ? "selected" : ""}>${ICON_LIBRARY[id].label}</option>
          `).join("")}
        </select>
        <span class="cat-icon-status" data-slug="${cat.slug}" style="font-size:.72rem;color:var(--accent);min-width:60px"></span>
      </div>`;
  }).join("");
}

document.addEventListener("change", async (e) => {
  if (!e.target.classList.contains("cat-icon-select")) return;
  const select = e.target;
  const slug = select.dataset.slug;
  const catName = select.dataset.name;
  const iconId = select.value; // "" = balik ke otomatis
  const row = select.closest(".cat-icon-row");
  const statusEl = row.querySelector(".cat-icon-status");
  const previewEl = row.querySelector(".cat-icon-preview");

  try {
    if (iconId) {
      await updateDoc(doc(db, "categories", slug), { icon: iconId });
    } else {
      await updateDoc(doc(db, "categories", slug), { icon: deleteField() });
    }
    const resolved = resolveCategoryIcon({ slug, name: catName, icon: iconId || undefined });
    if (previewEl) previewEl.innerHTML = iconSvg(resolved);
    if (statusEl) {
      statusEl.textContent = "Tersimpan ✓";
      setTimeout(() => { statusEl.textContent = ""; }, 1500);
    }
  } catch (err) {
    if (statusEl) statusEl.textContent = "Gagal: " + err.message;
  }
});

// ============================================================
// KELOLA HALAMAN STATIS (Kontak, Privacy Policy, Terms, DMCA, Disclaimer)
// ============================================================
const STATIC_PAGE_DEFAULT_TITLES = {
  "contact": "Kontak",
  "privacy-policy": "Privacy Policy",
  "terms": "Terms",
  "dmca": "DMCA",
  "disclaimer": "Disclaimer"
};

async function loadPageEditor(slug) {
  const titleInput = document.getElementById("p-title");
  const contentInput = document.getElementById("p-content");
  const msg = document.getElementById("page-msg");
  if (!titleInput || !contentInput) return;
  msg.textContent = "";
  const snap = await getDoc(doc(db, "pages", slug));
  if (snap.exists()) {
    const d = snap.data();
    titleInput.value = d.title || STATIC_PAGE_DEFAULT_TITLES[slug] || "";
    contentInput.value = d.content || "";
  } else {
    titleInput.value = STATIC_PAGE_DEFAULT_TITLES[slug] || "";
    contentInput.value = "";
  }
}

document.addEventListener("change", (e) => {
  if (e.target.id === "p-slug") loadPageEditor(e.target.value);
});

document.addEventListener("click", async (e) => {
  if (e.target.id !== "btn-save-page") return;
  const slug = document.getElementById("p-slug").value;
  const title = document.getElementById("p-title").value.trim();
  const content = document.getElementById("p-content").value;
  const msg = document.getElementById("page-msg");
  try {
    await setDoc(doc(db, "pages", slug), { title, content, updatedAt: serverTimestamp() }, { merge: true });
    msg.textContent = "Halaman berhasil disimpan.";
  } catch (err) {
    msg.textContent = "Gagal menyimpan: " + err.message;
  }
});

// ============================================================
// KATEGORI & TAG
// ============================================================
async function upsertCategory(name) {
  if (!name) return;
  const slug = slugify(name);
  const ref = doc(db, "categories", slug);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, { name, slug, videoCount: 1 });
  } else {
    // FIX: sebelumnya updateDoc hanya kirim videoCount -- ini aman,
    // updateDoc TIDAK menghapus field lain yang sudah ada (termasuk
    // `icon` manual yang mungkin sudah dipilih admin), jadi ikon manual
    // tetap tersimpan walau video baru terus ditambahkan ke kategori ini.
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
  let thumbnail = normalizeThumbLink(document.getElementById("f-thumb").value.trim());
  const embedUrl = document.getElementById("f-embed").value.trim();
  const seoTitle = document.getElementById("f-seo-title").value.trim();
  const seoDescription = document.getElementById("f-seo-desc").value.trim();
  const metaKeywords = document.getElementById("f-keywords").value.trim();
  const adminName = document.getElementById("f-admin-name").value.trim();
  const msg = document.getElementById("upload-msg");

  if (!title || !embedUrl) { msg.textContent = "Judul dan Link Embed wajib diisi."; return; }

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
