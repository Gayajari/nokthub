// ============================================================
// NOKT HUB — Ads Module (Adsterra) — Sandboxed ad slots
// ============================================================
const AD_UNITS = {
  banner320x50: { key: "f7e12447bffcb6a5de5da6511606b3b1", width: 320, height: 50 },
  banner300x250: { key: "01c9679d602b9111028c86f0400a8eef", width: 300, height: 250 },
  // Zona ini sudah disetel manager Adsterra: responsif sendiri --
  // 1 kartu di layar sempit (mobile), 4 kartu di layar lebar (desktop).
  native: { containerId: "container-3b1b55ee4183e6526d08a0c286844beb", src: "https://inputoppose.com/3b1b55ee4183e6526d08a0c286844beb/invoke.js" }
};

// Batas tinggi aman untuk native banner supaya tidak "kepotong" dan
// tidak juga bisa melar tak terbatas kalau ada iklan nakal.
const NATIVE_MIN_HEIGHT = 90;
const NATIVE_MAX_HEIGHT = 520;
const NATIVE_DEFAULT_HEIGHT = 160; // tinggi awal sebelum ukuran asli diketahui -- sengaja kecil biar iklan tidak "diundang" nambah kartu kedua selagi masih loading

let nativeAdSeq = 0;

function buildBannerSrcdoc(unit) {
  return `<!DOCTYPE html><html><head><style>html,body{margin:0;padding:0;overflow:hidden;background:transparent;}</style></head>
  <body>
    <script>atOptions = { 'key':'${unit.key}', 'format':'iframe', 'height':${unit.height}, 'width':${unit.width}, 'params':{} };<\/script>
    <script src="https://inputoppose.com/${unit.key}/invoke.js"><\/script>
  </body></html>`;
}

// Bangun srcdoc native banner: ukur tinggi konten sekali (setelah font
// selesai load dan hasilnya stabil), lalu lapor ke parent lewat
// postMessage -- sekali saja, tidak pernah diulang, supaya tidak
// memicu iklan menambah kartu baru.
//
// CATATAN: jumlah kartu yang tampil (1 vs beberapa) itu sebenarnya
// ditentukan dari sisi Adsterra sendiri -- saat generate kode Native
// Banner di dashboard mereka, ada opsi "Quantity" untuk jumlah kartu.
// Kode `key`/`src` yang dipakai sekarang kemungkinan di-generate dengan
// quantity > 1. Cara paling pasti untuk selalu dapat 1 kartu: generate
// ulang kode Native Banner di dashboard Adsterra dengan Quantity = 1,
// lalu ganti nilai AD_UNITS.native di bawah dengan key/src yang baru.
function buildNativeSrcdoc(unit, token) {
  return `<!DOCTYPE html><html><head><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden;}</style></head>
  <body>
    <div id="${unit.containerId}"></div>
    <script async data-cfasync="false" src="${unit.src}"><\/script>
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
              parent.postMessage({ noktAdHeight: true, token: "${token}", height: h + HEIGHT_BUFFER }, "*");
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
    <\/script>
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

// FIX: dulu height dikirim string kosong ("") -> CSS "height:;" tidak
// valid -> browser pakai default 150px -> konten iklan yang lebih tinggi
// dari itu kepotong (ini penyebab utama bug di screenshot). Sekarang
// iframe dimulai dengan tinggi default yang wajar, lalu di-update live
// begitu ukuran asli konten iklan dilaporkan lewat postMessage.
export function renderNativeBanner(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;

  const token = `nat-${containerId}-${nativeAdSeq++}-${Date.now()}`;
  const iframe = mountAdIframe(
    el,
    buildNativeSrcdoc(AD_UNITS.native, token),
    "100%",
    `${NATIVE_DEFAULT_HEIGHT}px`
  );
  if (!iframe) return;
  iframe.style.transition = "height .15s ease";

  const handler = (event) => {
    const data = event.data;
    if (!data || data.noktAdHeight !== true || data.token !== token) return;

    // One-shot: langsung lepas listener begitu dipakai sekali. Ini yang
    // mencegah loop "iframe membesar -> iklan nambah kartu -> membesar
    // lagi" -- sesudah pengukuran pertama diterapkan, kita sengaja tidak
    // dengarkan laporan tinggi susulan sama sekali.
    window.removeEventListener("message", handler);

    if (!iframe.isConnected) return;

    const h = Math.max(NATIVE_MIN_HEIGHT, Math.min(Math.ceil(data.height), NATIVE_MAX_HEIGHT));
    iframe.style.height = h + "px";
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
