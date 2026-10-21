// ============================================================================
// dashboard.js
// ============================================================================

// Hai chế độ dữ liệu: đối thủ (mặc định) và "viral" (?mode=dance, dữ liệu tách riêng, khóa có đuôi "Dance").
const _qs = new URLSearchParams(location.search);
const DMODE = _qs.get("mode") === "dance";
const EMBED = _qs.get("embed") === "1";
const VKEY = DMODE ? "videosDance" : "videos";
const TKEY = DMODE ? "videosTrashDance" : "videosTrash";
if (EMBED) document.documentElement.classList.add("embed");
if (DMODE) document.documentElement.classList.add("dance");
async function getVT() { const g = await chrome.storage.local.get([VKEY, TKEY]); return { videos: g[VKEY], videosTrash: g[TKEY] }; }

let allVideos = [];
let hashFilter = "";
let cartData = {};
let currentList = [];
let channelAvatars = {};
let channelFollowers = {};
let selectedIds = new Set();
let lastClickedId = null;

// ---------------------------------------------------------------------------
// Sáng/tối - lưu chung chrome.storage.local nên đổi 1 chỗ là áp dụng luôn
// cho popup/dashboard/viewer (mở lại trang mới thấy đồng bộ).
// ---------------------------------------------------------------------------
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
  const next = themePreference === "light" ? "dark" : "light";
  await chrome.storage.local.set({ themePreference: next });
  applyTheme();
});

// ---------------------------------------------------------------------------
// Xu hướng: so tốc độ tăng của khoảng gần nhất với khoảng trước đó.
// - 2 khoảng trở lên: tăng tốc rõ -> bùng nổ; chậm lại/đứng -> chững;
//   còn lại -> tăng đều.
// - Đúng 1 khoảng (mới có 2 lần quét): chỉ biết đang tăng hay không, chưa
//   đủ dữ liệu để nói "tăng tốc" hay chưa.
// - View hiện tại đã vượt 5 lần follower kênh -> đột biến thật theo đúng
//   tiêu chí ngành (xem HUONG_DAN.md), ưu tiên gắn 🔥 luôn.
// ---------------------------------------------------------------------------
function classifyTrend(history, followerCount) {
  if (history.length < 2) return { icon: "🆕", label: "Mới, chưa đủ dữ liệu" };

  const last = history[history.length - 1];
  const prev = history[history.length - 2];
  const lastHours = Math.max(0.0001, (last.ts - prev.ts) / 3600000);
  const lastRate = (last.views - prev.views) / lastHours;

  let icon, label;
  if (history.length >= 3) {
    const prev2 = history[history.length - 3];
    const prevHours = Math.max(0.0001, (prev.ts - prev2.ts) / 3600000);
    const prevRate = (prev.views - prev2.views) / prevHours;

    if (lastRate > 0 && lastRate > prevRate * 1.15) {
      icon = "🔥"; label = "Đang bùng nổ";
    } else if (lastRate <= 0 || lastRate <= prevRate * 0.7) {
      icon = "📉"; label = "Đang chững";
    } else {
      icon = "📈"; label = "Đang tăng đều";
    }
  } else if (lastRate > 0) {
    icon = "📈"; label = "Đang tăng đều";
  } else {
    icon = "📉"; label = "Đang chững";
  }

  if (followerCount && last.views >= followerCount * 5) {
    icon = "🔥"; label = "Đang bùng nổ";
  }

  return { icon, label };
}

const tableBody = document.getElementById("videoTableBody");
const emptyState = document.getElementById("emptyState");
const filterChannelEl = document.getElementById("filterChannel");
const sortByEl = document.getElementById("sortBy");
const filterTrendEl = document.getElementById("filterTrend");
const filterCartEl = document.getElementById("filterCart");

// ---------------------------------------------------------------------------
// Tính field phụ: view hiện tại, tăng, view/ngày (tốc độ tăng gần đây)
// ---------------------------------------------------------------------------
function enrichVideo(v) {
  const history = v.history || [];
  const last = history[history.length - 1];
  const first = history[0];
  const prev = history.length >= 2 ? history[history.length - 2] : null;

  const currentViews = last ? last.views : 0;
  const gain = prev ? currentViews - prev.views : 0;

  let viewsPerDay = 0;
  if (history.length >= 2 && first) {
    const hoursBetween = Math.max(0.0001, (last.ts - first.ts) / (1000 * 60 * 60));
    viewsPerDay = Math.round(((currentViews - first.views) / hoursBetween) * 24);
  }

  let growthPct = null;
  if (first && first.views > 0 && history.length >= 2) {
    growthPct = Math.round(((currentViews - first.views) / first.views) * 100);
  }

  const trend = classifyTrend(history, channelFollowers[v.channel]);
  const recentHistory = history.slice(-4); // 4 cot LAN 1-4 hien o day, LAN DAU rieng lay history[0]

  // Dot bien so voi follower: view hien tai / so follower cua chinh kenh do.
  // Kenh nho ma view vuot xa follower = tin hieu bat thuong manh.
  const followerCount = channelFollowers[v.channel];
  const followerRatio = followerCount ? currentViews / followerCount : 0;

  return Object.assign({}, v, { currentViews, gain, viewsPerDay, growthPct, trend, followerRatio, history, recentHistory, firstEntry: first });
}

