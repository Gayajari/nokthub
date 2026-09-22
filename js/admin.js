// ============================================================
// NOKT HUB — Admin Dashboard Logic
// ============================================================
import {
  auth, db, onAuthStateChanged, collection, doc, getDoc, getDocs, addDoc,
  setDoc, updateDoc, deleteDoc, query, where, orderBy, serverTimestamp,
  deleteField, resolveCategoryIcon, iconSvg, allIconIds, ICON_LIBRARY,
  uploadThumbnailToSupabase, deleteThumbnailFromSupabase
} from "./core.js";

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

const CROP_RATIOS = {
  "16:9": { ratio: 16 / 9, outW: 640, outH: 360 },
  "9:16": { ratio: 9 / 16, outW: 360, outH: 640 },
};

function getSelectedRatioKey() {
  const checked = document.querySelector('input[name="crop-ratio"]:checked');
  return checked ? checked.value : "16:9";
}

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
      const initialRatio = CROP_RATIOS[getSelectedRatioKey()].ratio;
      cropperInstance = new Cropper(img, { aspectRatio: initialRatio, viewMode: 1, autoCropArea: 1, background: false });
      pendingCropResolve = resolve;
    };
    reader.readAsDataURL(file);
  });
}

function initCropModalButtons() {
  const confirmBtn = document.getElementById("crop-confirm");
  const cancelBtn = document.getElementById("crop-cancel");
  const modal = document.getElementById("crop-modal");
  const ratioRadios = document.querySelectorAll('input[name="crop-ratio"]');
  if (!confirmBtn || !cancelBtn) return;

  ratioRadios.forEach(radio => {
    radio.addEventListener("change", () => {
      if (!cropperInstance) return;
      const key = getSelectedRatioKey();
      cropperInstance.setAspectRatio(CROP_RATIOS[key].ratio);
    });
  });

  confirmBtn.addEventListener("click", () => {
    if (!cropperInstance) return;
    const key = getSelectedRatioKey();
    const { outW, outH } = CROP_RATIOS[key];
    cropperInstance.getCroppedCanvas({ width: outW, height: outH }).toBlob((blob) => {
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
// BARU: setiap kali admin upload FILE thumbnail (lewat crop modal),
// file yang sama diupload ke DUA tempat sekaligus -- ImgBB (utama) dan
// Supabase Storage (cadangan). URL + path Supabase disimpan sementara
// di variabel currentThumbnailSupabase / currentSupabaseFilePath, baru
// benar-benar ditulis ke Firestore saat tombol Simpan/Update ditekan.
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

    // Thumbnail diganti secara manual (bukan lewat upload file) -- tidak
    // ada file untuk dibackup ke Supabase. Kosongkan supaya kalau video
    // ini sedang diedit dan sebelumnya punya backup, backup lama itu
    // akan dibersihkan saat disimpan (thumbnail dianggap "diganti").
    // Batalkan juga file yang mungkin sudah dipilih tapi belum diupload.
    currentThumbnailSupabase = "";
    currentSupabaseFilePath = "";
    pendingThumbnailBlob = null;
  });

  if (!fileInput) return;
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const cropped = await openCropModal(file);
    fileInput.value = "";
    if (!cropped) return;

    // ImgBB tetap upload LANGSUNG seperti perilaku lama (tidak diubah).
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

      // ---- Backup Supabase: DITUNDA, bukan diupload sekarang ----
      // Supaya tidak ada file "numpuk" di Supabase kalau admin batal /
      // pindah halaman / edit video lain sebelum sempat klik Simpan.
      // Blob hasil crop disimpan di memori saja; baru benar-benar
      // diupload ke Supabase pada saat tombol Simpan/Update ditekan
      // (lihat handler #btn-upload), sebagai bagian dari aksi yang
      // sama dengan penulisan ke Firestore.
      pendingThumbnailBlob = cropped;
      pendingThumbnailFileName = "thumbnail.jpg";
      status.textContent = "Berhasil diupload ke ImgBB. Backup Supabase akan diupload saat video disimpan.";
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

// ============================================================
// KOLASE 3-FOTO MANUAL (BARU) -- untuk video vertikal 9:16 (TikTok/
// Shorts) yang perlu tampil di frame 16:9 (homepage dkk, seperti
// YouTube). Admin pilih 3 foto (biasanya screenshot dari video),
// digabung jadi 1 gambar 16:9 berisi 3 potongan vertikal sama besar
// berdampingan. Dibuat manual (bukan ambil frame dari video secara
// otomatis) karena banyak host video tidak mengizinkan browser
// mengakses videonya langsung (CORS) -- upload file lokal tidak
// punya masalah itu sama sekali.
// ============================================================
const COLLAGE_WIDTH = 640;
const COLLAGE_HEIGHT = 360;
const COLLAGE_SLOT_WIDTH = COLLAGE_WIDTH / 3;

// Gambar "source" (image/canvas/video) ke area tujuan dengan cara
// object-fit:cover -- dipotong dari tengah supaya tidak gepeng/melar,
// mirip perilaku CSS "cover".
function drawCover(ctx, source, srcW, srcH, dx, dy, dWidth, dHeight) {
  const srcRatio = srcW / srcH;
  const dstRatio = dWidth / dHeight;
  let sx, sy, sw, sh;
  if (srcRatio > dstRatio) {
    sh = srcH; sw = sh * dstRatio; sx = (srcW - sw) / 2; sy = 0;
  } else {
    sw = srcW; sh = sw / dstRatio; sx = 0; sy = (srcH - sh) / 2;
  }
  ctx.drawImage(source, sx, sy, sw, sh, dx, dy, dWidth, dHeight);
}

function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => resolve(img);
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error(`Gagal membaca foto "${file.name}".`)); };
    img.src = objectUrl;
  });
}

