// ============================================================================
// viewer.js - trang xem 1 clip, điều hướng Clip trước/tiếp trong đúng danh
// sách đang lọc/sắp xếp bên Dashboard. Video sạch (không logo) lấy qua API
// công khai TikWM.
// ============================================================================

async function applyTheme() {
  const { themePreference } = await chrome.storage.local.get("themePreference");
  const isLight = themePreference === "light";
  document.documentElement.setAttribute("data-theme", isLight ? "light" : "dark");
  const btn = document.getElementById("btnThemeToggle");
  if (btn) btn.textContent = isLight ? "☀️" : "🌙";
}
applyTheme();
document.getElementById("btnThemeToggle").addEventListener("click", async () => {
  const { themePreference } = await chrome.storage.local.get("themePreference");
  await chrome.storage.local.set({ themePreference: themePreference === "light" ? "dark" : "light" });
  applyTheme();
});

function formatNumberDot(n) {
  n = Math.round(n || 0);
  return n.toLocaleString("vi-VN");
}

let list = [];
let currentIndex = -1;

function enrichVideo(v) {
  const history = v.history || [];
  const last = history[history.length - 1];
  const prev = history.length >= 2 ? history[history.length - 2] : null;
  const currentViews = last ? last.views : 0;
  const gain = prev ? currentViews - prev.views : 0;
  return Object.assign({}, v, { currentViews, gain });
}

let cartData = {};

function openBigQr(url, title) {
  const ov = document.createElement("div");
  ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;z-index:99999;cursor:zoom-out";
  const box = document.createElement("div");
  box.style.cssText = "background:#fff;color:#111;padding:24px;border-radius:14px;text-align:center;max-width:340px";
  const h = document.createElement("div");
  h.textContent = "Quét mã để mở sản phẩm trên TikTok Shop";
  h.style.cssText = "font-weight:600;margin-bottom:10px;font-size:14px";
  const im = document.createElement("img");
  im.src = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(url)}`;
  im.style.cssText = "width:240px;height:240px;border-radius:8px;background:#fff;padding:8px";
  const nm = document.createElement("div");
  nm.textContent = title || "";
  nm.style.cssText = "font-size:11px;margin-top:8px;word-break:break-word";
  box.appendChild(h); box.appendChild(im); box.appendChild(nm); ov.appendChild(box);
  ov.addEventListener("click", () => ov.remove());
  document.body.appendChild(ov);
}

function renderCartBox(v) {
  const box = document.querySelector(".product-box");
  if (!box) return;
  const c = cartData[v.id];
  const title = "Sản phẩm trong clip";
  box.innerHTML = "";
  const h = document.createElement("div");
  h.className = "product-title";
  h.textContent = title;
  box.appendChild(h);
  if (!c) {
    const e = document.createElement("div");
    e.className = "product-empty";
    e.textContent = "Chưa có dữ liệu giỏ hàng. Mở kênh này trên TikToday rồi bấm \"Lấy giỏ hàng\" trong popup.";
    box.appendChild(e);
    return;
  }
  if (!c.products.length) {
    const e = document.createElement("div");
    e.className = "product-empty";
    e.textContent = "Video này không gắn giỏ hàng (theo TikToday).";
    box.appendChild(e);
    return;
  }
  c.products.forEach((p) => {
    const url = `https://www.tiktok.com/shop/vn/pdp/${p.id}`;
    const row = document.createElement("div");
    row.style.cssText = "margin:6px 0;display:flex;gap:8px;align-items:center";
    const img = document.createElement("img");
    img.src = `https://api.qrserver.com/v1/create-qr-code/?size=110x110&data=${encodeURIComponent(url)}`;
    img.alt = "QR";
    img.style.cssText = "width:64px;height:64px;border-radius:6px;background:#fff;padding:3px;cursor:zoom-in";
    img.title = "Bấm để phóng to";
    img.addEventListener("click", () => openBigQr(url, p.title));
    const info = document.createElement("div");
    info.style.cssText = "font-size:11px;line-height:1.4;min-width:0";
    const nm = document.createElement("div");
    nm.textContent = p.title || "Sản phẩm";
    nm.style.cssText = "margin-bottom:4px;word-break:break-word";
    const a = document.createElement("a");
    a.href = url; a.target = "_blank"; a.rel = "noopener"; a.textContent = "Mở trên TikTok Shop";
    info.appendChild(nm); info.appendChild(a);
    row.appendChild(img); row.appendChild(info);
    box.appendChild(row);
  });
}