// Số rút gọn (K/M) - dùng cho thẻ metric trên cùng.
function formatNumber(n) {
  n = n || 0;
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

// Số đầy đủ, dấu chấm ngăn cách hàng nghìn kiểu Việt - dùng cho bảng.
function formatNumberDot(n) {
  n = Math.round(n || 0);
  return n.toLocaleString("vi-VN");
}

function formatDate(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}-${pad(d.getMonth() + 1)}`;
}

function updateTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  document.getElementById("updatedAt").textContent =
    `Cập nhật: ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

// ---------------------------------------------------------------------------
// Load dữ liệu
// ---------------------------------------------------------------------------
async function loadVideos() {
  const got = await chrome.storage.local.get([VKEY, "channelAvatars", "channelFollowers", "cartData"]);
  const avatars = got.channelAvatars, followers = got.channelFollowers, cart = got.cartData;
  cartData = cart || {};
  const store = got[VKEY] || {};
  channelAvatars = avatars || {};
  channelFollowers = followers || {};
  allVideos = Object.values(store).map(enrichVideo);
  populateChannelFilter();
  renderAll();
  updateTimestamp();
  updateTrashCount();
}

// ---------------------------------------------------------------------------
// Thùng rác: xoá 1 dòng chỉ chuyển sang "videosTrash" (chưa mất hẳn), có
// thể khôi phục lại hoặc xoá vĩnh viễn trong khung Thùng rác.
// ---------------------------------------------------------------------------
async function deleteVideo(id) {
  const { videos, videosTrash } = await getVT();
  const store = videos || {};
  const trash = videosTrash || {};
  const item = store[id];
  if (!item) return;
  delete store[id];
  item.deletedAt = Date.now();
  trash[id] = item;
  await chrome.storage.local.set({ [VKEY]: store, [TKEY]: trash });
  loadVideos();
}

// Xóa nhiều dòng một lần (1 lần ghi, chỉ chuyển vào thùng rác - lấy lại được).
async function deleteMany(ids) {
  const { videos, videosTrash } = await getVT();
  const store = videos || {};
  const trash = videosTrash || {};
  const now = Date.now();
  let n = 0;
  ids.forEach((id) => {
    const item = store[id];
    if (!item) return;
    delete store[id];
    item.deletedAt = now;
    trash[id] = item;
    n++;
  });
  if (n) await chrome.storage.local.set({ [VKEY]: store, [TKEY]: trash });
  loadVideos();
  return n;
}
// "Xóa tất cả" của tab này = mọi dòng đang hiện theo bộ lọc (currentList), hỏi xác nhận 1 lần.
window.__clearAll = async () => {
  const ids = currentList.map((v) => v.id);
  if (!ids.length) { alert("Không có dòng nào đang hiện để xóa."); return; }
  if (!confirm("Đưa " + ids.length + " dòng đang hiện vào thùng rác? (Lấy lại được trong 🗑️ Thùng rác.)")) return;
  selectedIds = new Set();
  updateSelectionUI();
  await deleteMany(ids);
};
window.__openTrash = () => document.getElementById("btnTrash").click();

async function restoreVideo(id) {
  const { videos, videosTrash } = await getVT();
  const store = videos || {};
  const trash = videosTrash || {};
  const item = trash[id];
  if (!item) return;
  delete trash[id];
  delete item.deletedAt;
  store[id] = item;
  await chrome.storage.local.set({ [VKEY]: store, [TKEY]: trash });
  loadVideos();
  renderTrashModal();
}

async function permanentlyDeleteVideo(id) {
  const { videosTrash } = (await getVT());
  const trash = videosTrash || {};
  delete trash[id];
  await chrome.storage.local.set({ [TKEY]: trash });
  updateTrashCount();
  renderTrashModal();
}

async function updateTrashCount() {
  const { videosTrash } = (await getVT());
  const n = Object.keys(videosTrash || {}).length;
  const el = document.getElementById("trashCount");
  if (n > 0) {
    el.textContent = n;
    el.style.display = "inline-block";
  } else {
    el.style.display = "none";
  }
}

async function renderTrashModal() {
  const { videosTrash } = (await getVT());
  const trash = Object.values(videosTrash || {}).map(enrichVideo).sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
  const body = document.getElementById("trashTableBody");
  const empty = document.getElementById("trashEmpty");
  body.innerHTML = "";
  empty.style.display = trash.length === 0 ? "block" : "none";

  trash.forEach((v) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>@${v.channel}</td>
      <td>${formatDate(v.createTime)}</td>
      <td>${formatNumberDot(v.currentViews)}</td>
      <td>${v.deletedAt ? formatTime(v.deletedAt) : "—"}</td>
      <td>
        <div class="trash-row-actions">
          <button class="btn btn-orange btn-restore" data-id="${v.id}">Khôi phục</button>
          <button class="btn btn-ghost btn-perma-delete" data-id="${v.id}">Xoá vĩnh viễn</button>
        </div>
      </td>
    `;
    body.appendChild(tr);
  });

  document.querySelectorAll(".btn-restore").forEach((btn) => {
    btn.addEventListener("click", () => restoreVideo(btn.dataset.id));
  });
  document.querySelectorAll(".btn-perma-delete").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (confirm("Xoá vĩnh viễn video này? Không thể khôi phục lại được nữa.")) {
        permanentlyDeleteVideo(btn.dataset.id);
      }
    });
  });
}

document.getElementById("btnTrash").addEventListener("click", () => {
  renderTrashModal();
  document.getElementById("trashModal").style.display = "flex";
});
document.getElementById("trashModalClose").addEventListener("click", () => {
  document.getElementById("trashModal").style.display = "none";
});
document.getElementById("trashModal").addEventListener("click", (e) => {
  if (e.target.id === "trashModal") document.getElementById("trashModal").style.display = "none";
});

document.getElementById("btnRestoreAll").addEventListener("click", async () => {
  const { videos, videosTrash } = await getVT();
  const store = videos || {};
  const trash = videosTrash || {};
  for (const id of Object.keys(trash)) {
    const item = trash[id];
    delete item.deletedAt;
    store[id] = item;
  }
  await chrome.storage.local.set({ [VKEY]: store, [TKEY]: {} });
  loadVideos();
  renderTrashModal();
});

document.getElementById("btnDeleteAll").addEventListener("click", async () => {
  const { videosTrash } = (await getVT());
  const count = Object.keys(videosTrash || {}).length;
  if (count === 0) return;
  if (!confirm(`Xoá vĩnh viễn toàn bộ ${count} video trong thùng rác? Không thể khôi phục lại được nữa.`)) return;
  await chrome.storage.local.set({ [TKEY]: {} });
  updateTrashCount();
  renderTrashModal();
});

function populateChannelFilter() {
  const selected = filterChannelEl.value;
  const channels = Array.from(new Set(allVideos.map((v) => v.channel))).sort();
  filterChannelEl.innerHTML = '<option value="">Tất cả kênh</option>';
  for (const ch of channels) {
    const opt = document.createElement("option");
    opt.value = ch;
    opt.textContent = "@" + ch;
    filterChannelEl.appendChild(opt);
  }
  filterChannelEl.value = selected;
}

function getFilteredSortedList() {
  let list = allVideos.slice();

  const channel = filterChannelEl.value;
  if (channel) list = list.filter((v) => v.channel === channel);

  const trend = filterTrendEl.value;
  if (trend) list = list.filter((v) => v.trend.icon === trend);
  if (hashFilter) list = list.filter((v) => hashtagsOf(v.desc).includes(hashFilter));

  const cartF = filterCartEl.value;
  if (cartF === "yes") list = list.filter((v) => cartData[v.id] && cartData[v.id].products.length > 0);
  else if (cartF === "no") list = list.filter((v) => cartData[v.id] && cartData[v.id].products.length === 0);
  else if (cartF === "none") list = list.filter((v) => !cartData[v.id]);

  const sortBy = sortByEl.value;
  if (sortBy === "newest") list.sort((a, b) => b.createTime - a.createTime);
  else if (sortBy === "gain") list.sort((a, b) => b.gain - a.gain);
  else if (sortBy === "views") list.sort((a, b) => b.currentViews - a.currentViews);
  else if (sortBy === "viewsPerDay") list.sort((a, b) => b.viewsPerDay - a.viewsPerDay);
  else if (sortBy === "followerRatio") list.sort((a, b) => b.followerRatio - a.followerRatio);

  return list;
}

function renderMetrics(list) {
  document.getElementById("mClipCount").textContent = list.length;
  document.getElementById("mChannelCount").textContent = new Set(list.map((v) => v.channel)).size;
  document.getElementById("mTotalViews").textContent = formatNumber(list.reduce((s, v) => s + v.currentViews, 0));
  const lastGain = list.reduce((s, v) => s + (v.gain > 0 ? v.gain : 0), 0);
  document.getElementById("mLastGain").textContent = "+" + formatNumber(lastGain);
}

function historyCell(history, index) {
  const entry = history[index];
  if (!entry) return '<td class="history-empty">— <span class="h-time">Chưa có</span></td>';
  return `<td class="history-cell">${formatNumberDot(entry.views)}<span class="h-time">${formatTime(entry.ts)}</span></td>`;
}

function firstEntryCell(firstEntry) {
  if (!firstEntry) return '<td class="history-empty">— <span class="h-time">Chưa có</span></td>';
  return `<td class="history-cell first-cell">${formatNumberDot(firstEntry.views)}<span class="h-time">${formatTime(firstEntry.ts)}</span></td>`;
}

function sparkSvg(values, color) {
  const w = 72, h = 24, pad = 3;
  const min = Math.min(...values), max = Math.max(...values);
  const range = Math.max(1, max - min);
  const pts = values.map((val, i) => {
    const x = pad + (i / Math.max(1, values.length - 1)) * (w - pad * 2);
    const y = h - pad - ((val - min) / range) * (h - pad * 2);
    return [x, y];
  });
  const path = pts.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  const last = pts[pts.length - 1];
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="spark-svg">
    <path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="2.5" fill="${color}"/>
  </svg>`;
}

const TREND_COLORS = { "🔥": "#ff9f43", "📈": "#2ecc71", "📉": "#8b93b8", "🆕": "#8b93b8" };

function trendCell(v) {
  const trendClass = v.trend.icon === "🔥" ? "trend-fire" : v.trend.icon === "📉" ? "trend-down" : v.trend.icon === "📈" ? "trend-up" : "trend-new";

  const points = [];
  if (v.firstEntry) points.push(v.firstEntry.views);
  for (const e of v.recentHistory) {
    if (!v.firstEntry || e.ts !== v.firstEntry.ts) points.push(e.views);
  }
  const spark = points.length >= 2 ? sparkSvg(points, TREND_COLORS[v.trend.icon]) : "";

  return `<td><div class="trend-cell"><div class="trend-badge ${trendClass}">${v.trend.icon} ${v.trend.label}</div>${spark}</div></td>`;
}

function channelPill(channel) {
  const avatarUrl = channelAvatars[channel];
  const letter = channel.charAt(0).toUpperCase();
  const avatarHtml = avatarUrl
    ? `<img class="channel-avatar-img" src="${avatarUrl}" alt="" />`
    : `<span class="channel-avatar">${letter}</span>`;
  // Bam vao avatar hoac ten kenh la mo thang trang chu TikTok cua kenh do.
  return `<a class="channel-pill" href="https://www.tiktok.com/@${channel}" target="_blank" rel="noopener">${avatarHtml}@${channel}</a>`;
}

// ---------------------------------------------------------------------------
// Chọn nhiều dòng: Ctrl/Cmd+click thêm/bớt 1 dòng, Shift+click chọn cả
// khoảng, click thường chỉ chọn đúng 1 dòng đó - giống hệt kiểu chọn file
// trong Explorer trên laptop.
// ---------------------------------------------------------------------------
function updateSelectionUI() {
  document.querySelectorAll("#videoTableBody tr").forEach((tr) => {
    tr.classList.toggle("row-selected", selectedIds.has(tr.dataset.id));
  });
  const bar = document.getElementById("bulkActionBar");
  if (selectedIds.size > 0) {
    bar.style.display = "flex";
    document.getElementById("bulkCount").textContent = selectedIds.size;
  } else {
    bar.style.display = "none";
  }
}

function rowClickHandler(e) {
  if (e.target.closest("button, a")) return; // khong tinh click vao nut/link ben trong dong
  if (justDragged) { justDragged = false; return; } // vua keo chon xong, bo qua click ke tiep

  const id = e.currentTarget.dataset.id;
  const idsInOrder = currentList.map((v) => v.id);

  if (e.shiftKey && lastClickedId && idsInOrder.includes(lastClickedId)) {
    const i1 = idsInOrder.indexOf(lastClickedId);
    const i2 = idsInOrder.indexOf(id);
    const [from, to] = i1 < i2 ? [i1, i2] : [i2, i1];
    for (let i = from; i <= to; i++) selectedIds.add(idsInOrder[i]);
  } else if (e.ctrlKey || e.metaKey) {
    if (selectedIds.has(id)) selectedIds.delete(id);
    else selectedIds.add(id);
    lastClickedId = id;
  } else {
    selectedIds = new Set([id]);
    lastClickedId = id;
  }
  updateSelectionUI();
}

document.getElementById("bulkClearSelection").addEventListener("click", () => {
  selectedIds = new Set();
  updateSelectionUI();
});

document.getElementById("bulkDeleteSelected").addEventListener("click", () => {
  const ids = Array.from(selectedIds);
  ids.forEach((id) => {
    const tr = document.querySelector(`#videoTableBody tr[data-id="${id}"]`);
    if (tr) tr.classList.add("row-deleting");
  });
  selectedIds = new Set();
  updateSelectionUI();
  setTimeout(() => {
    ids.forEach((id) => deleteVideo(id));
  }, 400);
});

// ---------------------------------------------------------------------------
// Kéo chuột chọn nhiều dòng cùng lúc (quét 1 vùng), giống Explorer.
// Dùng requestAnimationFrame thay vì tính lại mỗi sự kiện mousemove (mousemove
// bắn ra rất nhiều lần/giây, tính toán ngay trên từng cái làm giật/khựng) -
// chỉ tính 1 lần/khung hình, mượt hơn hẳn. Kèm tự cuộn khi kéo gần mép trên/
// dưới bảng để chọn được cả các dòng đang nằm ngoài màn hình.
// ---------------------------------------------------------------------------
let dragStart = null;   // toạ độ TRANG (client + cuộn) lúc bấm xuống
let dragMoved = false;
let justDragged = false;
let dragBox = null;
let dragCur = null;     // toạ độ client hiện tại của chuột
let dragRafId = null;
let dragRects = null;   // vị trí các dòng (toạ độ trang), chụp 1 lần - không đo lại mỗi khung hình
let dragLastT = 0;
const tableWrapEl = document.querySelector(".table-wrap");

function dragMeasure() {
  const sx = window.scrollX, sy = window.scrollY;
  dragRects = [];
  document.querySelectorAll("#videoTableBody tr").forEach((tr) => {
    const r = tr.getBoundingClientRect();
    dragRects.push({ tr, id: tr.dataset.id, l: r.left + sx, r: r.right + sx, t: r.top + sy, b: r.bottom + sy });
  });
}

function dragSetBar() {
  const bar = document.getElementById("bulkActionBar");
  bar.style.display = selectedIds.size > 0 ? "flex" : "none";
  document.getElementById("bulkCount").textContent = selectedIds.size;
}

function dragFrame(ts) {
  dragRafId = null;
  if (!dragStart || !dragCur) return;
  const dt = Math.min(40, dragLastT ? ts - dragLastT : 16);
  dragLastT = ts;

  // Tự cuộn TRANG khi chuột sát mép trên/dưới: càng sát mép càng nhanh, tăng dần (không giật cục),
  // tốc độ tính theo thời gian nên máy nhanh/chậm cuộn đều như nhau.
  const edge = 80, maxV = 1.25; // px mỗi ms
  let v = 0;
  if (dragCur.y < edge) v = -Math.pow(Math.min(1, (edge - dragCur.y) / edge), 1.6) * maxV;
  else if (dragCur.y > window.innerHeight - edge) v = Math.pow(Math.min(1, (dragCur.y - (window.innerHeight - edge)) / edge), 1.6) * maxV;
  if (v) window.scrollBy(0, v * dt);

  const sx = window.scrollX, sy = window.scrollY;
  const cx = dragCur.x + sx, cy = dragCur.y + sy;      // chuột, toạ độ trang
  const x1 = Math.min(dragStart.x, cx), x2 = Math.max(dragStart.x, cx);
  const y1 = Math.min(dragStart.y, cy), y2 = Math.max(dragStart.y, cy);

  // Khung kéo: chỉ đổi transform + kích thước (không đụng bố cục).
  dragBox.style.transform = "translate(" + (x1 - sx) + "px," + (y1 - sy) + "px)";
  dragBox.style.width = (x2 - x1) + "px";
  dragBox.style.height = (y2 - y1) + "px";

  if (!dragRects || (dragRects[0] && !dragRects[0].tr.isConnected)) dragMeasure();
  // Chỉ đổi class những dòng thật sự đổi trạng thái.
  const next = new Set();
  let changed = false;
  for (const o of dragRects) {
    const hit = !(o.r < x1 || o.l > x2 || o.b < y1 || o.t > y2);
    if (hit) next.add(o.id);
    if (hit !== selectedIds.has(o.id)) { o.tr.classList.toggle("row-selected", hit); changed = true; }
  }
  if (changed) { selectedIds = next; dragSetBar(); }

  dragRafId = requestAnimationFrame(dragFrame);
}

tableWrapEl.addEventListener("mousedown", (e) => {
  if (e.target.closest("button, a, input, select")) return;
  if (e.button !== 0) return;
  e.preventDefault(); // không bôi đen chữ, không kéo ảnh khi đang quét chọn
  dragStart = { x: e.clientX + window.scrollX, y: e.clientY + window.scrollY };
  dragCur = { x: e.clientX, y: e.clientY };
  dragMoved = false;
  dragRects = null;
});

document.addEventListener("mousemove", (e) => {
  if (!dragStart) return;
  dragCur = { x: e.clientX, y: e.clientY };
  if (!dragMoved) {
    const dx = Math.abs(e.clientX + window.scrollX - dragStart.x), dy = Math.abs(e.clientY + window.scrollY - dragStart.y);
    if (dx > 4 || dy > 4) {
      dragMoved = true;
      dragBox = document.createElement("div");
      dragBox.className = "drag-select-box";
      document.body.appendChild(dragBox);
      document.body.classList.add("dragging-select");
      dragMeasure();
      dragLastT = 0;
      dragRafId = requestAnimationFrame(dragFrame);
    }
  }
});

function dragEnd() {
  if (dragStart && dragMoved) justDragged = true;
  if (dragRafId) { cancelAnimationFrame(dragRafId); dragRafId = null; }
  if (dragBox) { dragBox.remove(); dragBox = null; }
  document.body.classList.remove("dragging-select");
  dragStart = null;
  dragCur = null;
  dragRects = null;
}
document.addEventListener("mouseup", dragEnd);
window.addEventListener("blur", dragEnd);

const SHOP_URL = (pid) => `https://www.tiktok.com/shop/vn/pdp/${pid}`;
function cartCell(v) {
  const c = cartData[v.id];
  if (!c) return `<td class="cart-cell"><span title="Chưa lấy dữ liệu giỏ hàng. Mở kênh này trên TikToday rồi bấm \"Lấy giỏ hàng\" trong popup." style="opacity:.5">—</span></td>`;
  if (!c.products.length) return `<td class="cart-cell"><span style="opacity:.6;font-size:11px">Không gắn giỏ</span></td>`;
  const items = c.products.slice(0, 3).map((p) => {
    const t = (p.title || "Sản phẩm").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    return `<div class="cart-item xem-cell" style="align-items:center;margin-bottom:2px;white-space:nowrap"><a href="${SHOP_URL(p.id)}" target="_blank" rel="noopener" title="${t}">🛒 Mở</a><button class="btn btn-ghost btn-sq btn-cart-qr" data-url="${SHOP_URL(p.id)}" title="Mã QR sản phẩm">QR</button><button class="btn btn-ghost btn-sq btn-watch" data-pid="${p.id}" data-title="${t}" title="Thêm vào theo dõi sản phẩm">⭐</button></div>`;
  }).join("");
  const more = c.products.length > 3 ? `<div style="font-size:10px;opacity:.7">+${c.products.length - 3} sản phẩm khác</div>` : "";
  return `<td class="cart-cell">${items}${more}</td>`;
}

function renderTable(list) {
  tableBody.innerHTML = "";
  emptyState.style.display = list.length === 0 ? "block" : "none";

  list.forEach((v, idx) => {
    const tr = document.createElement("tr");
    tr.dataset.id = v.id;
    tr.classList.toggle("row-selected", selectedIds.has(v.id));
    const gainClass = v.gain > 0 ? "gain-up" : "";
    const gainText = v.gain > 0 ? "+" + formatNumberDot(v.gain) : "0";

    tr.innerHTML = `
      <td>${channelPill(v.channel)}</td>
      <td>${formatDate(v.createTime)}</td>
      <td>${formatNumberDot(v.currentViews)}</td>
      <td class="${gainClass}">${gainText}</td>
      <td>${formatNumberDot(v.viewsPerDay)}</td>
      ${firstEntryCell(v.firstEntry)}
      ${historyCell(v.recentHistory, 0)}
      ${historyCell(v.recentHistory, 1)}
      ${historyCell(v.recentHistory, 2)}
      ${historyCell(v.recentHistory, 3)}
      ${trendCell(v)}
      ${cartCell(v)}
      <td class="link-cell"><a href="${v.pageUrl}" target="_blank" rel="noopener" title="Mở video trên TikTok">🔗 Mở</a></td>
      <td>
        <div class="xem-cell">
          <button class="btn btn-pink btn-view" data-id="${v.id}">Xem video</button>
          <button class="btn btn-ghost btn-sq btn-qr" data-url="${v.pageUrl}" title="Mã QR - quét bằng điện thoại để mở video">QR</button>
        </div>
      </td>
      <td><button class="btn-delete-row" data-id="${v.id}" title="Xoá (đưa vào thùng rác)">✕</button></td>
    `;
    tableBody.appendChild(tr);
  });

  document.querySelectorAll(".btn-delete-row").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const tr = btn.closest("tr");
      tr.classList.add("row-deleting");
      selectedIds.delete(btn.dataset.id);
      updateSelectionUI();
      setTimeout(() => deleteVideo(btn.dataset.id), 400);
    });
  });

  document.querySelectorAll("#videoTableBody tr").forEach((tr) => {
    tr.addEventListener("click", rowClickHandler);
  });

  document.querySelectorAll(".btn-view").forEach((btn) => {
    btn.addEventListener("click", () => {
      const params = new URLSearchParams({
        id: btn.dataset.id,
        channel: filterChannelEl.value || "",
        sort: sortByEl.value,
      });
      // Mo cung tab hien tai (khong mo tab moi) - theo yeu cau cua sep.
      window.location.href = chrome.runtime.getURL("viewer.html") + "?" + params.toString();
    });
  });

  document.querySelectorAll(".btn-qr").forEach((btn) => {
    btn.addEventListener("click", () => openQrModal(btn.dataset.url));
  });
  document.querySelectorAll(".btn-watch").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const { watchlist } = await chrome.storage.local.get("watchlist");
      const wl = watchlist || {};
      if (!wl[btn.dataset.pid]) wl[btn.dataset.pid] = { id: btn.dataset.pid, title: btn.dataset.title, addedAt: Date.now() };
      await chrome.storage.local.set({ watchlist: wl });
      btn.textContent = "✔";
      btn.title = "Đã có trong danh sách theo dõi";
    });
  });
  document.querySelectorAll(".btn-cart-qr").forEach((btn) => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); openQrModal(btn.dataset.url, "Quét mã để mở sản phẩm trên TikTok Shop"); });
  });
}