async function generateManualCollage(files) {
  if (files.length !== 3) {
    throw new Error("Pilih tepat 3 foto (kiri, tengah, kanan).");
  }

  const canvas = document.createElement("canvas");
  canvas.width = COLLAGE_WIDTH;
  canvas.height = COLLAGE_HEIGHT;
  const ctx = canvas.getContext("2d");

  for (let i = 0; i < 3; i++) {
    const img = await loadImageFile(files[i]);
    drawCover(ctx, img, img.naturalWidth, img.naturalHeight, i * COLLAGE_SLOT_WIDTH, 0, COLLAGE_SLOT_WIDTH, COLLAGE_HEIGHT);
    URL.revokeObjectURL(img.src);
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Gagal membuat gambar kolase dari canvas."));
    }, "image/jpeg", 0.9);
  });
}

// Tombol "Gabung Jadi Kolase" -- ambil 3 file dari input foto, gabung,
// lalu masuk ke alur upload thumbnail yang SAMA seperti upload file
// biasa: ImgBB diupload langsung, backup Supabase DITUNDA (disimpan
// di pendingThumbnailBlob) sampai admin klik Simpan.
document.addEventListener("click", async (e) => {
  if (e.target.id !== "btn-generate-collage") return;
  const status = document.getElementById("collage-status");
  const urlInput = document.getElementById("f-thumb");
  const preview = document.getElementById("thumb-preview");
  const thumbStatus = document.getElementById("thumb-upload-status");

  const inputs = ["f-collage-1", "f-collage-2", "f-collage-3"].map(id => document.getElementById(id));
  const files = inputs.map(el => el.files[0]).filter(Boolean);

  if (files.length !== 3) {
    status.textContent = "Pilih 3 foto dulu (kiri, tengah, kanan) sebelum digabung.";
    return;
  }

  const btn = e.target;
  btn.disabled = true;
  status.textContent = "Menggabungkan 3 foto...";
  try {
    const collageBlob = await generateManualCollage(files);

    status.textContent = "Kolase dibuat. Mengupload ke ImgBB...";
    preview.innerHTML = "";
    const s = await getSiteSettings(true);
    const url = await uploadToHost(collageBlob, {
      endpoint: s.thumbEndpoint, apiKey: s.thumbApiKey, urlField: s.thumbField,
      fileFieldName: "image", authType: "query", fileName: "collage.jpg"
    });
    urlInput.value = url;
    preview.innerHTML = `<img src="${url}" alt="preview thumbnail kolase">`;

    // Backup Supabase ditunda, sama seperti upload thumbnail file biasa --
    // baru benar-benar diupload saat tombol Simpan/Update ditekan.
    pendingThumbnailBlob = collageBlob;
    pendingThumbnailFileName = "collage.jpg";

    status.textContent = "Kolase berhasil dibuat & diupload ke ImgBB.";
    thumbStatus.textContent = "";
    inputs.forEach(el => { el.value = ""; });
  } catch (err) {
    status.textContent = "Gagal membuat kolase: " + err.message;
  } finally {
    btn.disabled = false;
  }
});

