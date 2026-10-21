// ============================================================================
// products.js - trang "Theo dõi sản phẩm".
// Dữ liệu (chrome.storage.local): watchlist {id:{id,title,cover,shop,addedAt,lastError}},
// productSnaps {id:[{t,sold,rev,cr,vid,live,comm,rating,reviews,shopRating,price}]},
// productTrend7 {id:{t,pts:[doanh thu cộng dồn 8 điểm],label}}.
// Số nào TikToday không có thì = 0 → coi là "chưa rõ" (không phải trượt).
// ============================================================================

// ---- CÁC NGƯỠNG (ước lượng, chỉnh ở đây) ----
const T = {
  priceMin: 30000, priceMax: 500000,
  commMin: 8,
  ratingMin: 4.5, ratingNeedReviews: 50,
  soldMax: 100000, creatorsMax: 500,
  creatorsOk: 150,          // ≤ mức này = còn chỗ cho mình
  videoGrowFast: 15,        // video tăng thêm trong ~3 ngày vượt mức này = đã đông
  ordersPerDayMin: 10,      // đơn/ngày tối thiểu để coi là "có cầu"
  soldBuilding: 500,        // dưới mức này = chưa đủ dữ liệu
};

const DAY = 86400000;
const $ = (id) => document.getElementById(id);
const fmt = (n) => (n == null || isNaN(n) ? "—" : Math.round(n).toLocaleString("vi-VN"));
const fmtMoney = (n) => (n ? Math.round(n).toLocaleString("vi-VN") + "đ" : "—");
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let watchlist = {}, snaps = {}, trend7 = {};