// ---------------------------------------------------------------------------
// Mã QR - quét bằng điện thoại để mở thẳng video đó, không mở tab trên máy.
// Dùng API ảnh QR công khai (chỉ load ảnh, không chạy script ngoài nên
// không vi phạm CSP của Manifest V3).
// ---------------------------------------------------------------------------
function openQrModal(url, title) {
  const overlay = document.getElementById("qrModal");
  const tEl = overlay.querySelector(".qr-title");
  if (tEl) tEl.textContent = title || "Quét mã để mở video trên điện thoại";
  const img = document.getElementById("qrImage");
  img.src = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(url)}`;
  document.getElementById("qrLinkText").textContent = url;
  overlay.style.display = "flex";
}
document.getElementById("qrModalClose").addEventListener("click", () => {
  document.getElementById("qrModal").style.display = "none";
});
document.getElementById("qrModal").addEventListener("click", (e) => {
  if (e.target.id === "qrModal") document.getElementById("qrModal").style.display = "none";
});

// ---------------------------------------------------------------------------
// Giải thích các bộ lọc/xu hướng - cho khách đọc hiểu nhanh.
// ---------------------------------------------------------------------------
document.getElementById("btnHelp").addEventListener("click", () => {
  document.getElementById("helpModal").style.display = "flex";
});
document.getElementById("helpModalClose").addEventListener("click", () => {
  document.getElementById("helpModal").style.display = "none";
});
document.getElementById("helpModal").addEventListener("click", (e) => {
  if (e.target.id === "helpModal") document.getElementById("helpModal").style.display = "none";
});

function hashtagsOf(desc) {
  return Array.from(new Set((String(desc || "").toLowerCase().match(/#[\p{L}\p{N}_]+/gu) || [])));
}

// Xếp hạng hashtag = cộng tốc độ tăng view/ngày của các clip dùng hashtag đó (hashtag đứng đầu thường là bài nhảy đang lên).
function renderHash() {
  const box = document.getElementById("hashBox");
  if (!box) return;
  const agg = {};
  allVideos.forEach((v) => {
    hashtagsOf(v.desc).forEach((h) => {
      const a = agg[h] || (agg[h] = { clips: 0, speed: 0, views: 0 });
      a.clips += 1;
      a.speed += v.viewsPerDay || 0;
      a.views += v.currentViews || 0;
    });
  });
  const top = Object.entries(agg).sort((a, b) => (b[1].speed - a[1].speed) || (b[1].views - a[1].views)).slice(0, 12);
  if (!top.length) {
    box.innerHTML = "<h3>🔥 Hashtag đang lên</h3><div class='hash-note'>Chưa có dữ liệu. Quét kênh nhảy ít nhất 2 lần (cách nhau vài giờ) để biết tốc độ tăng.</div>";
    return;
  }
  box.innerHTML = "<h3>🔥 Hashtag đang lên (xếp theo tốc độ tăng view/ngày)</h3><div class='hash-row'>" +
    top.map(([h, a]) => `<button class="hash-chip${hashFilter === h ? " on" : ""}" data-h="${h}">${h} · <b>${a.clips} clip</b> · ${a.speed > 0 ? "▲" + formatNumber(a.speed) + "/ngày" : formatNumber(a.views) + " view"}</button>`).join("") +
    "</div><div class='hash-note'>Bấm một hashtag để chỉ xem clip dùng nó, bấm lại để bỏ lọc. Số ▲ chỉ có sau khi một clip được quét từ 2 lần trở lên.</div>";
  box.querySelectorAll(".hash-chip").forEach((b) => b.addEventListener("click", () => {
    hashFilter = hashFilter === b.dataset.h ? "" : b.dataset.h;
    renderAll();
  }));
}

function renderCards(list) {
  const grid = document.getElementById("cardGrid");
  if (!grid) return;
  grid.innerHTML = list.length ? list.map((v, i) => `<div class="vcard" data-i="${i}"><img loading="lazy" src="${v.coverUrl || ""}" alt=""><span class="vc-trend">${v.trend.icon}</span><div class="vc-info"><b>@${v.channel}</b><span>👁 ${formatNumber(v.currentViews)}</span><span class="up">▲ ${formatNumber(v.viewsPerDay)}/ngày</span></div></div>`).join("") : "<div class='card-hint'>Chưa có clip nào. Mở popup, sang tab Soi kênh nhảy, dán link kênh rồi bấm Bắt đầu quét.</div>";
  grid.querySelectorAll(".vcard").forEach((c) => c.addEventListener("click", () => openCard(+c.dataset.i)));
}

// ---- Xem nhanh một clip ngay trong trang (video sạch lấy qua TikWM), chuyển ‹ ›, tải về KHO VIDEO MẪU ----
let vcIndex = -1;
async function loadTikWMData(pageUrl) {
  const res = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(pageUrl)}`);
  const data = await res.json();
  if (!data || data.code !== 0 || !data.data) throw new Error(data && data.msg ? data.msg : "TikWM không trả dữ liệu");
  return data.data;
}
let vcData = null;
async function openCard(i) {
  const v = currentList[i];
  if (!v) return;
  vcIndex = i;
  vcData = null;
  const player = document.getElementById("vcPlayer");
  document.getElementById("vcModal").style.display = "flex";
  document.getElementById("vcTitle").textContent = `@${v.channel} · ${v.desc || "(không mô tả)"}`.slice(0, 160);
  document.getElementById("vcStat").textContent = `👁 ${formatNumberDot(v.currentViews)} view · ▲ ${formatNumberDot(v.viewsPerDay)}/ngày · ${v.trend.icon} ${v.trend.label}`;
  document.getElementById("vcOpen").href = v.pageUrl;
  document.getElementById("vcPrev").disabled = i <= 0;
  document.getElementById("vcNext").disabled = i >= currentList.length - 1;
  const msg = document.getElementById("vcMsg");
  msg.textContent = ""; msg.className = "vc-msg";
  document.getElementById("vcSave").disabled = true;
  document.getElementById("vcLoading").style.display = "flex";
  player.pause(); player.removeAttribute("src");
  try {
    const d = await loadTikWMData(v.pageUrl);
    if (vcIndex !== i) return;
    vcData = d;
    player.src = d.play || d.hdplay || d.wmplay || "";
    try { const pp = player.play(); if (pp && pp.catch) pp.catch(() => {}); } catch (e) { /* trình duyệt chặn tự phát: sếp bấm play */ }
    document.getElementById("vcLoading").style.display = "none";
    document.getElementById("vcSave").disabled = false;
    document.getElementById("vcStat").textContent += ` · ❤ ${formatNumber(d.digg_count)} · 💬 ${formatNumber(d.comment_count)} · ↪ ${formatNumber(d.share_count)}`;
  } catch (e) {
    document.getElementById("vcLoading").textContent = "Không lấy được video (TikWM lỗi). Bấm Mở TikTok để xem.";
  }
}
function closeCard() {
  const p = document.getElementById("vcPlayer");
  p.pause(); p.removeAttribute("src");
  document.getElementById("vcModal").style.display = "none";
  document.getElementById("vcLoading").textContent = "Đang lấy video…";
  vcIndex = -1;
}
document.getElementById("vcClose").addEventListener("click", closeCard);
document.getElementById("vcModal").addEventListener("click", (e) => { if (e.target.id === "vcModal") closeCard(); });
document.getElementById("vcPrev").addEventListener("click", () => openCard(vcIndex - 1));
document.getElementById("vcNext").addEventListener("click", () => openCard(vcIndex + 1));
document.addEventListener("keydown", (e) => {
  if (vcIndex < 0) return;
  if (e.key === "Escape") closeCard();
  else if (e.key === "ArrowLeft") openCard(vcIndex - 1);
  else if (e.key === "ArrowRight") openCard(vcIndex + 1);
});
document.getElementById("vcSave").addEventListener("click", async () => {
  const v = currentList[vcIndex];
  const msg = document.getElementById("vcMsg");
  const btn = document.getElementById("vcSave");
  if (!v || !vcData) return;
  const setMsg = (s, c) => { msg.textContent = s; msg.className = "vc-msg " + (c || ""); };
  try {
    btn.disabled = true;
    const { khoCfg } = await chrome.storage.local.get("khoCfg");
    const cfg = Object.assign({ url: "http://localhost:8800", key: "" }, khoCfg || {});
    if (!cfg.key) throw new Error("Chưa nhập mật khẩu bảng điều khiển trong tiện ích (tab Ảnh sản phẩm, khung Kết nối).");
    setMsg("Đang tải video về…");
    const src = vcData.hdplay || vcData.play || vcData.wmplay;
    const r = await fetch(src);
    if (!r.ok) throw new Error("tải video lỗi " + r.status);
    const blob = await r.blob();
    setMsg("Đang chép vào kho (" + (blob.size / 1048576).toFixed(1) + " MB)…");
    const meta = encodeURIComponent(JSON.stringify({ channel: "@" + v.channel, desc: v.desc || "", views: v.currentViews, link: v.pageUrl }));
    const res = await fetch(cfg.url.replace(/\/+$/, "") + "/api/video_mau_upload?name=" + encodeURIComponent(`${v.channel}_${v.id}.mp4`) + "&meta=" + meta, { method: "POST", headers: { "X-Key": cfg.key }, body: blob });
    if (res.status === 401) throw new Error("sai mật khẩu bảng điều khiển");
    const j = await res.json();
    if (j.ok === false) throw new Error(j.error || "lỗi");
    setMsg(j.dup ? "Video này đã có sẵn trong KHO VIDEO MẪU." : "✓ Đã tải về KHO VIDEO MẪU (" + (j.size / 1048576).toFixed(1) + " MB).", "ok");
  } catch (e) {
    setMsg("⚠ " + (e.message || e) + (/Failed to fetch/i.test(String(e.message)) ? " (bảng điều khiển đã bật chưa?)" : ""), "bad");
  } finally {
    btn.disabled = false;
  }
});