// BARU: sekarang mengembalikan { url, supabaseUrl, supabasePath } alih-
// alih string URL polos, supaya thumbnail hasil auto-generate (dari
// frame video) juga bisa punya backup Supabase kalau memang ada file
// blob-nya. Untuk kasus static thumb (YouTube/Vimeo) atau thumbnail
// dari API host video, tidak ada file untuk dibackup -- supabaseUrl/
// supabasePath dikosongkan (aman, konsisten dengan kompatibilitas data
// lama yang memang boleh tidak punya backup).
async function autoGenerateThumbnail(embedUrl) {
  const staticThumb = extractAutoThumbFromEmbed(embedUrl);
  if (staticThumb) return { url: staticThumb, supabaseUrl: "", supabasePath: "" };

  const s = await getSiteSettings(true);

  const profile = findMatchingHostProfile(embedUrl, s.videoHostProfiles);
  if (profile) {
    const apiThumb = await fetchThumbnailFromHostProfile(embedUrl, profile);
    if (apiThumb) return { url: apiThumb, supabaseUrl: "", supabasePath: "" };
  }

  const isDirectVideoFile = /\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(embedUrl);
  if (isDirectVideoFile) {
    const blob = await captureFrameFromVideoUrl(embedUrl);
    if (blob) {
      try {
        const url = await uploadToHost(blob, {
          endpoint: s.thumbEndpoint, apiKey: s.thumbApiKey, urlField: s.thumbField,
          fileFieldName: "image", authType: "query", fileName: "auto-thumb.jpg"
        });
        let supabaseUrl = "", supabasePath = "";
        try {
          const backup = await uploadThumbnailToSupabase(blob, "auto-thumb.jpg");
          supabaseUrl = backup.url;
          supabasePath = backup.path;
        } catch (e) {
          // Backup gagal -- thumbnail utama (ImgBB) tetap dipakai,
          // cuma tidak punya cadangan Supabase untuk video ini.
        }
        return { url, supabaseUrl, supabasePath };
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

      <div class="form-grid full" style="margin-top:8px">
        <div class="form-grid full">
          <label>Domain Pengganti (isi HANYA kalau host ini baru saja pindah domain)</label>
          <input class="hp-replacement" value="${p.replacementDomain || ""}" placeholder="mis. playexa2s.app (kosongkan kalau domain masih sama)">
          <div class="field-hint" style="font-size:.75rem;color:var(--text-muted);margin-top:4px">
            Video yang link embed-nya cocok "Pola Domain" di atas akan otomatis dialihkan ke domain ini saat diputar — link asli di database TIDAK diubah.
          </div>
        </div>
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
    replacementDomain: row.querySelector(".hp-replacement").value.trim(),
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
  const iconId = select.value;
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
// KODE VIDEO 6 KARAKTER (link tonton: domain/w/kode)
// ============================================================
const VIDEO_CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const VIDEO_CODE_LENGTH = 6;

function randomVideoCode(len = VIDEO_CODE_LENGTH) {
  let out = "";
  while (out.length < len) {
    const buf = new Uint8Array(len * 2);
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b < 248 && out.length < len) out += VIDEO_CODE_CHARS[b % 62];
    }
  }
  return out;
}

async function generateUniqueVideoCode() {
  for (let i = 0; i < 10; i++) {
    const code = randomVideoCode();
    const snap = await getDoc(doc(db, "videos", code));
    if (!snap.exists()) return code;
  }
  throw new Error("Gagal membuat kode unik, coba lagi.");
}

// ============================================================
// FORM VIDEO
// ============================================================
let editingVideoId = null;

// BARU: state thumbnail backup Supabase untuk form yang sedang aktif.
// - currentThumbnailSupabase / currentSupabaseFilePath -> nilai yang
//   akan DITULIS ke Firestore saat Simpan/Update ditekan.
// - originalSupabaseFilePath -> nilai LAMA (dari dokumen sebelum
//   diedit), dipakai untuk tahu file mana yang perlu dihapus dari
//   Supabase kalau thumbnail benar-benar diganti.
let currentThumbnailSupabase = "";
let currentSupabaseFilePath = "";
let originalSupabaseFilePath = null;

// File thumbnail yang sudah dipilih+crop admin tapi BELUM diupload ke
// Supabase -- murni disimpan di memori browser sampai admin benar-benar
// klik Simpan/Update. Ini yang membuat Supabase "ngikutin dasbor admin":
// kalau tidak jadi disimpan, tidak pernah ada file yang masuk ke
// Supabase sama sekali, jadi tidak mungkin numpuk.
let pendingThumbnailBlob = null;
let pendingThumbnailFileName = "thumbnail.jpg";

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

  // Kompatibel dengan dokumen lama yang belum punya field Supabase --
  // kalau tidak ada, dianggap kosong/null (bukan error).
  currentThumbnailSupabase = v.thumbnail_supabase || "";
  currentSupabaseFilePath = v.supabase_file_path || "";
  originalSupabaseFilePath = v.supabase_file_path || null;
}

function resetForm() {
  editingVideoId = null;
  currentThumbnailSupabase = "";
  currentSupabaseFilePath = "";
  originalSupabaseFilePath = null;
  pendingThumbnailBlob = null;
  pendingThumbnailFileName = "thumbnail.jpg";
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
  // Batalkan file thumbnail yang mungkin belum sempat disimpan dari
  // form sebelumnya -- aman, karena belum pernah terupload ke Supabase.
  pendingThumbnailBlob = null;
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
    if (auto) {
      thumbnail = auto.url;
      currentThumbnailSupabase = auto.supabaseUrl || "";
      currentSupabaseFilePath = auto.supabasePath || "";
    }
    msg.textContent = "";
  }

  // Kalau upload ImgBB tidak pernah berhasil sama sekali (thumbnail
  // masih kosong setelah auto-generate juga gagal), video TETAP
  // disimpan tanpa thumbnail -- itu perilaku lama, tidak diubah.

  const btn = document.getElementById("btn-upload");
  btn.disabled = true;
  const prevLabel = btn.textContent;
  btn.textContent = editingVideoId ? "Memperbarui..." : "Menyimpan...";

  // ---- Upload Supabase yang DITUNDA, dieksekusi PERSIS di sini ----
  // Ini titik di mana admin sudah pasti menekan Simpan/Update, jadi
  // baru sekarang file benar-benar dikirim ke Supabase -- bukan saat
  // file dipilih. Kalau admin batal sebelum titik ini, tidak ada apa
  // pun yang pernah masuk ke Supabase.
  // uploadedThisRun dipakai untuk ROLLBACK: kalau ternyata penulisan ke
  // Firestore di bawah gagal, file yang baru saja diupload ini dihapus
  // lagi supaya tidak jadi sampah yang tidak tercatat di dasbor admin.
  let uploadedThisRun = null;
  if (pendingThumbnailBlob) {
    try {
      const backup = await uploadThumbnailToSupabase(pendingThumbnailBlob, pendingThumbnailFileName);
      currentThumbnailSupabase = backup.url;
      currentSupabaseFilePath = backup.path;
      uploadedThisRun = backup.path;
    } catch (backupErr) {
      currentThumbnailSupabase = "";
      currentSupabaseFilePath = "";
      msg.textContent = "Peringatan: backup Supabase gagal diupload (" + backupErr.message + "). Video tetap disimpan dengan thumbnail ImgBB saja.";
    }
    pendingThumbnailBlob = null;
  } else if (currentSupabaseFilePath && currentSupabaseFilePath !== originalSupabaseFilePath) {
    // Kasus auto-generate dari frame video (bukan lewat pilih file) --
    // upload Supabase-nya sudah terjadi di dalam autoGenerateThumbnail(),
    // tepat di alur simpan yang sama, jadi tetap konsisten dengan aturan
    // "hanya masuk Supabase kalau benar-benar disimpan".
    uploadedThisRun = currentSupabaseFilePath;
  }

  // Path Supabase LAMA yang perlu dibersihkan SETELAH data baru
  // berhasil tersimpan -- hanya kalau memang berbeda dari path baru
  // (artinya thumbnail benar-benar diganti).
  const pathToCleanup = (editingVideoId && originalSupabaseFilePath &&
    originalSupabaseFilePath !== currentSupabaseFilePath) ? originalSupabaseFilePath : null;

  try {
    if (editingVideoId) {
      await updateDoc(doc(db, "videos", editingVideoId), {
        title, slug: slugify(title), description, category, tags,
        thumbnail,
        thumbnail_supabase: currentThumbnailSupabase,
        supabase_file_path: currentSupabaseFilePath,
        embedUrl, status, adminName,
        seoTitle, seoDescription, metaKeywords
      });
      await upsertCategory(category);
      await upsertTags(tags);
      msg.textContent = "Video berhasil diupdate.";
    } else {
      const code = await generateUniqueVideoCode();
      await setDoc(doc(db, "videos", code), {
        title, slug: slugify(title), description, category, tags,
        thumbnail,
        thumbnail_supabase: currentThumbnailSupabase,
        supabase_file_path: currentSupabaseFilePath,
        embedUrl, status, uploadedAt: serverTimestamp(), adminName,
        seoTitle, seoDescription, metaKeywords,
        viewCount: 0, likeCount: 0, shareCount: 0, searchTagCount: 0
      });
      await upsertCategory(category);
      await upsertTags(tags);
      msg.textContent = "Video berhasil disimpan.";
    }

    // Bersihkan backup Supabase LAMA -- dilakukan SETELAH data baru
    // pasti tersimpan, supaya tidak ada state rusak di tengah jalan
    // kalau proses ini gagal di tengah.
    if (pathToCleanup) {
      try {
        await deleteThumbnailFromSupabase(pathToCleanup);
      } catch (cleanupErr) {
        msg.textContent += " (Peringatan: backup thumbnail lama di Supabase gagal dihapus — " + cleanupErr.message + ")";
      }
    }

    resetForm();
    loadVideoTable();
  } catch (err) {
    msg.textContent = "Gagal menyimpan: " + err.message;
    // ROLLBACK: kalau sempat berhasil upload ke Supabase di run ini tapi
    // penulisan Firestore-nya gagal, hapus lagi file itu -- supaya tidak
    // ada file yang "nyangkut" di Supabase tanpa video yang menyimpannya.
    if (uploadedThisRun) {
      try {
        await deleteThumbnailFromSupabase(uploadedThisRun);
      } catch (rollbackErr) {
        msg.textContent += " (Peringatan: gagal membersihkan file Supabase yang sempat terupload — " + rollbackErr.message + ")";
      }
    }
  } finally {
    btn.disabled = false;
    btn.textContent = prevLabel;
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

// BARU: sebelum menghapus dokumen video, ambil dulu supabase_file_path
// dan hapus file cadangannya dari Supabase Storage. Dokumen lama yang
// tidak punya field ini dilewati begitu saja (tidak error). Kalau hapus
// file Supabase gagal, admin diberi tahu lewat alert -- tapi dokumen
// video TETAP dihapus (tidak dibiarkan "nyangkut" gara-gara ini).
document.addEventListener("click", async (e) => {
  const editId = e.target.dataset.edit;
  if (editId) { startEdit(editId); return; }
  const delId = e.target.dataset.del;
  if (delId && confirm("Hapus video ini?")) {
    const btn = e.target;
    const prevLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Menghapus...";
    try {
      const snap = await getDoc(doc(db, "videos", delId));
      const supabasePath = snap.exists() ? (snap.data().supabase_file_path || null) : null;

      if (supabasePath) {
        try {
          await deleteThumbnailFromSupabase(supabasePath);
        } catch (cleanupErr) {
          alert("Backup thumbnail di Supabase gagal dihapus (" + cleanupErr.message + "). Dokumen video tetap akan dihapus.");
        }
      }

      await deleteDoc(doc(db, "videos", delId));
      loadVideoTable();
    } catch (err) {
      alert("Gagal menghapus video: " + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = prevLabel;
    }
  }
});
