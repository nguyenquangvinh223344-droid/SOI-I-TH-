// ============================================================================
// popup.js - chỉ điều khiển (gửi lệnh) + hiển thị tiến độ.
// Toàn bộ logic quét THẬT nằm ở background.js + content.js.
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

// ---- Hai chế độ: "rival" (soi đối thủ) và "dance" (soi kênh nhảy). Mỗi chế độ giữ nháp / cài đặt / tiến độ RIÊNG (khóa có đuôi "Dance").
let MODE = "rival";
const sfx = () => (MODE === "dance" ? "Dance" : "");
const MODE_HINT = {
  rival: "Soi xem đối thủ bán gì, món nào lên xu hướng nhanh.",
  dance: "Soi các kênh nhảy để biết bài nhảy nào đang lên (clip nào tăng view nhanh nhất).",
};

const profileListEl = document.getElementById("profileList");
const channelCountEl = document.getElementById("channelCount");
const fromDateEl = document.getElementById("fromDate");
const toDateEl = document.getElementById("toDate");
const thresholdEl = document.getElementById("threshold");
const autoRescanEl = document.getElementById("autoRescan");
const btnStart = document.getElementById("btnStart");
const btnStop = document.getElementById("btnStop");
const btnDashboard = document.getElementById("btnDashboard");
const btnExport = document.getElementById("btnExport");
const progressBar = document.getElementById("progressBar");
const progressText = document.getElementById("progressText");
const channelProgress = document.getElementById("channelProgress");
const countRead = document.getElementById("countRead");
const countMatched = document.getElementById("countMatched");
const countError = document.getElementById("countError");
const errorText = document.getElementById("errorText");
const captchaBox = document.getElementById("captchaBox");
const healthWarningBox = document.getElementById("healthWarningBox");

function extractUsername(line) {
  let s = line.trim();
  if (!s) return null;
  s = s.replace(/^https?:\/\/(www\.)?tiktok\.com\//i, "");
  s = s.replace(/^@/, "");
  s = s.split(/[/?]/)[0];
  return s || null;
}

function dedupeChannels() {
  const lines = profileListEl.value.split("\n");
  const seen = new Set();
  const out = [];
  for (const line of lines) {
    const u = extractUsername(line);
    if (!u) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  channelCountEl.textContent = `${out.length} kênh`;
  return out;
}

profileListEl.addEventListener("input", dedupeChannels);

// Nút xoay: đưa các số về 0 (không đụng dữ liệu đã quét trong Dashboard). Bấm "Bắt đầu quét" cũng tự về 0 sẵn.
const btnResetStats = document.getElementById("btnResetStats");
btnResetStats.addEventListener("click", async () => {
  const key = "scanState" + sfx();
  const got = await chrome.storage.local.get(key);
  if (got[key] && got[key].running) return; // đang quét thì không reset giữa chừng
  const fresh = { running: false, done: false, total: 0, currentIndex: 0, currentChannel: "", videosRead: 0, clipsMatched: 0, errorCount: 0, error: null, needCaptcha: false, healthWarning: false, channelNote: "", coverage: [] };
  await chrome.storage.local.set({ [key]: fresh });
  renderState(fresh);
  progressBar.style.width = "0%";
  channelProgress.textContent = "0/0 kênh";
  btnResetStats.classList.add("spin");
  setTimeout(() => btnResetStats.classList.remove("spin"), 400);
});

// ---------------------------------------------------------------------------
// Hiển thị tiến độ
// ---------------------------------------------------------------------------
function renderState(state) {
  if (!state) return;

  captchaBox.style.display = state.needCaptcha ? "block" : "none";
  healthWarningBox.style.display = state.healthWarning ? "block" : "none";

  if (state.running) {
    const pct = state.total ? Math.round((state.currentIndex / state.total) * 100) : 0;
    progressBar.style.width = pct + "%";
    channelProgress.textContent = `${state.currentIndex}/${state.total} kênh`;
    progressText.textContent = `Đang quét kênh ${state.currentIndex}/${state.total}… @${state.currentChannel}` + (state.channelNote ? ` · ${state.channelNote}` : "");
    btnStart.disabled = true;
    btnStop.disabled = false;
  } else {
    btnStart.disabled = false;
    btnStop.disabled = true;
    if (state.done) {
      progressBar.style.width = "100%";
      progressText.textContent = `Xong. Tổng đã đọc: ${state.videosRead || 0} video – Đạt yêu cầu: ${state.clipsMatched || 0} clip.`;
    } else {
      progressText.textContent = "Sẵn sàng.";
    }
  }

  countRead.textContent = state.videosRead || 0;
  countMatched.textContent = state.clipsMatched || 0;
  countError.textContent = state.errorCount || 0;
  errorText.textContent = state.healthWarning ? "" : (state.error || "");
  const cov = document.getElementById("coverageBox");
  if (cov) {
    const lines = state.coverage || [];
    cov.style.display = lines.length ? "block" : "none";
    cov.textContent = lines.length ? "Độ phủ từng kênh:\n" + lines.join("\n") : "";
  }
}

function fmtDateInput(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

document.querySelectorAll(".chip-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const days = Number(btn.dataset.days);
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - (days - 1));
    fromDateEl.value = fmtDateInput(from);
    toDateEl.value = fmtDateInput(to);
    document.querySelectorAll(".chip-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    saveDraft(); // gán ngày bằng code không bắn sự kiện "change" nên phải tự lưu, không thì đóng/mở lại popup sẽ nạp lại ngày cũ
  });
});

