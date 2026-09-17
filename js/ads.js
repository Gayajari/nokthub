// ============================================================
// NOKT HUB — Ads Module (Adsterra) — Sandboxed ad slots
// ============================================================
const AD_UNITS = {
  banner320x50: { key: "f7e12447bffcb6a5de5da6511606b3b1", width: 320, height: 50 },
  banner300x250: { key: "01c9679d602b9111028c86f0400a8eef", width: 300, height: 250 },
  native: { containerId: "container-3b1b55ee4183e6526d08a0c286844beb", src: "https://inputoppose.com/3b1b55ee4183e6526d08a0c286844beb/invoke.js" }
};

// PENYEMPURNAAN: iklan Native Banner sebelumnya kepotong -- iframe-nya
// dikasih heightCss kosong (""), jadi browser pakai tinggi default iframe
// yang jauh lebih pendek dari tinggi banner aslinya (banner Native
// biasanya beberapa ratus px tinggi, isinya gambar promosi lengkap).
// Sekarang wadah Native Banner dikasih tinggi minimum yang cukup lega
// (NATIVE_MIN_HEIGHT) supaya seluruh isi iklan kelihatan penuh, tidak
// terpotong di tengah.
const NATIVE_MIN_HEIGHT = 320; // px -- cukup untuk banner promosi utuh

function buildBannerSrcdoc(unit) {
  return `<!DOCTYPE html><html><head><style>html,body{margin:0;padding:0;overflow:hidden;background:transparent;}</style></head>
  <body>
    <script>atOptions = { 'key':'${unit.key}', 'format':'iframe', 'height':${unit.height}, 'width':${unit.width}, 'params':{} };<\/script>
    <script src="https://inputoppose.com/${unit.key}/invoke.js"><\/script>
  </body></html>`;
}
function buildNativeSrcdoc(unit) {
  return `<!DOCTYPE html><html><head><style>html,body{margin:0;padding:0;background:transparent;}</style></head>
  <body>
    <div id="${unit.containerId}"></div>
    <script async data-cfasync="false" src="${unit.src}"><\/script>
  </body></html>`;
}
function mountAdIframe(container, srcdocHtml, widthCss, heightCss) {
  if (!container) return;
  const iframe = document.createElement("iframe");
  iframe.srcdoc = srcdocHtml;
  iframe.style.cssText = `width:${widthCss};height:${heightCss};border:0;display:block;margin:0 auto;`;
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups");
  iframe.setAttribute("scrolling", "no");
  iframe.setAttribute("loading", "lazy");
  container.innerHTML = "";
  container.appendChild(iframe);
}

export function renderBanner300x250(containerId) {
  mountAdIframe(document.getElementById(containerId), buildBannerSrcdoc(AD_UNITS.banner300x250), "300px", "250px");
}

export function renderNativeBanner(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  // FIX kepotong: wadah luar dikasih tinggi minimum tetap (bukan lagi
  // kosong), iframe di dalamnya mengisi penuh 100% tinggi wadah itu --
  // jadi seluruh isi banner (yang biasanya cukup tinggi) tidak lagi
  // terpotong di tengah gambar.
  el.style.minHeight = NATIVE_MIN_HEIGHT + "px";
  mountAdIframe(el, buildNativeSrcdoc(AD_UNITS.native), "100%", "100%");
}

// Sticky banner 320x50 di bawah layar -- SEKARANG tampil di semua ukuran
// layar (mobile MAUPUN desktop), bisa ditutup pengunjung kapan saja lewat
// tombol X. Sebelumnya ada baris `if (window.innerWidth > 768) return;`
// yang sengaja menyembunyikan banner ini kalau dibuka dari desktop --
// baris itu sudah dihapus.
export function mountStickyMobileBanner() {
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
// pakai MutationObserver, jadi TIDAK PERLU ubah site.js/watch.js sama sekali.
// Aman berdampingan dengan render video yang sudah ada.
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
          // FIX kepotong: grid-column tetap full-width, TAPI sekarang
          // dikasih tinggi minimum juga di level slot -- supaya ruang
          // sudah tersedia SEBELUM renderNativeBanner() sempat mengisi
          // iframe-nya (mencegah "lompatan" tinggi mendadak saat iklan
          // baru selesai dimuat).
          slot.style.cssText = `grid-column:1 / -1;margin:6px 0;min-height:${NATIVE_MIN_HEIGHT}px;`;
          card.after(slot);
          renderNativeBanner(slotId);
        }
      }
    });
  };
  new MutationObserver(scan).observe(grid, { childList: true });
  scan();
}
