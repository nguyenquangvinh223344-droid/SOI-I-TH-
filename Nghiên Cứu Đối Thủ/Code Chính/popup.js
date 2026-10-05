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
const btnCheckLicense = document.getElementById("btnCheckLicense");
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

// ---------------------------------------------------------------------------
// Card "License" - demo, lưu local, không gọi server thật.
// ---------------------------------------------------------------------------
async function checkLicense() {
  let { licenseInfo } = await chrome.storage.local.get("licenseInfo");
  if (!licenseInfo) {
    licenseInfo = {
      deviceId: crypto.randomUUID(),
      trialEnd: Date.now() + 7 * 24 * 3600 * 1000,
    };
    await chrome.storage.local.set({ licenseInfo });
  }
  document.getElementById("deviceId").textContent = licenseInfo.deviceId;
  const d = new Date(licenseInfo.trialEnd);
  const pad = (n) => String(n).padStart(2, "0");
  document.getElementById("trialEnd").textContent =
    `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}
btnCheckLicense.addEventListener("click", checkLicense);

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
    progressText.textContent = `Đang quét kênh ${state.currentIndex}/${state.total}… @${state.currentChannel}`;
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
    draftSettings: {
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
  await checkLicense();
  const { draftSettings, lastSettings, scanState, autoRescanHours } = await chrome.storage.local.get([
    "draftSettings",
    "lastSettings",
    "scanState",
    "autoRescanHours",
  ]);

  // Uu tien draft (nhung gi sep go gan nhat, du chua bam quet) hon lastSettings.
  const base = draftSettings || (lastSettings
    ? { profiles: (lastSettings.profiles || []).join("\n"), fromDate: lastSettings.fromDate, toDate: lastSettings.toDate, threshold: lastSettings.threshold }
    : null);

  if (base) {
    profileListEl.value = base.profiles || "";
    fromDateEl.value = base.fromDate || defaultDates().from;
    toDateEl.value = base.toDate || defaultDates().to;
    thresholdEl.value = base.threshold || 10000;
  } else {
    const d = defaultDates();
    fromDateEl.value = d.from;
    toDateEl.value = d.to;
  }
  dedupeChannels();

  if (autoRescanHours) autoRescanEl.value = String(autoRescanHours);

  renderState(scanState);
}

restoreUI();

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "scan_progress") {
    renderState(msg.state);
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
    profiles,
    fromDate: fromDateEl.value,
    toDate: toDateEl.value,
    threshold: Number(thresholdEl.value) || 0,
  };

  errorText.textContent = "";
  chrome.runtime.sendMessage(payload);
});

btnStop.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "stop_scan" });
});

btnDashboard.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
});

btnExport.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") + "?export=1" });
});

autoRescanEl.addEventListener("change", () => {
  const hours = Number(autoRescanEl.value) || 0;
  chrome.storage.local.set({ autoRescanHours: hours });
  chrome.runtime.sendMessage({ type: "set_auto_rescan", hours });
});