function renderAll() {
  currentList = getFilteredSortedList();
  renderMetrics(currentList);
  renderTable(currentList);
  if (DMODE) { renderHash(); renderCards(currentList); }
}

filterChannelEl.addEventListener("change", renderAll);
sortByEl.addEventListener("change", renderAll);
filterTrendEl.addEventListener("change", renderAll);
filterCartEl.addEventListener("change", renderAll);

// Chuyển qua lại giữa "Phân tích video" và "Theo dõi sản phẩm" (trang sản phẩm nằm trong khung bên dưới).
function showView(which) {
  const prod = which === "products";
  const imgs = which === "images";
  const viral = which === "viral";
  document.getElementById("videoView").style.display = prod || imgs || viral ? "none" : "";
  document.getElementById("viralView").style.display = viral ? "" : "none";
  document.getElementById("tabViral").classList.toggle("active", viral);
  const fv = document.getElementById("viralFrame");
  if (viral && !fv.getAttribute("src")) fv.setAttribute("src", "dashboard.html?mode=dance&embed=1");
  document.getElementById("prodView").style.display = prod ? "" : "none";
  document.getElementById("imgView").style.display = imgs ? "" : "none";
  document.getElementById("tabVideos").classList.toggle("active", !prod && !imgs && !viral);
  document.getElementById("tabProducts").classList.toggle("active", prod);
  document.getElementById("tabImages").classList.toggle("active", imgs);
  const fr = document.getElementById("prodFrame");
  if (prod && !fr.getAttribute("src")) fr.setAttribute("src", "products.html?embed=1");
  const fi = document.getElementById("imgFrame");
  if (imgs && !fi.getAttribute("src")) fi.setAttribute("src", "images.html?embed=1");
  try { history.replaceState(null, "", prod ? "#products" : imgs ? "#images" : viral ? "#dance" : "#"); } catch (e) { /* khong sao */ }
}
function activeFrame() {
  if (document.getElementById("tabViral").classList.contains("active")) return document.getElementById("viralFrame");
  if (document.getElementById("tabProducts").classList.contains("active")) return document.getElementById("prodFrame");
  if (document.getElementById("tabImages").classList.contains("active")) return document.getElementById("imgFrame");
  return null;
}
document.getElementById("btnClearAll").addEventListener("click", () => {
  const fr = activeFrame();
  if (!fr) { window.__clearAll(); return; }
  try { fr.contentWindow.__clearAll(); } catch (e) { alert("Tab này chưa tải xong, đợi một chút rồi bấm lại."); }
});
// Ở tab viral / sản phẩm / ảnh: nút 🗑️ mở thùng rác của đúng tab đó (capture để chạy trước cái mở khung của tab đầu).
document.getElementById("btnTrash").addEventListener("click", (e) => {
  const fr = activeFrame();
  if (!fr) return;
  e.stopImmediatePropagation();
  try { fr.contentWindow.__openTrash(); } catch (er) { alert("Tab này chưa tải xong, đợi một chút rồi bấm lại."); }
}, true);
document.getElementById("tabVideos").addEventListener("click", () => showView("videos"));
document.getElementById("tabProducts").addEventListener("click", () => showView("products"));
document.getElementById("tabImages").addEventListener("click", () => showView("images"));
document.getElementById("tabViral").addEventListener("click", () => showView("viral"));
function setSub(cards) {
  document.documentElement.classList.toggle("show-cards", cards);
  document.getElementById("stTable").classList.toggle("active", !cards);
  document.getElementById("stCards").classList.toggle("active", cards);
  document.getElementById("cardView").style.display = cards ? "" : "none";
}
document.getElementById("stTable").addEventListener("click", () => setSub(false));
document.getElementById("stCards").addEventListener("click", () => setSub(true));
if (DMODE) {
  document.title = "Quangg Ving Scanner Pro - Phân tích video viral";
  document.getElementById("pageSubtitle").textContent = "Soi các kênh nhảy để biết bài nhảy nào đang lên: clip nào tăng view nhanh nhất, hashtag nào đang dẫn đầu.";
}
if (location.hash === "#dance" && !DMODE) showView("viral");
if (location.hash === "#images") showView("images");
if (location.hash === "#products") showView("products");