function dayKey(t) {
  const d = new Date(t);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// Mỗi ngày lấy điểm đo cuối cùng, rồi tính số đơn tăng giữa 2 ngày liền nhau.
function dailyOrdersFromSnaps(arr, windowDays) {
  if (!arr || arr.length < 2) return [];
  const cutoff = Date.now() - windowDays * DAY;
  const byDay = new Map();
  arr.forEach((s) => { byDay.set(dayKey(s.t), s); });
  const days = Array.from(byDay.values()).sort((a, b) => a.t - b.t);
  const out = [];
  for (let i = 1; i < days.length; i++) {
    if (days[i].t < cutoff) continue;
    const gap = Math.max(1, Math.round((days[i].t - days[i - 1].t) / DAY));
    const d = Math.max(0, days[i].sold - days[i - 1].sold);
    for (let k = 0; k < gap; k++) out.push(d / gap); // ngày bỏ trống: chia đều
  }
  return out.slice(-windowDays);
}

// Biểu đồ 7 ngày của TikToday: doanh thu cộng dồn → đơn ước tính mỗi ngày (chia theo giá).
function dailyOrdersFromTrend(tr, price) {
  if (!tr || !tr.pts || tr.pts.length < 3 || !price) return [];
  const out = [];
  for (let i = 1; i < tr.pts.length; i++) out.push(Math.max(0, (tr.pts[i] - tr.pts[i - 1]) / price));
  return out;
}

function seriesFor(id, range) {
  const arr = snaps[id] || [];
  const last = arr[arr.length - 1];
  const price = last ? last.price : 0;
  const own = dailyOrdersFromSnaps(arr, range);
  const tk = dailyOrdersFromTrend(trend7[id], price);
  if (range <= 7) {
    if (tk.length >= own.length) return { pts: tk, src: "TikToday 7 ngày" };
    return { pts: own, src: "tool đo" };
  }
  return { pts: own, src: "tool đo" };
}

function avg(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }

// Xu hướng đơn: so 3 ngày cuối với các ngày trước đó.
function orderTrend(pts) {
  if (pts.length < 2) return { dir: "unk", perDay: pts.length ? pts[pts.length - 1] : null };
  const recent = pts.slice(-3);
  const before = pts.slice(0, Math.max(0, pts.length - recent.length));
  const r = avg(recent);
  if (!before.length) return { dir: r > 0 ? "flat" : "down", perDay: r };
  const b = avg(before);
  if (b <= 0) return { dir: r > 0 ? "up" : "flat", perDay: r };
  if (r >= b * 1.05) return { dir: "up", perDay: r };
  if (r < b * 0.8) return { dir: "down", perDay: r };
  return { dir: "flat", perDay: r };
}

function videoGrowth(arr) {
  if (!arr || arr.length < 2) return null;
  const last = arr[arr.length - 1];
  const ref = arr.slice().reverse().find((s) => last.t - s.t >= 2.5 * DAY) || arr[0];
  if (ref === last || !(last.vid > 0 || ref.vid > 0)) return null;
  return last.vid - ref.vid;
}

// ---- CHẤM ----
function judge(id) {
  const arr = snaps[id] || [];
  const s = arr[arr.length - 1];
  const why = [];      // lý do trượt (bỏ)
  const warn = [];     // yếu / cần theo dõi
  const unk = [];      // chưa rõ
  if (!s) return { v: "wait", why, warn, unk: ["chưa đo lần nào, bấm Cập nhật số liệu"], perDay: null, series: [], src: "" };

  const range7 = seriesFor(id, 7);
  const tr = orderTrend(range7.pts);

  // Giá
  const price = s.price || 0;
  if (price) { if (price < T.priceMin || price > T.priceMax) why.push(`giá ${fmtMoney(price)} ngoài ${fmt(T.priceMin / 1000)}K–${fmt(T.priceMax / 1000)}K`); }
  else unk.push("giá");
  // Hoa hồng (0 = TikToday chưa có)
  if (s.comm > 0) { if (s.comm < T.commMin) why.push(`hoa hồng ${s.comm}% dưới ${T.commMin}%`); }
  else unk.push("hoa hồng");
  // Sao
  if (s.rating > 0) {
    if (s.reviews >= T.ratingNeedReviews) { if (s.rating < T.ratingMin) why.push(`sao ${s.rating} dưới ${T.ratingMin}`); }
    else unk.push(`sao (mới ${s.reviews} đánh giá)`);
  } else unk.push("sao đánh giá");
  // Quá bão hoà
  if (s.sold > T.soldMax) why.push(`đã bán ${fmt(s.sold)} (quá bão hoà)`);
  if (s.cr > T.creatorsMax) why.push(`${fmt(s.cr)} creator (quá đông)`);
  // Đơn
  let c1 = "unk";
  if (tr.dir === "down") why.push("đơn đang giảm");
  else if (tr.dir === "unk") unk.push("xu hướng đơn (cần đo thêm ≥2 ngày)");
  else if (tr.perDay >= T.ordersPerDayMin) c1 = "ok";
  else { c1 = "weak"; warn.push(`đơn thấp (~${fmt(tr.perDay)}/ngày)`); }
  if (s.sold > 0 && s.sold < T.soldBuilding) warn.push(`mới bán ${fmt(s.sold)} (chưa đủ dữ liệu)`);
  // Chỗ cho mình
  let c2 = "unk";
  if (s.cr > 0 || s.vid > 0) {
    const g = videoGrowth(arr);
    if (s.cr > T.creatorsOk) { c2 = "weak"; warn.push(`${fmt(s.cr)} creator (khá đông)`); }
    else if (g != null && g > T.videoGrowFast) { c2 = "weak"; warn.push(`video tăng nhanh (+${g})`); }
    else c2 = "ok";
  } else unk.push("số creator/video (TikToday chưa có)");

  let v;
  if (why.length) v = "drop";
  else if (c1 === "ok" && c2 === "ok" && !unk.some((x) => x === "hoa hồng" || x.startsWith("sao")) && !warn.length) v = "go";
  else v = "wait";
  const used = range7.pts;
  return { v, why, warn, unk, perDay: tr.perDay, dir: tr.dir, series: used, src: range7.src };
}

// ---- VẼ ----
function sparkSvg(pts, color) {
  if (!pts || pts.length < 2) return '<span class="unk">chưa đủ điểm</span>';
  const w = 120, h = 34, pad = 3;
  const max = Math.max(...pts, 1), min = Math.min(...pts, 0);
  const sx = (i) => pad + (i * (w - 2 * pad)) / (pts.length - 1);
  const sy = (v) => h - pad - ((v - min) * (h - 2 * pad)) / (max - min || 1);
  const d = pts.map((p, i) => (i ? "L" : "M") + sx(i).toFixed(1) + "," + sy(p).toFixed(1)).join(" ");
  const lx = sx(pts.length - 1), ly = sy(pts[pts.length - 1]);
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/><circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2.5" fill="${color}"/></svg>`;
}

function unkOr(n, fn) { return n > 0 ? (fn ? fn(n) : fmt(n)) : '<span class="unk" title="TikToday chưa có số này">chưa rõ</span>'; }

function render() {
  const range = parseInt($("rangeSel").value, 10);
  const vf = $("verdictSel").value;
  const ids = Object.keys(watchlist);
  const body = $("prodBody");
  body.innerHTML = "";
  let shown = 0;
  const rows = ids.map((id) => ({ id, j: judge(id) }));
  const order = { go: 0, wait: 1, drop: 2 };
  rows.sort((a, b) => order[a.j.v] - order[b.j.v]);
  rows.forEach(({ id }) => {
    const w = watchlist[id];
    const j = judge(id);
    if (vf && j.v !== vf) return;
    const arr = snaps[id] || [];
    const s = arr[arr.length - 1];
    const ser = seriesFor(id, range);
    const daysMeasured = new Set(arr.map((x) => dayKey(x.t))).size;
    const color = j.dir === "down" ? "#ef4444" : j.dir === "up" ? "#22c55e" : "#eab308";
    const badge = j.v === "go" ? '<span class="badge badge-go">✅ Vào ngay</span>' : j.v === "drop" ? '<span class="badge badge-drop">❌ Bỏ</span>' : '<span class="badge badge-wait">🟡 Chờ / kiểm tay</span>';
    const reasons = [];
    if (j.why.length) reasons.push("Bỏ vì: " + j.why.join("; "));
    if (j.warn.length) reasons.push("Yếu: " + j.warn.join("; "));
    if (j.unk.length) reasons.push("Chưa rõ: " + j.unk.join("; "));
    const err = w.lastError ? `<div class="why" style="color:#ef4444">⚠ ${esc(w.lastError)}</div>` : "";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><div class="p-cell">${w.cover ? `<img src="${esc(w.cover)}" alt="" referrerpolicy="no-referrer" />` : '<img alt="" />'}<div><div class="p-title" title="${esc(w.title)}">${esc(w.title || id)}</div>
        <div class="p-sub">${w.shop ? esc(w.shop) + " · " : ""}<a href="https://tiktoday.vn/dashboard/products/${id}" target="_blank" rel="noopener">TikToday</a><a href="https://www.tiktok.com/shop/vn/pdp/${id}" target="_blank" rel="noopener">TikTok Shop</a></div></div></div></td>
      <td>${s ? fmtMoney(s.price) : "—"}</td>
      <td>${s ? fmt(s.sold) : "—"}</td>
      <td>${j.perDay == null ? '<span class="unk">chưa rõ</span>' : fmt(j.perDay)}</td>
      <td>${sparkSvg(ser.pts, color)}<div class="chart-note">${range} ngày · ${ser.src}${range > 7 || ser.src === "tool đo" ? ` · đã đo ${daysMeasured} ngày` : ""}</div></td>
      <td>${s ? unkOr(s.cr) : "—"}</td>
      <td>${s ? unkOr(s.vid) : "—"}</td>
      <td>${s ? unkOr(s.comm, (n) => n + "%") : "—"}</td>
      <td>${s ? unkOr(s.rating, (n) => n.toFixed(1) + " (" + fmt(s.reviews) + ")") : "—"}</td>
      <td>${badge}<div class="why">${reasons.map(esc).join("<br>")}</div>${err}</td>
      <td><button class="btn-delete-row" data-id="${id}" title="Bỏ khỏi danh sách theo dõi">✕</button></td>`;
    body.appendChild(tr);
    shown += 1;
  });
  $("prodEmpty").style.display = ids.length ? "none" : "block";
  $("prodEmpty").textContent = ids.length ? "" : "Danh sách theo dõi đang trống.";
  body.querySelectorAll(".btn-delete-row").forEach((b) => b.addEventListener("click", async () => {
    delete watchlist[b.dataset.id];
    await chrome.storage.local.set({ watchlist });
    render();
  }));
}

async function load() {
  const d = await chrome.storage.local.get(["watchlist", "productSnaps", "productTrend7", "trackLastRun", "themePreference", "trackState"]);
  watchlist = d.watchlist || {};
  snaps = d.productSnaps || {};
  trend7 = d.productTrend7 || {};
  document.documentElement.setAttribute("data-theme", d.themePreference === "light" ? "light" : "dark");
  $("btnThemeToggle").textContent = d.themePreference === "light" ? "☀️" : "🌙";
  $("lastRun").textContent = d.trackLastRun ? "Cập nhật: " + new Date(d.trackLastRun).toLocaleString("vi-VN") : "Chưa cập nhật lần nào";
  showTrackState(d.trackState);
  render();
}

function showTrackState(st) {
  const el = $("trackText");
  const btn = $("btnTrack");
  if (!st) return;
  if (st.running) {
    btn.textContent = "⏹ Dừng";
    el.textContent = `Đang đọc sản phẩm ${st.index || 0}/${st.total || 0}: ${st.current || ""} (thành công ${st.ok || 0}, lỗi ${st.fail || 0}). Mỗi sản phẩm mất khoảng 30–60 giây vì TikToday tải chậm. Đừng chuyển sang tab TikToday khác.`;
  } else {
    btn.textContent = "🔄 Cập nhật số liệu";
    if (st.error) el.textContent = "⚠ " + st.error;
    else if (st.done) el.textContent = `Xong: đọc được ${st.ok || 0}/${st.total || 0} sản phẩm${st.fail ? `, ${st.fail} lỗi (xem dòng đỏ)` : ""}${st.stopped ? " (đã dừng giữa chừng)" : ""}.`;
  }
}

function parseId(text) {
  const m = String(text || "").match(/(\d{15,22})/);
  return m ? m[1] : null;
}

$("btnAdd").addEventListener("click", async () => {
  const id = parseId($("addInput").value);
  if (!id) { $("trackText").textContent = "⚠ Không thấy mã sản phẩm trong link (cần dãy số 15–22 chữ số)."; return; }
  if (!watchlist[id]) watchlist[id] = { id, title: "", addedAt: Date.now() };
  await chrome.storage.local.set({ watchlist });
  $("addInput").value = "";
  $("trackText").textContent = "Đã thêm. Bấm \"Cập nhật số liệu\" để tool đọc số của mã này.";
  render();
});
$("addInput").addEventListener("keydown", (e) => { if (e.key === "Enter") $("btnAdd").click(); });

$("btnTrack").addEventListener("click", async () => {
  const { trackState } = await chrome.storage.local.get("trackState");
  if (trackState && trackState.running) { chrome.runtime.sendMessage({ type: "stop_track" }); return; }
  chrome.runtime.sendMessage({ type: "track_products" });
});
$("rangeSel").addEventListener("change", render);
$("verdictSel").addEventListener("change", render);
$("btnBackDash").addEventListener("click", () => { window.location.href = chrome.runtime.getURL("dashboard.html"); });
$("btnThemeToggle").addEventListener("click", async () => {
  const { themePreference } = await chrome.storage.local.get("themePreference");
  const next = themePreference === "light" ? "dark" : "light";
  await chrome.storage.local.set({ themePreference: next });
  document.documentElement.setAttribute("data-theme", next);
  $("btnThemeToggle").textContent = next === "light" ? "☀️" : "🌙";
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "track_progress") { showTrackState(msg.state); if (msg.state.done || (msg.state.ok || 0) % 1 === 0) load(); }
});
chrome.storage.onChanged.addListener((ch) => {
  if (ch.watchlist || ch.productSnaps || ch.productTrend7) {
    chrome.storage.local.get(["watchlist", "productSnaps", "productTrend7"]).then((d) => {
      watchlist = d.watchlist || {}; snaps = d.productSnaps || {}; trend7 = d.productTrend7 || {}; render();
    });
  }
});

// Xóa tất cả = chuyển cả danh sách theo dõi vào "thùng rác" (watchlistTrash); nút 🗑️ ở Dashboard khôi phục lại.
window.__clearAll = async () => {
  const n = Object.keys(watchlist).length;
  if (!n) { alert("Danh sách theo dõi đang trống."); return; }
  if (!confirm("Đưa cả " + n + " sản phẩm đang theo dõi vào thùng rác?")) return;
  const d = await chrome.storage.local.get("watchlistTrash");
  const trash = Object.assign({}, d.watchlistTrash || {}, watchlist);
  await chrome.storage.local.set({ watchlistTrash: trash, watchlist: {} });
  watchlist = {}; render();
};
window.__openTrash = async () => {
  const d = await chrome.storage.local.get(["watchlistTrash", "watchlist"]);
  const trash = d.watchlistTrash || {};
  const n = Object.keys(trash).length;
  if (!n) { alert("Thùng rác trống."); return; }
  if (!confirm("Thùng rác đang có " + n + " sản phẩm. Khôi phục tất cả về danh sách theo dõi?")) return;
  await chrome.storage.local.set({ watchlist: Object.assign({}, trash, d.watchlist || {}), watchlistTrash: {} });
};

if (new URLSearchParams(location.search).get("embed") === "1") {
  document.body.classList.add("embed");
}
load();