async function buildList() {
  const params = new URLSearchParams(window.location.search);
  const channel = params.get("channel") || "";
  const sort = params.get("sort") || "gain";
  const targetId = params.get("id");

  const { videos, cartData: cartStore } = await chrome.storage.local.get(["videos", "cartData"]);
  cartData = cartStore || {};
  let arr = Object.values(videos || {}).map(enrichVideo);
  if (channel) arr = arr.filter((v) => v.channel === channel);

  if (sort === "newest") arr.sort((a, b) => b.createTime - a.createTime);
  else if (sort === "views") arr.sort((a, b) => b.currentViews - a.currentViews);
  else arr.sort((a, b) => b.gain - a.gain);

  list = arr;
  currentIndex = list.findIndex((v) => v.id === targetId);
  if (currentIndex === -1) currentIndex = 0;
}

function updateUrlForCurrent() {
  const v = list[currentIndex];
  if (!v) return;
  const url = new URL(window.location.href);
  url.searchParams.set("id", v.id);
  window.history.replaceState({}, "", url);
}

async function loadTikWM(pageUrl) {
  const res = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(pageUrl)}`);
  const data = await res.json();
  if (!data || data.code !== 0 || !data.data) {
    throw new Error(data && data.msg ? data.msg : "TikWM không trả dữ liệu");
  }
  return data.data;
}

async function showCurrent() {
  const v = list[currentIndex];
  const player = document.getElementById("player");
  const loadingBox = document.getElementById("loadingBox");
  const errorBox = document.getElementById("errorBox");

  if (!v) {
    document.getElementById("vCaption").textContent = "Không có clip nào để xem.";
    return;
  }

  updateUrlForCurrent();
  renderCartBox(v);
  document.getElementById("vCaption").textContent = `@${v.channel} • ${v.desc || ""}`;
  document.getElementById("authorName").textContent = "@" + v.channel;
  document.getElementById("authorAvatar").textContent = v.channel.charAt(0).toUpperCase();
  document.getElementById("vDesc").textContent = v.desc || "(không có mô tả)";
  document.getElementById("vViews").textContent = formatNumberDot(v.currentViews);
  document.getElementById("btnOpenTikTok").href = v.pageUrl;

  document.getElementById("btnPrev").disabled = currentIndex <= 0;
  document.getElementById("btnNext").disabled = currentIndex >= list.length - 1;

  player.style.display = "none";
  player.pause();
  player.src = "";
  errorBox.style.display = "none";
  loadingBox.style.display = "block";
  document.getElementById("sLikes").textContent = "—";
  document.getElementById("sComments").textContent = "—";
  document.getElementById("sSaves").textContent = "—";
  document.getElementById("sShares").textContent = "—";
  document.getElementById("vFetchedAt").textContent = "Dữ liệu TikWM: đang lấy…";

  try {
    const data = await loadTikWM(v.pageUrl);
    player.src = data.play || data.hdplay || data.wmplay || "";
    player.style.display = "block";
    loadingBox.style.display = "none";

    document.getElementById("sLikes").textContent = formatNumberDot(data.digg_count);
    document.getElementById("sComments").textContent = formatNumberDot(data.comment_count);
    document.getElementById("sSaves").textContent = formatNumberDot(data.collect_count || 0);
    document.getElementById("sShares").textContent = formatNumberDot(data.share_count);

    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    document.getElementById("vFetchedAt").textContent =
      `Dữ liệu TikWM: ${pad(now.getHours())}:${pad(now.getMinutes())} ${pad(now.getDate())}/${pad(now.getMonth() + 1)}`;
  } catch (err) {
    loadingBox.style.display = "none";
    errorBox.style.display = "block";
    document.getElementById("vFetchedAt").textContent = "Dữ liệu TikWM: lỗi tải";
  }
}

document.getElementById("btnPrev").addEventListener("click", () => {
  if (currentIndex > 0) {
    currentIndex -= 1;
    showCurrent();
  }
});
document.getElementById("btnNext").addEventListener("click", () => {
  if (currentIndex < list.length - 1) {
    currentIndex += 1;
    showCurrent();
  }
});
document.getElementById("btnRetry").addEventListener("click", showCurrent);
document.getElementById("btnRetry2").addEventListener("click", showCurrent);

document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowUp") document.getElementById("btnPrev").click();
  if (e.key === "ArrowDown") document.getElementById("btnNext").click();
  if (e.key === "Escape") goBack();
});

// Click ra ngoai khung noi dung (vung nen toi trong) cung quay lai Dashboard,
// giong thoi quen dong modal - chi khi click dung vao body (khong phai vao
// nut/video/panel ben trong) moi tinh la "click ra ngoai".
function goBack() {
  if (window.history.length > 1) window.history.back();
  else window.location.href = chrome.runtime.getURL("dashboard.html");
}
document.body.addEventListener("click", (e) => {
  if (e.target === document.body) goBack();
});

buildList().then(showCurrent);
