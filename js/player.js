// ============================================================
// NOKT HUB — Universal Embed Player
// ============================================================

export function detectEmbedType(url) {
  if (!url) return "unknown";

  const u = url.toLowerCase().trim();

  // YouTube
  if (u.includes("youtube.com") || u.includes("youtu.be")) {
    return "youtube";
  }

  // Vimeo
  if (u.includes("vimeo.com")) {
    return "vimeo";
  }

  // Google Drive
  if (u.includes("drive.google.com")) {
    return "gdrive";
  }

  // Video langsung
  if (/\.(mp4|webm|ogg|m3u8)(\?.*)?$/i.test(u)) {
    return "mp4";
  }

  // Semua URL http/https selain di atas dianggap iframe
  if (u.startsWith("http://") || u.startsWith("https://")) {
    return "iframe";
  }

  return "unknown";
}

function toYoutubeEmbed(url) {
  let id = "";
  const short = url.match(/youtu\.be\/([a-zA-Z0-9_-]+)/);
  const long = url.match(/[?&]v=([a-zA-Z0-9_-]+)/);
  const embed = url.match(/embed\/([a-zA-Z0-9_-]+)/);

  if (short) id = short[1];
  else if (long) id = long[1];
  else if (embed) id = embed[1];

  return `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1`;
}

function toVimeoEmbed(url) {
  const m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  return m ? `https://player.vimeo.com/video/${m[1]}` : url;
}

function toGDriveEmbed(url) {
  const m =
    url.match(/\/d\/([a-zA-Z0-9_-]+)/) ||
    url.match(/id=([a-zA-Z0-9_-]+)/);

  return m
    ? `https://drive.google.com/file/d/${m[1]}/preview`
    : url;
}

export function renderPlayer(container, embedUrl, opts = {}) {
  const type = detectEmbedType(embedUrl);

  container.innerHTML = "";
  container.classList.add("player-wrap");

  if (type === "mp4") {
    const video = document.createElement("video");

    video.src = embedUrl;
    video.controls = true;
    video.playsInline = true;
    video.autoplay = !!opts.autoplay;
    video.className = "nokt-video-el";

    if (opts.resumeAt) {
      video.currentTime = opts.resumeAt;
    }

    container.appendChild(video);

    return video;
  }

  let src = embedUrl;

  if (type === "youtube") src = toYoutubeEmbed(embedUrl);
  if (type === "vimeo") src = toVimeoEmbed(embedUrl);
  if (type === "gdrive") src = toGDriveEmbed(embedUrl);

  if (opts.autoplay) {
    src += src.includes("?") ? "&autoplay=1" : "?autoplay=1";
  }

  const iframe = document.createElement("iframe");

  iframe.src = src;
  iframe.className = "nokt-iframe-el";
  iframe.loading = "lazy";
  iframe.allowFullscreen = true;

  // Dikunci: hanya izinkan skrip player berjalan, TANPA izin
  // membuka tab baru atau mengalihkan halaman induk — ini yang
  // menutup celah redirect/popunder dari provider seperti vid9.live.
 
  iframe.allow =
    "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen";

  container.appendChild(iframe);

  return iframe;
}

// ---------- Tracking posisi/durasi tonton (semua tipe player) ----------
// - <video> native: pakai event "timeupdate" (akurat, sesuai posisi asli).
// - <iframe> (YouTube/Vimeo/Gdrive/embed luar lain): browser tidak bisa
//   mengintip play-state di dalam iframe cross-origin, jadi dipakai
//   pendekatan "jam berjalan" via setInterval selama iframe masih
//   ada di DOM & tab masih aktif. Bukan 100% akurat (tidak tahu kalau
//   user pause di dalam iframe), tapi cukup untuk syarat minimal
//   nonton (MIN_WATCH_SECONDS) & anti-spam view di watch.js.
export function trackResumePosition(el, onTick) {
  if (!el) return;

  // --- Native <video> ---
  if (el.tagName === "VIDEO") {
    el.addEventListener("timeupdate", () => {
      onTick(Math.floor(el.currentTime));
    });
    return;
  }

  // --- <iframe> (YouTube/Vimeo/Gdrive/embed luar apa pun) ---
  if (el.tagName === "IFRAME") {
    let elapsed = 0;
    const TICK_MS = 1000; // update tiap 1 detik

    const timer = setInterval(() => {
      // Hanya hitung waktu selagi tab aktif & iframe masih ada di DOM,
      // supaya tidak nambah view saat user pindah tab / tutup halaman.
      if (document.hidden || !document.body.contains(el)) return;

      elapsed += 1;
      onTick(elapsed);
    }, TICK_MS);

    // Bersihkan interval saat iframe dilepas dari halaman (mis. pindah video)
    const cleanup = () => clearInterval(timer);
    window.addEventListener("beforeunload", cleanup);

    // Simpan referensi supaya bisa dibersihkan manual kalau perlu
    el._noktTrackCleanup = cleanup;

    return;
  }
}