// Bỏ trạng thái "active" của nút nhanh nếu người dùng tự sửa tay ngày.
fromDateEl.addEventListener("change", () => document.querySelectorAll(".chip-btn").forEach((b) => b.classList.remove("active")));
toDateEl.addEventListener("change", () => document.querySelectorAll(".chip-btn").forEach((b) => b.classList.remove("active")));

// ---------------------------------------------------------------------------
// Lưu "nháp" NGAY khi gõ (khác với lastSettings, chỉ ghi lúc bấm Bắt đầu
// quét) - tránh lỗi: gõ ngưỡng view mới, đóng popup trước khi bấm quét, mở
// lại popup thì bị nạp lại giá trị CŨ của lần quét trước đè mất giá trị
// vừa gõ. Có dấu "✓ đã lưu" để biết chắc giá trị đã được ghi nhận.
// ---------------------------------------------------------------------------
function saveDraft() {
  chrome.storage.local.set({
    ["draftSettings" + sfx()]: {
      profiles: profileListEl.value,
      fromDate: fromDateEl.value,
      toDate: toDateEl.value,
      threshold: thresholdEl.value,
    },
  });
}

let savedCheckTimer = null;
function flashSavedCheck() {
  const el = document.getElementById("thresholdSaved");
  el.style.display = "inline";
  clearTimeout(savedCheckTimer);
  savedCheckTimer = setTimeout(() => {
    el.style.display = "none";
  }, 2000);
}

thresholdEl.addEventListener("input", () => {
  saveDraft();
  flashSavedCheck();
});
fromDateEl.addEventListener("change", saveDraft);
toDateEl.addEventListener("change", saveDraft);
profileListEl.addEventListener("input", saveDraft);

function defaultDates() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const fmt = (d) => {
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  return { from: fmt(startOfMonth), to: fmt(now) };
}

async function restoreUI() {
  const got = await chrome.storage.local.get(["draftSettings" + sfx(), "lastSettings" + sfx(), "scanState" + sfx(), "autoRescanHours" + sfx()]);
  const draftSettings = got["draftSettings" + sfx()], lastSettings = got["lastSettings" + sfx()], scanState = got["scanState" + sfx()], autoRescanHours = got["autoRescanHours" + sfx()];

  // Uu tien draft (nhung gi sep go gan nhat, du chua bam quet) hon lastSettings.
  const base = draftSettings || (lastSettings
    ? { profiles: (lastSettings.profiles || []).join("\n"), fromDate: lastSettings.fromDate, toDate: lastSettings.toDate, threshold: lastSettings.threshold }
    : null);

  if (base) {
    profileListEl.value = base.profiles || "";
    fromDateEl.value = base.fromDate || defaultDates().from;
    toDateEl.value = defaultDates().to; // "đến ngày" luôn là HÔM NAY khi mở popup (tránh sót video mới); "từ ngày" giữ như sếp đã chọn
    thresholdEl.value = base.threshold || 10000;
  } else {
    const d = defaultDates();
    profileListEl.value = "";  // tab chưa có nháp (vd. tab Soi kênh nhảy lần đầu): để trống, không mượn dữ liệu của tab kia
    thresholdEl.value = 10000;
    fromDateEl.value = d.from;
    toDateEl.value = d.to;
  }
  dedupeChannels();

  autoRescanEl.value = autoRescanHours ? String(autoRescanHours) : "0";

  renderState(scanState || { running: false });
}

function setMode(m) {
  MODE = m === "dance" ? "dance" : "rival";
  document.body.classList.toggle("mode-dance", MODE === "dance");
  document.querySelectorAll(".mode-tab").forEach((b) => b.classList.toggle("on", b.dataset.mode === MODE));
  document.getElementById("modeHint").textContent = MODE_HINT[MODE];
  chrome.storage.local.set({ popupMode: MODE });
  restoreUI();
}
document.querySelectorAll(".mode-tab").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
document.getElementById("btnNextMode").addEventListener("click", () => setMode(MODE === "rival" ? "dance" : "rival"));
// Vuốt ngang để đổi tab
(function () {
  let sx = null, sy = 0;
  const app = document.querySelector(".app");
  const down = (e) => { if (e.target.closest("textarea, input, select")) { sx = null; return; } sx = e.clientX; sy = e.clientY; };
  const up = (e) => { if (sx == null) return; const dx = e.clientX - sx, dy = Math.abs(e.clientY - sy); sx = null; if (Math.abs(dx) > 70 && dy < 40) setMode(dx < 0 ? "dance" : "rival"); };
  app.addEventListener("pointerdown", down); app.addEventListener("pointerup", up);
})();
chrome.storage.local.get("popupMode").then(({ popupMode }) => setMode(popupMode));

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "scan_progress" && (msg.mode || "rival") === MODE) {
    renderState(msg.state);
  }
  if (msg.type === "cart_progress") {
    renderCart(msg.state);
  }
});