// ---------------------------------------------------------------------------
// Xuất Excel (SheetJS local - Manifest V3 chặn tải script từ CDN lúc chạy)
// ---------------------------------------------------------------------------
function exportExcel() {
  const rows = currentList.map((v) => ({
    "Kênh": "@" + v.channel,
    "Ngày đăng": formatDate(v.createTime),
    "View hiện tại": v.currentViews,
    "Tăng": v.gain,
    "View/ngày": v.viewsPerDay,
    "Lần đầu": v.firstEntry ? v.firstEntry.views : "",
    "Lần 1": v.recentHistory[0] ? v.recentHistory[0].views : "",
    "Lần 2": v.recentHistory[1] ? v.recentHistory[1].views : "",
    "Lần 3": v.recentHistory[2] ? v.recentHistory[2].views : "",
    "Lần 4": v.recentHistory[3] ? v.recentHistory[3].views : "",
    "Xu hướng": `${v.trend.icon} ${v.trend.label}`,
    "% từ lần đầu": v.growthPct !== null ? v.growthPct + "%" : "",
    "Link clip": v.pageUrl,
    "Sản phẩm gắn giỏ": cartData[v.id] ? cartData[v.id].products.map((p) => p.title).join(" | ") : "",
    "Link TikTok Shop": cartData[v.id] ? cartData[v.id].products.map((p) => SHOP_URL(p.id)).join(" | ") : "",
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Scanner");

  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const fileName = `QuanggVing_Scanner_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.xlsx`;
  XLSX.writeFile(wb, fileName);
}
document.getElementById("btnExportExcel").addEventListener("click", exportExcel);

// ---------------------------------------------------------------------------
// Sao lưu ngay (nút) + Nhập file sao lưu (gộp vào dữ liệu hiện có, không
// xoá/ghi đè gì - giống tinh thần thùng rác, ưu tiên không mất dữ liệu).
// ---------------------------------------------------------------------------
document.getElementById("btnBackupNow").addEventListener("click", async (e) => {
  const btn = e.target;
  const original = btn.textContent;
  btn.textContent = "Đang sao lưu...";
  btn.disabled = true;
  try {
    await chrome.runtime.sendMessage({ type: "backup_now" });
    btn.textContent = "✓ Đã sao lưu";
  } catch (err) {
    btn.textContent = "Lỗi sao lưu";
  }
  setTimeout(() => {
    btn.textContent = original;
    btn.disabled = false;
  }, 2000);
});

function mergeHistory(a, b) {
  const map = new Map();
  for (const e of a || []) map.set(e.ts, e);
  for (const e of b || []) map.set(e.ts, e);
  return Array.from(map.values()).sort((x, y) => x.ts - y.ts);
}

document.getElementById("btnImportBackup").addEventListener("click", () => {
  document.getElementById("importFileInput").click();
});

document.getElementById("importFileInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = ""; // cho chon lai dung file do lan sau neu can
  if (!file) return;

  let parsed;
  try {
    const text = await file.text();
    parsed = JSON.parse(text);
  } catch (err) {
    alert("File không đúng định dạng sao lưu (.json) của tool này.");
    return;
  }

  const current = await chrome.storage.local.get(["videos", "videosTrash", "channelAvatars", "channelFollowers"]);
  const videos = current.videos || {};
  const videosTrash = current.videosTrash || {};
  const channelAvatars = Object.assign({}, parsed.channelAvatars || {}, current.channelAvatars || {});
  const channelFollowers = Object.assign({}, parsed.channelFollowers || {}, current.channelFollowers || {});

  let addedCount = 0, mergedCount = 0;
  for (const [id, v] of Object.entries(parsed.videos || {})) {
    if (videos[id]) {
      videos[id].history = mergeHistory(videos[id].history, v.history);
      mergedCount++;
    } else {
      videos[id] = v;
      addedCount++;
    }
  }
  for (const [id, v] of Object.entries(parsed.videosTrash || {})) {
    if (!videos[id] && !videosTrash[id]) videosTrash[id] = v;
  }

  await chrome.storage.local.set({ videos, videosTrash, channelAvatars, channelFollowers });
  await loadVideos();
  alert(`Nhập xong: thêm mới ${addedCount} video, gộp lịch sử thêm cho ${mergedCount} video đã có sẵn.`);
});

// ---------------------------------------------------------------------------
// Khởi động
// ---------------------------------------------------------------------------
loadVideos().then(() => {
  const params = new URLSearchParams(window.location.search);
  if (params.get("export") === "1") exportExcel();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "scan_progress" && (msg.mode || "rival") === (DMODE ? "dance" : "rival")) loadVideos();
});
