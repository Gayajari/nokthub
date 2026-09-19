// ============================================================
// NOKT HUB — Ads Module (Adsterra) — Sandboxed ad slots
// ============================================================
const AD_UNITS = {
  banner320x50: { key: "f7e12447bffcb6a5de5da6511606b3b1", width: 320, height: 50 },
  banner300x250: { key: "01c9679d602b9111028c86f0400a8eef", width: 300, height: 250 },
  native: { containerId: "container-3b1b55ee4183e6526d08a0c286844beb", src: "https://inputoppose.com/3b1b55ee4183e6526d08a0c286844beb/invoke.js" }
};

function buildBannerSrcdoc(unit) {
  return `<!DOCTYPE html><html><head><style>html,body{margin:0;padding:0;overflow:hidden;background:transparent;}</style></head>
  <body>
    <script>atOptions = { 'key':'${unit.key}', 'format':'iframe', 'height':${unit.height}, 'width':${unit.width}, 'params':{} };<\/script>
    <script src="https://inputoppose.com/${unit.key}/invoke.js"><\/script>
  </body></html>`;
}

// Native banner: srcdoc polos, tidak ada logic ukur-ukur di dalamnya
// sama sekali. Kepastian ukurannya (mobile maupun desktop) ditangani
// di luar lewat angka tinggi TETAP yang dites manual (lihat
// renderNativeBanner) -- bukan diukur otomatis via postMessage, karena
// itu race condition dan hasilnya tidak konsisten (kadang kepotong
// kadang pas, tergantung kecepatan render).
function buildNativeSrcdoc(unit) {
  return `<!DOCTYPE html><html><head><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden;}</style></head>
  <body>
    <div id="${unit.containerId}"></div>
    <script async data-cfasync="false" src="${unit.src}"><\/script>
  </body></html>`;
}

function mountAdIframe(container, srcdocHtml, widthCss, heightCss) {
  if (!container) return null;
  const iframe = document.createElement("iframe");
  iframe.srcdoc = srcdocHtml;
  iframe.style.cssText = `width:${widthCss};height:${heightCss};border:0;display:block;margin:0 auto;`;
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups");
  iframe.setAttribute("scrolling", "no");
  iframe.setAttribute("loading", "lazy");
  container.innerHTML = "";
  container.appendChild(iframe);
  return iframe;
}

export function renderBanner300x250(containerId) {
  mountAdIframe(document.getElementById(containerId), buildBannerSrcdoc(AD_UNITS.banner300x250), "300px", "250px");
}

// Native banner -- SAMA-SAMA pakai angka tinggi tetap yang dites manual
// (bukan diukur otomatis lewat postMessage/timing, karena itu race
// condition -- kadang render lebih lambat/cepat dari perkiraan, jadi
// hasilnya kadang kepotong kadang pas, persis seperti yang kejadian).
//  - MOBILE (lebar < 900px): ruang lega (500px) di dalam + dibungkus
//    overflow:hidden dengan tinggi TETAP (cropHeightMobile) pas di
//    batas bawah 1 kartu.
//  - DESKTOP (lebar >= 900px): TIDAK dibungkus crop (mau tampil semua
//    4 kartu, bukan dipotong) -- cuma dikasih tinggi tetap
//    (desktopHeight) yang harus cukup lega menampung 4 kartu.
//
// CARA CARI ANGKA YANG PAS (manual, sekali saja, sama untuk mobile & desktop):
//  1. Buka halaman di device/browser sungguhan (bukan cuma DevTools
//     device-mode, karena lebar render bisa beda).
//  2. Sementara naikkan dulu angkanya jadi besar (misal 700 buat mobile,
//     1200 buat desktop) biar kartu pasti tidak kepotong dulu.
//  3. Ukur/kira-kira di titik berapa px pas batas bawah kartu terakhir
//     (kartu ke-1 utk mobile, kartu ke-4 utk desktop) berakhir.
//  4. Ganti nilai default di bawah (atau parameter saat memanggil
//     renderNativeBanner) dengan angka itu, kasih sedikit +buffer
//     (10-20px) biar aman.
const NATIVE_DESKTOP_BREAKPOINT = 900;
const NATIVE_MOBILE_INNER_HEIGHT = 500;    // ruang lega di dalam iframe (mobile)
const NATIVE_MOBILE_CROP_DEFAULT = 340;    // tinggi pas 1 kartu (mobile) -- sudah dites & sesuai
const NATIVE_DESKTOP_HEIGHT_DEFAULT = 250; // tinggi tetap desktop -- PERLU DITES ULANG, ini perkiraan awal

