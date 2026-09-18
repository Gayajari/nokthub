// ============================================================
// NOKT HUB — Ads Module (Adsterra) — Sandboxed ad slots
// ============================================================
const AD_UNITS = {
  banner320x50: { key: "f7e12447bffcb6a5de5da6511606b3b1", width: 320, height: 50 },
  banner300x250: { key: "01c9679d602b9111028c86f0400a8eef", width: 300, height: 250 },
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

// Bangun srcdoc native banner: hanya menampilkan 1 kartu iklan (kartu
// ke-2 dst di dalam widget disembunyikan lewat script di bawah), lalu
// melapor tinggi kartu pertama ke parent lewat postMessage.
function buildNativeSrcdoc(unit, token) {
  return `<!DOCTYPE html><html><head><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden;}</style></head>
  <body>
    <div id="${unit.containerId}"></div>
    <script async data-cfasync="false" src="${unit.src}"><\/script>
    <script>
      (function(){
        // Widget native ini bisa berisi BEBERAPA kartu sekaligus di dalam
        // DOM-nya (bukan cuma 1 kartu yang "nambah sendiri" kalau diberi
        // ruang lebih). Makanya sekadar resize iframe ke total tinggi
        // konten tidak pernah pas -- kalau dikecilkan, kartu pertama
        // kepotong; kalau dibesarkan, kartu ke-2/3/4 ikut kelihatan.
        //
        // Jadi caranya: cari elemen pembungkus yang berisi beberapa
        // child dengan tag sama (indikasi daftar kartu berulang), lalu
        // SEMBUNYIKAN semua child selain yang pertama -- termasuk yang
        // baru muncul belakangan (dipantau terus lewat MutationObserver,
        // tapi ini AMAN dari loop resize karena kita tidak pernah
        // membesarkan iframe sebagai respons, cuma menyembunyikan). Baru
        // setelah itu tinggi kartu pertama diukur & dilaporkan SEKALI.
        var HEIGHT_BUFFER = 14;
        var reported = false;

        function reportHeight(h){
          if (reported) return;
          reported = true;
          try { parent.postMessage({ noktAdHeight: true, token: "${token}", height: h }, "*"); } catch(e) {}
        }

        function findItemsWrapper(root, depth){
          if (!root || depth > 6) return null;
          var kids = Array.prototype.slice.call(root.children || []);
          if (kids.length >= 2) {
            var tag = kids[0].tagName;
            var sameTag = kids.every(function(k){ return k.tagName === tag; });
            if (sameTag) return root;
          }
          for (var i = 0; i < kids.length; i++){
            var found = findItemsWrapper(kids[i], depth + 1);
            if (found) return found;
          }
          return null;
        }

        function keepOnlyFirst(wrapper){
          for (var i = 1; i < wrapper.children.length; i++){
            wrapper.children[i].style.display = "none";
          }
        }

        function imagesReady(scopeEl){
          var imgs = scopeEl.querySelectorAll("img");
          for (var i = 0; i < imgs.length; i++){
            if (!imgs[i].complete || imgs[i].naturalWidth === 0) return false;
          }
          return true;
        }

        var attempts = 0;
        var maxAttempts = 24; // ~6 detik maksimum tunggu

        function tick(){
          if (reported) return;
          attempts++;
          var container = document.getElementById("${unit.containerId}");
          if (container) {
            var wrapper = findItemsWrapper(container, 0);
            if (wrapper && wrapper.children.length >= 1) {
              keepOnlyFirst(wrapper);
              var firstItem = wrapper.children[0];
              if (imagesReady(firstItem) || attempts >= maxAttempts) {
                // Kalau skrip iklan nambah kartu baru belakangan (async),
                // langsung disembunyikan juga -- tanpa memicu resize apa pun.
                new MutationObserver(function(){ keepOnlyFirst(wrapper); })
                  .observe(wrapper, { childList: true });
                reportHeight(document.body.scrollHeight + HEIGHT_BUFFER);
                return;
              }
            }
          }
          if (attempts >= maxAttempts) {
            reportHeight(document.body.scrollHeight + HEIGHT_BUFFER);
            return;
          }
          setTimeout(tick, 250);
        }

        if (document.fonts && document.fonts.ready) {
          document.fonts.ready.then(function(){ setTimeout(tick, 250); }).catch(function(){ setTimeout(tick, 250); });
        } else {
          setTimeout(tick, 250);
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
