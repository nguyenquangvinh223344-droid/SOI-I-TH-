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

async function buildList() {
  const params = new URLSearchParams(window.location.search);
  const channel = params.get("channel") || "";
  const sort = params.get("sort") || "gain";
  const targetId = params.get("id");

  const { videos } = await chrome.storage.local.get("videos");
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