// ---------------------------------------------------------------------------
// Nút bấm
// ---------------------------------------------------------------------------
btnStart.addEventListener("click", () => {
  const profiles = dedupeChannels();

  if (profiles.length === 0) {
    errorText.textContent = "Chưa có kênh nào trong danh sách.";
    return;
  }

  const payload = {
    type: "start_scan",
    mode: MODE,
    profiles,
    fromDate: fromDateEl.value,
    toDate: toDateEl.value,
    threshold: Number(thresholdEl.value) || 0,
  };

  errorText.textContent = "";
  chrome.runtime.sendMessage(payload);
});

// ---------------------------------------------------------------------------
// Giỏ hàng từ TikToday: đọc tab TikToday đang mở (bảng "Video bán hàng" của 1 kênh).
// ---------------------------------------------------------------------------
const btnCart = document.getElementById("btnCart");
const cartTextEl = document.getElementById("cartText");
function renderCart(st) {
  if (!st) { cartTextEl.textContent = ""; return; }
  if (st.running) {
    btnCart.textContent = "⏹ Dừng lấy giỏ hàng";
    cartTextEl.textContent = `Đang đọc trang ${st.page || 0}… đã đọc ${st.rows || 0} video, ${st.withCart || 0} video gắn giỏ.`;
  } else {
    btnCart.textContent = "🛒 Lấy giỏ hàng từ TikToday";
    if (st.error) cartTextEl.textContent = "⚠ " + st.error;
    else if (st.done) cartTextEl.textContent = `Xong: ${st.note || ""} Mở Dashboard để xem cột GIỎ HÀNG.`;
    else cartTextEl.textContent = "";
  }
}
chrome.storage.local.get("cartState").then(({ cartState }) => renderCart(cartState));
btnCart.addEventListener("click", async () => {
  const { cartState } = await chrome.storage.local.get("cartState");
  if (cartState && cartState.running) {
    chrome.runtime.sendMessage({ type: "stop_cart" });
    return;
  }
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab || !/^https:\/\/tiktoday\.vn\/dashboard\/creators\//.test(tab.url || "")) {
    cartTextEl.textContent = "⚠ Hãy mở trang kênh trên TikToday (Nhà sáng tạo → bấm vào kênh → tab \"Video bán hàng\"), để tab đó hiện lên, rồi bấm lại.";
    return;
  }
  cartTextEl.textContent = "Đang bắt đầu…";
  const fd = fromDateEl.value;
  chrome.runtime.sendMessage({ type: "scan_cart", tabId: tab.id, fromMs: fd ? new Date(fd + "T00:00:00").getTime() : 0 });
});

document.getElementById("btnShopScan").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("kenhsp.html") });
});
document.getElementById("btnOpenProducts").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html#products") });
});
document.getElementById("btnImportList").addEventListener("click", async () => {
  const el = document.getElementById("importText");
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]) return;
  el.textContent = "Đang đọc bảng sản phẩm…";
  const r = await chrome.runtime.sendMessage({ type: "import_product_list", tabId: tabs[0].id });
  el.textContent = r && r.ok ? `Đã đọc ${r.count} sản phẩm, thêm mới ${r.added} vào danh sách theo dõi. Bấm "Mở bảng theo dõi sản phẩm" để xem.` : "⚠ " + ((r && r.error) || "Không đọc được.");
});

btnStop.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "stop_scan" });
});

btnDashboard.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") + (MODE === "dance" ? "#dance" : "") });
});

btnExport.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") + "?export=1" + (MODE === "dance" ? "#dance" : "") });
});

// Nút gạt quét giỏ hàng TikToday (mặc định TẮT; nhớ lần trước). Chỉ chế độ Soi đối thủ.
const cartScanEl = document.getElementById("cartScanOn");
const cartScanHintEl = document.getElementById("cartScanHint");
function showCartScanHint() {
  cartScanHintEl.textContent = cartScanEl.checked ? "Bật: quét TikTok xong sẽ vào TikToday lấy giỏ hàng / link sản phẩm." : "Tắt: chỉ vào TikTok quét kênh.";
}
chrome.storage.local.get("cartScanOn").then((d) => { cartScanEl.checked = !!d.cartScanOn; showCartScanHint(); });
cartScanEl.addEventListener("change", () => {
  chrome.storage.local.set({ cartScanOn: cartScanEl.checked });
  showCartScanHint();
});

autoRescanEl.addEventListener("change", () => {
  const hours = Number(autoRescanEl.value) || 0;
  chrome.storage.local.set({ ["autoRescanHours" + sfx()]: hours });
  chrome.runtime.sendMessage({ type: "set_auto_rescan", hours, mode: MODE });
});
