// ============================================================
// NOKT HUB — Universal Embed Player
// Mendeteksi otomatis jenis URL dan merender player yang sesuai.
// Provider yang didukung: YouTube, Vimeo, Google Drive, MP4 langsung,
// dan fallback iframe generic untuk provider resmi lain yang
// mengizinkan embedding (mis. platform video milik institusi/CDN sendiri).
// ============================================================

export function detectEmbedType(url) {
  if (!url) return "unknown";
  const u = url.toLowerCase();
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "youtube";
  if (u.includes("vimeo.com")) return "vimeo";
  if (u.includes("drive.google.com")) return "gdrive";
  if (/\.(mp4|webm|ogg)(\?.*)?$/.test(u)) return "mp4";
  return "iframe"; // fallback generic — pastikan hanya untuk sumber berlisensi/milik sendiri
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
  const m = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/id=([a-zA-Z0-9_-]+)/);
  return m ? `https://drive.google.com/file/d/${m[1]}/preview` : url;
}

/**
 * Merender player ke dalam elemen container yang diberikan.
 * @param {HTMLElement} container
 * @param {string} embedUrl
 * @param {{autoplay?: boolean, resumeAt?: number}} opts
 */
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
    if (opts.resumeAt) video.currentTime = opts.resumeAt;
    container.appendChild(video);
    return video;
  }

  let src = embedUrl;
  if (type === "youtube") src = toYoutubeEmbed(embedUrl);
  else if (type === "vimeo") src = toVimeoEmbed(embedUrl);
  else if (type === "gdrive") src = toGDriveEmbed(embedUrl);

  const iframe = document.createElement("iframe");
  iframe.src = src + (opts.autoplay ? (src.includes("?") ? "&autoplay=1" : "?autoplay=1") : "");
  iframe.allow = "autoplay; fullscreen; picture-in-picture; encrypted-media";
  iframe.allowFullscreen = true;
  iframe.loading = "lazy";
  iframe.className = "nokt-iframe-el";
  container.appendChild(iframe);
  return iframe;
}

// Simpan posisi tonton (hanya berfungsi penuh untuk tipe mp4,
// karena provider iframe eksternal tidak selalu mengekspos currentTime).
export function trackResumePosition(videoEl, onTick) {
  if (!videoEl || videoEl.tagName !== "VIDEO") return;
  videoEl.addEventListener("timeupdate", () => {
    onTick(Math.floor(videoEl.currentTime));
  });
}