export function renderNativeBanner(containerId, cropHeightMobile, desktopHeight) {
  const el = document.getElementById(containerId);
  if (!el) return;

  const isDesktop = window.innerWidth >= NATIVE_DESKTOP_BREAKPOINT;
  el.innerHTML = "";

  const iframe = document.createElement("iframe");
  iframe.srcdoc = buildNativeSrcdoc(AD_UNITS.native);
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups");
  iframe.setAttribute("scrolling", "no");
  iframe.setAttribute("loading", "lazy");

  if (!isDesktop) {
    // MOBILE: ruang lega + crop tetap (sudah pas, tidak diubah).
    iframe.style.cssText = `width:100%;height:${NATIVE_MOBILE_INNER_HEIGHT}px;border:0;display:block;`;
    const crop = document.createElement("div");
    crop.style.cssText = `width:100%;height:${cropHeightMobile || NATIVE_MOBILE_CROP_DEFAULT}px;overflow:hidden;border-radius:12px;`;
    crop.appendChild(iframe);
    el.appendChild(crop);
    return;
  }

  // DESKTOP: tinggi tetap, tidak di-crop (mau tampil semua 4 kartu).
  iframe.style.cssText = `width:100%;height:${desktopHeight || NATIVE_DESKTOP_HEIGHT_DEFAULT}px;border:0;display:block;`;
  el.appendChild(iframe);
}

// Sticky banner 320x50 di bawah layar (mobile), bisa ditutup pengunjung
export function mountStickyMobileBanner() {
  if (window.innerWidth > 768) return;
  if (document.getElementById("nokt-sticky-ad")) return;
  const bar = document.createElement("div");
  bar.id = "nokt-sticky-ad";
  bar.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:999;display:flex;align-items:center;justify-content:center;background:#0A0A0B;border-top:1px solid rgba(255,255,255,.08);padding:2px 0;";
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "✕";
  closeBtn.setAttribute("aria-label", "Tutup iklan");
  closeBtn.style.cssText = "position:absolute;right:4px;top:-14px;width:22px;height:22px;border-radius:50%;border:1px solid #333;background:#111;color:#aaa;font-size:11px;cursor:pointer;line-height:1;";
  closeBtn.addEventListener("click", () => { bar.remove(); document.body.style.paddingBottom = ""; });
  const slot = document.createElement("div");
  bar.appendChild(slot); bar.appendChild(closeBtn);
  document.body.appendChild(bar);
  mountAdIframe(slot, buildBannerSrcdoc(AD_UNITS.banner320x50), "320px", "50px");
  document.body.style.paddingBottom = "58px";
}

// Sisip Native Banner otomatis tiap N video di dalam grid — "mengintai" grid
// pakai MutationObserver, jadi TIDAK PERLU ubah app.js/listing.js/watch.js
// sama sekali. Aman berdampingan dengan render video yang sudah ada.
export function injectGridAds(gridSelector, interval = 8) {
  const grid = document.querySelector(gridSelector);
  if (!grid) return;
  let seq = 0;
  const scan = () => {
    const cards = Array.from(grid.children).filter(el => !el.classList.contains("nokt-ad-slot"));
    cards.forEach((card, i) => {
      const position = i + 1;
      if (position % interval === 0) {
        const already = card.nextElementSibling && card.nextElementSibling.classList.contains("nokt-ad-slot");
        if (!already) {
          const slotId = `nokt-ad-slot-${gridSelector.replace(/[^a-z0-9]/gi,"")}-${seq++}`;
          const slot = document.createElement("div");
          slot.className = "nokt-ad-slot";
          slot.id = slotId;
          slot.style.cssText = "grid-column:1 / -1;margin:6px 0;";
          card.after(slot);
          renderNativeBanner(slotId);
        }
      }
    });
  };
  new MutationObserver(scan).observe(grid, { childList: true });
  scan();
}