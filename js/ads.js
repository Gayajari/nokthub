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

// Native banner: srcdoc punya 2 mode.
//  - MOBILE: polos saja, tidak ada logic ukur di dalamnya -- kepastian
//    ukurannya ditangani di luar lewat teknik ruang-lega + crop tetap
//    (lihat renderNativeBanner), sesuai teknik yang sudah terbukti pas.
//  - DESKTOP: disisipi script kecil yang mengukur tinggi konten sampai
//    stabil (nunggu 3x cek berturut-turut hasilnya sama), lalu lapor
//    SEKALI ke parent lewat postMessage -- supaya iframe di-resize pas
//    menampung 4 kartu, otomatis menyesuaikan walau lebar kontainer
//    berubah. Dilapor cuma sekali (tidak diulang) supaya tidak memicu
//    iklan menambah kartu baru gara-gara iframe terus membesar.
function buildNativeSrcdoc(unit, measureToken) {
  const measureScript = measureToken ? `
    <script>
      (function(){
        var HEIGHT_BUFFER = 28;
        var reported = false;
        var lastHeight = -1;
        var stableCount = 0;
        var checks = 0;
        var maxChecks = 24;
        function check(){
          if (reported) return;
          checks++;
          var h = document.body.scrollHeight;
          if (h === lastHeight) { stableCount++; } else { stableCount = 0; lastHeight = h; }
          if (stableCount >= 3 || checks >= maxChecks) {
            reported = true;
            try {
              parent.postMessage({ noktAdHeight: true, token: "${measureToken}", height: h + HEIGHT_BUFFER }, "*");
            } catch(e) {}
            return;
          }
          setTimeout(check, 250);
        }
        function startChecking(){ setTimeout(check, 250); }
        if (document.fonts && document.fonts.ready) {
          document.fonts.ready.then(startChecking).catch(startChecking);
        } else {
          startChecking();
        }
      })();
    <\/script>` : "";

  return `<!DOCTYPE html><html><head><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden;}</style></head>
  <body>
    <div id="${unit.containerId}"></div>
    <script async data-cfasync="false" src="${unit.src}"><\/script>
    ${measureScript}
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

// Native banner -- HYBRID:
//  - MOBILE (lebar < 900px): teknik "ruang lega + crop tetap" (dari
//    Yakultind, sudah terbukti pas & stabil). Iframe dikasih tinggi
//    lega (500px) di dalam supaya kartu pertama sempat render UTUH,
//    lalu dibungkus wrapper overflow:hidden dengan tinggi TETAP
//    (cropHeightMobile) yang pas di batas bawah 1 kartu.
//  - DESKTOP (lebar >= 900px): logic NOKT HUB versi lama -- iframe
//    diukur otomatis (stable-height via postMessage) sampai pas
//    menampung 4 kartu, jadi tetap menyesuaikan sendiri kalau lebar
//    kontainer situs berubah, tidak perlu angka tetap yang di-hardcode.
//
// CARA CARI ANGKA cropHeightMobile YANG PAS (mobile saja, desktop sudah
// otomatis):
//  1. Buka halaman di device/browser sungguhan (bukan cuma DevTools
//     device-mode, karena lebar render bisa beda).
//  2. Lihat kartu iklan tampil penuh (untuk sementara boleh naikkan
//     dulu angkanya jadi besar, misal 600, biar tidak kepotong).
//  3. Ukur kira-kira di titik berapa px pas batas bawah kartu pertama
//     berakhir.
//  4. Ganti nilai default di bawah (atau parameter saat memanggil
//     renderNativeBanner) dengan angka itu.
const NATIVE_DESKTOP_BREAKPOINT = 900;
const NATIVE_MOBILE_INNER_HEIGHT = 500;   // ruang lega di dalam iframe (mobile)
const NATIVE_MOBILE_CROP_DEFAULT = 340;   // tinggi pas 1 kartu (mobile) -- sudah dites & sesuai
const NATIVE_DESKTOP_DEFAULT_HEIGHT = 280; // tinggi awal sebelum ukuran asli (4 kartu) diketahui

let nativeAdSeq = 0;

export function renderNativeBanner(containerId, cropHeightMobile) {
  const el = document.getElementById(containerId);
  if (!el) return;

  const isDesktop = window.innerWidth >= NATIVE_DESKTOP_BREAKPOINT;
  el.innerHTML = "";

  if (!isDesktop) {
    // MOBILE: ruang lega + crop tetap (sudah pas, tidak diubah).
    const iframe = document.createElement("iframe");
    iframe.srcdoc = buildNativeSrcdoc(AD_UNITS.native);
    iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups");
    iframe.setAttribute("scrolling", "no");
    iframe.setAttribute("loading", "lazy");
    iframe.style.cssText = `width:100%;height:${NATIVE_MOBILE_INNER_HEIGHT}px;border:0;display:block;`;
    const crop = document.createElement("div");
    crop.style.cssText = `width:100%;height:${cropHeightMobile || NATIVE_MOBILE_CROP_DEFAULT}px;overflow:hidden;border-radius:12px;`;
    crop.appendChild(iframe);
    el.appendChild(crop);
    return;
  }

  // DESKTOP: auto-resize lewat postMessage sampai tinggi stabil (logic lama).
  const token = `nat-${containerId}-${nativeAdSeq++}-${Date.now()}`;
  const iframe = document.createElement("iframe");
  iframe.srcdoc = buildNativeSrcdoc(AD_UNITS.native, token);
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups");
  iframe.setAttribute("scrolling", "no");
  iframe.setAttribute("loading", "lazy");
  iframe.style.cssText = `width:100%;height:${NATIVE_DESKTOP_DEFAULT_HEIGHT}px;border:0;display:block;transition:height .15s ease;`;
  el.appendChild(iframe);

  const handler = (event) => {
    const data = event.data;
    if (!data || data.noktAdHeight !== true || data.token !== token) return;
    window.removeEventListener("message", handler); // one-shot, cegah loop membesar
    if (!iframe.isConnected) return;
    iframe.style.height = Math.ceil(data.height) + "px";
  };
  window.addEventListener("message", handler);
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