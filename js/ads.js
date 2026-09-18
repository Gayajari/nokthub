// ============================================================
// NOKT HUB — Ads Module (Adsterra) — Sandboxed ad slots
// ============================================================
const AD_UNITS = {
  banner320x50: { key: "f7e12447bffcb6a5de5da6511606b3b1", width: 320, height: 50 },
  banner300x250: { key: "01c9679d602b9111028c86f0400a8eef", width: 300, height: 250 },
  native: { containerId: "container-3b1b55ee4183e6526d08a0c286844beb", src: "https://inputoppose.com/3b1b55ee4183e6526d08a0c286844beb/invoke.js" }
};

// Tinggi cadangan HANYA dipakai kalau tinggi asli iklan gagal terbaca
// (mis. konten iklan gagal dimuat total) -- bukan lagi tinggi tetap yang
// selalu dipasang, biar tidak ada ruang kosong nganggur seperti sebelumnya.
const NATIVE_FALLBACK_HEIGHT = 320; // px

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

// FIX jarak kosong di bawah iklan: sebelumnya kotak iklan dikasih tinggi
// TETAP 320px, padahal tinggi asli materi iklan (yang bisa beda-beda tiap
// tayang) sering lebih pendek dari itu -- sisanya jadi ruang kosong yang
// kelihatan seperti "jarak" ke section berikutnya, padahal sebenarnya
// kosongan di DALAM kotak iklan itu sendiri. Sekarang: ukur tinggi asli
// konten iklan setelah dimuat (iframe pakai sandbox "allow-same-origin"
// jadi boleh dibaca dari luar), lalu pas-kan tinggi kotaknya PERSIS
// sebesar itu -- tidak lebih, tidak kurang. Fallback ke tinggi tetap
// HANYA kalau gagal terbaca sama sekali (mis. iklan gagal tampil).
export function renderNativeBanner(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.style.minHeight = "0";
  const iframe = mountAdIframe(el, buildNativeSrcdoc(AD_UNITS.native), "100%", "1px");
  if (!iframe) return;

  let fitted = false;
  const fit = () => {
    try {
      const doc = iframe.contentDocument;
      if (!doc || !doc.body) return;
      const h = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight);
      if (h > 20) {
        iframe.style.height = h + "px";
        fitted = true;
      }
    } catch (e) { /* dibiarkan -- fallback timeout di bawah yang urus */ }
  };

  iframe.addEventListener("load", () => {
    fit();
    // Script iklan (invoke.js) jalan async, isinya sering baru "penuh"
    // beberapa saat setelah iframe selesai load -- ukur ulang beberapa
    // kali dalam ~3 detik pertama supaya tinggi akhirnya benar-benar pas.
    let tries = 0;
    const timer = setInterval(() => {
      fit();
      tries++;
      if (tries > 10) clearInterval(timer);
    }, 300);
  });

  // Kalau dalam 3.5 detik tinggi tetap tidak terbaca (mis. no-fill / iklan
  // gagal tampil), baru pakai tinggi cadangan supaya kotaknya tidak
  // collapse total jadi 1px kosong.
  setTimeout(() => {
    if (!fitted) iframe.style.height = NATIVE_FALLBACK_HEIGHT + "px";
  }, 3500);
}

// Sticky banner 320x50 di bawah layar -- tampil di semua ukuran layar
// (mobile maupun desktop), bisa ditutup pengunjung kapan saja lewat tombol X.
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
          slot.style.cssText = `grid-column:1 / -1;margin:0;`;
          card.after(slot);
          renderNativeBanner(slotId);
        }
      }
    });
  };
  new MutationObserver(scan).observe(grid, { childList: true });
  scan();
}
