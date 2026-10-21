// ============================================================================
// images.js - trang "Ảnh sản phẩm": mỗi sản phẩm 1 dòng, ảnh xếp ngang, mỗi ảnh có 1 ổ khóa.
// 🔓 (mở) = ảnh được đưa vào file JSON; 🔒 (đóng) = ảnh KHÔNG đưa vào.
// File JSON đúng định dạng "setup" của app Phối Đồ nhưng có mode "addProducts"
// (nhập vào chỉ THÊM sản phẩm, giữ nguyên mẫu và bối cảnh đang có).
// ============================================================================
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const KINDS = [["top", "Áo"], ["bottom", "Quần / chân váy"], ["dress", "Váy liền"], ["acc", "Phụ kiện"]];

let prodImages = {};

function countOpen() {
  let n = 0, p = 0;
  Object.values(prodImages).forEach((pr) => { const c = (pr.images || []).filter((i) => !i.locked).length; n += c; if (c) p += 1; });
  return { n, p };
}

// Cửa sổ phóng to (bấm ra ngoài hoặc Esc để đóng)
function openOverlay(innerHtml) {
  closeOverlay();
  const ov = document.createElement("div");
  ov.id = "bigOverlay";
  ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.8);display:flex;align-items:center;justify-content:center;z-index:99999;cursor:zoom-out";
  const box = document.createElement("div");
  box.style.cssText = "background:#fff;color:#111;padding:20px;border-radius:14px;text-align:center;max-width:92vw;max-height:92vh;overflow:auto";
  box.innerHTML = innerHtml;
  box.addEventListener("click", (e) => e.stopPropagation());
  ov.appendChild(box);
  ov.addEventListener("click", closeOverlay);
  document.body.appendChild(ov);
}
function closeOverlay() { const o = document.getElementById("bigOverlay"); if (o) o.remove(); }
let bigState = null;
function showBig(id, i) {
  const imgs = (prodImages[id] && prodImages[id].images) || [];
  if (!imgs.length) return;
  i = (i + imgs.length) % imgs.length;
  bigState = { id, i };
  const im = imgs[i];
  openOverlay(`<img src="${esc(im.u)}" referrerpolicy="no-referrer" style="max-width:86vw;max-height:78vh;display:block;margin:0 auto;border-radius:8px" alt="" />
    <div style="margin-top:10px;font-size:12px">${i + 1}/${imgs.length} · ${im.locked ? "🔒 đang khóa (không lấy)" : "🔓 đang mở (sẽ lấy)"} · phím ← → để chuyển ảnh, Esc để đóng</div>`);
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { closeOverlay(); bigState = null; }
  else if (bigState && document.getElementById("bigOverlay")) {
    if (e.key === "ArrowRight") showBig(bigState.id, bigState.i + 1);
    else if (e.key === "ArrowLeft") showBig(bigState.id, bigState.i - 1);
  }
});

async function save() { await chrome.storage.local.set({ prodImages }); }

function render() {
  const rows = $("imgRows");
  rows.innerHTML = "";
  const ids = Object.keys(prodImages).sort((a, b) => (prodImages[b].addedAt || 0) - (prodImages[a].addedAt || 0));
  ids.forEach((id) => {
    const pr = prodImages[id];
    const div = document.createElement("div");
    div.className = "prow";
    div.innerHTML = `
      <div class="prow-head">
        <div class="prow-title">${esc(pr.title || id)} <div class="prow-src">${esc(pr.source || "")} · ${(pr.images || []).length} ảnh · mã ${esc(id)}</div></div>
        <select data-kind="${id}">${KINDS.map(([v, l]) => `<option value="${v}"${pr.kind === v ? " selected" : ""}>${l}</option>`).join("")}</select>
        <button class="btn btn-ghost btn-sm${pr.source === "TikToday" ? "" : " link-off"}" data-tt="${id}" title="${pr.source === "TikToday" ? "Mở sản phẩm này trên TikToday" : "TikToday chưa có mã này"}">TikToday</button>
        <button class="btn btn-ghost btn-sm" data-shop="${id}" title="Mở sản phẩm này trên TikTok Shop">TikTok</button>
        <button class="btn btn-ghost btn-sm" data-qr="${id}" title="Mã QR: quét bằng điện thoại để mở đúng sản phẩm này trong app TikTok">QR</button>
        <button class="btn btn-ghost btn-sm" data-lockall="${id}" title="Khóa tất cả ảnh của sản phẩm này">🔒 Khóa hết</button>
        <button class="btn btn-ghost btn-sm" data-openall="${id}" title="Mở khóa tất cả">🔓 Mở hết</button>
        <button class="btn-delete-row" data-del="${id}" title="Xóa sản phẩm này">✕</button>
      </div>
      <div class="pimgs">${(pr.images || []).map((im, i) => `
        <div class="tile${im.locked ? " locked" : ""}">
          <img src="${esc(im.u)}" alt="" referrerpolicy="no-referrer" loading="lazy" data-big="${id}" data-bi="${i}" title="Bấm 2 lần để xem ảnh to" />
          <button class="lock-btn" data-id="${id}" data-i="${i}" title="${im.locked ? "Đang khóa: KHÔNG lấy ảnh này" : "Đang mở: sẽ lấy ảnh này"}">${im.locked ? "🔒" : "🔓"}</button>
        </div>`).join("")}</div>`;
    rows.appendChild(div);
  });
  $("imgEmpty").style.display = ids.length ? "none" : "block";
  const c = countOpen();
  $("exportInfo").textContent = c.n ? `Sẽ xuất ${c.n} ảnh (ổ khóa đang mở) của ${c.p} sản phẩm` : "Chưa có ảnh nào để xuất";
  rows.querySelectorAll(".lock-btn").forEach((b) => b.addEventListener("click", async () => {
    const im = prodImages[b.dataset.id].images[+b.dataset.i];
    im.locked = !im.locked; await save(); render();
  }));
  rows.querySelectorAll("[data-tt]").forEach((b) => b.addEventListener("click", () => {
    const id = b.dataset.tt;
    if (prodImages[id].source === "TikToday") window.open("https://tiktoday.vn/dashboard/products/" + id, "_blank");
    else $("imgStatus").textContent = "⚠ TikToday chưa có mã " + id + " (hàng mới hoặc chưa được TikToday ghi nhận), nên không có trang để mở.";
  }));
  rows.querySelectorAll("[data-shop]").forEach((b) => b.addEventListener("click", () => window.open("https://www.tiktok.com/shop/vn/pdp/" + b.dataset.shop, "_blank")));
  rows.querySelectorAll("[data-qr]").forEach((b) => b.addEventListener("click", () => {
    const id = b.dataset.qr;
    const url = "https://www.tiktok.com/shop/vn/pdp/" + id;
    openOverlay(`<div style="font-weight:700;margin-bottom:10px;font-size:14px">Quét mã để mở đúng sản phẩm này</div>
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(url)}" style="width:240px;height:240px;border-radius:8px;background:#fff;padding:8px" alt="QR" />
      <div style="font-size:11px;margin-top:8px;max-width:280px;word-break:break-word">${esc(prodImages[id].title || id)}</div>`);
  }));
  rows.querySelectorAll("img[data-big]").forEach((im) => im.addEventListener("dblclick", () => showBig(im.dataset.big, +im.dataset.bi)));
  rows.querySelectorAll("[data-lockall]").forEach((b) => b.addEventListener("click", async () => { prodImages[b.dataset.lockall].images.forEach((i) => (i.locked = true)); await save(); render(); }));
  rows.querySelectorAll("[data-openall]").forEach((b) => b.addEventListener("click", async () => { prodImages[b.dataset.openall].images.forEach((i) => (i.locked = false)); await save(); render(); }));
  rows.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => { delete prodImages[b.dataset.del]; await save(); render(); }));
  rows.querySelectorAll("select[data-kind]").forEach((s) => s.addEventListener("change", async () => { prodImages[s.dataset.kind].kind = s.value; await save(); }));
}

function showState(st) {
  if (!st) return;
  const el = $("imgStatus");
  $("btnGet").disabled = !!st.running;
  $("btnStopImg").style.display = st.running ? "" : "none";
  $("btnResume").style.display = st.running && st.paused ? "" : "none";
  if (st.running) {
    el.textContent = st.paused && st.note ? st.note : `Đang lấy ảnh ${st.finished || 0}/${st.total || 0} sản phẩm (TikToday ${st.fromTikToday || 0}, TikTok Shop ${st.fromShop || 0}). ${st.current || ""}`;
  } else if (st.done) {
    const f = (st.failed || []).length;
    el.textContent = `Xong: lấy được ${st.finished || 0}/${st.total || 0} sản phẩm (TikToday ${st.fromTikToday || 0}, TikTok Shop ${st.fromShop || 0}).` + (f ? ` Không lấy được ${f} mã: ${(st.failed || []).join(", ")}.` : "") + (st.note ? " " + st.note : "");
  }
}

// ---- Kết nối với bảng điều khiển (kho ảnh) ----
function showKho(st, cfg) {
  const el = $("khoStat");
  if (!cfg || !cfg.key) { el.textContent = "Chưa nhập mật khẩu (key)."; return; }
  if (st && st.online) el.innerHTML = '<span style="color:#16a34a">✔ Đã nối với bảng điều khiển</span>' + (st.working ? " · đang tải: " + String(st.working).slice(0, 60) : (st.pending ? " · còn " + st.pending + " link chờ" : " · không có link chờ")) + " · hỏi lúc " + new Date(st.lastPoll).toLocaleTimeString();
  else if (st && st.error) el.innerHTML = '<span style="color:#dc2626">✖ ' + st.error + "</span> (laptop đã chạy chay_bang_dieu_khien.bat chưa?)";
  else el.textContent = "Đang kiểm tra…";
}
async function loadKho() { const d = await chrome.storage.local.get(["khoCfg", "khoState"]); const c = d.khoCfg || { url: "http://localhost:8800", key: "" }; $("khoUrl").value = c.url; $("khoKey").value = c.key; showKho(d.khoState, c); }
$("khoSave").addEventListener("click", async () => {
  const cfg = { url: $("khoUrl").value.trim() || "http://localhost:8800", key: $("khoKey").value.trim() };
  await chrome.storage.local.set({ khoCfg: cfg });
  $("khoStat").textContent = "Đang kiểm tra…";
  await chrome.runtime.sendMessage({ type: "kho_poll_now" });
  const d = await chrome.storage.local.get("khoState"); showKho(d.khoState, cfg);
});
chrome.runtime.onMessage.addListener((msg) => { if (msg.type === "kho_state") chrome.storage.local.get("khoCfg").then((d) => showKho(msg.state, d.khoCfg)); });
loadKho();

$("btnGet").addEventListener("click", async () => {
  const text = $("linkBox").value;
  const r = await chrome.runtime.sendMessage({ type: "fetch_images", text });
  if (!r || !r.ok) { $("imgStatus").textContent = "⚠ " + ((r && r.error) || "Không bắt đầu được."); return; }
  $("imgStatus").textContent = `Tìm thấy ${r.count} mã sản phẩm. Đang bắt đầu…`;
});
$("btnResume").addEventListener("click", () => chrome.runtime.sendMessage({ type: "resume_images" }));
$("btnStopImg").addEventListener("click", () => chrome.runtime.sendMessage({ type: "stop_images" }));
$("btnClear").addEventListener("click", async () => {
  if (!Object.keys(prodImages).length) return;
  if (!confirm("Xóa hết sản phẩm và ảnh trong danh sách này?")) return;
  prodImages = {}; await save(); render();
});
// Xóa tất cả = chuyển vào "thùng rác" (prodImagesTrash); nút 🗑️ ở Dashboard khôi phục lại.
window.__clearAll = async () => {
  const n = Object.keys(prodImages).length;
  if (!n) { alert("Danh sách ảnh đang trống."); return; }
  if (!confirm("Đưa cả " + n + " sản phẩm (kèm ảnh) vào thùng rác?")) return;
  const d = await chrome.storage.local.get("prodImagesTrash");
  const trash = Object.assign({}, d.prodImagesTrash || {}, prodImages);
  await chrome.storage.local.set({ prodImagesTrash: trash });
  prodImages = {}; await save(); render();
};
window.__openTrash = async () => {
  const d = await chrome.storage.local.get("prodImagesTrash");
  const trash = d.prodImagesTrash || {};
  const n = Object.keys(trash).length;
  if (!n) { alert("Thùng rác trống."); return; }
  if (!confirm("Thùng rác đang có " + n + " sản phẩm. Khôi phục tất cả về danh sách ảnh?")) return;
  prodImages = Object.assign({}, trash, prodImages);
  await chrome.storage.local.set({ prodImagesTrash: {} });
  await save(); render();
};
$("btnBackDash").addEventListener("click", () => { window.location.href = chrome.runtime.getURL("dashboard.html"); });

async function toDataUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("HTTP " + res.status);
  const blob = await res.blob();
  const dataUrl = await new Promise((ok, bad) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = bad; fr.readAsDataURL(blob); });
  return { dataUrl, mimeType: blob.type || "image/webp" };
}

// Thu nhỏ ảnh về tối đa maxSide px, lưu JPEG (đoạn mã ngắn hơn nhiều so với ảnh gốc).
async function shrinkToDataUrl(url, maxSide) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("HTTP " + res.status);
  const bmp = await createImageBitmap(await res.blob());
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(bmp.width * k));
  cv.height = Math.max(1, Math.round(bmp.height * k));
  cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
  return { dataUrl: cv.toDataURL("image/jpeg", 0.85), mimeType: "image/jpeg" };
}

async function buildPayload(maxSide) {
  const products = [];
  let done = 0, failed = 0;
  const total = countOpen().n;
  for (const pr of Object.values(prodImages)) {
    const base = (pr.title || pr.id).replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40) || pr.id;
    let n = 0;
    for (const im of pr.images || []) {
      if (im.locked) continue;
      n += 1;
      try {
        const d = maxSide ? await shrinkToDataUrl(im.u, maxSide) : await toDataUrl(im.u);
        const ext = (d.mimeType.split("/")[1] || "webp").replace("jpeg", "jpg");
        products.push({ name: `${base}-${n}.${ext}`, mimeType: d.mimeType, dataUrl: d.dataUrl, kind: pr.kind || "top" });
      } catch (e) { failed += 1; }
      done += 1;
      $("imgStatus").textContent = `Đang tải ảnh để đóng gói ${done}/${total}…`;
    }
  }
  return { products, failed, json: JSON.stringify({ app: "AI Fashion Studio", version: 1, mode: "addProducts", exportedAt: new Date().toISOString(), outfit: { models: [], products }, scene: { model: null, scenes: [] } }) };
}

$("btnCopy").addEventListener("click", async () => {
  if (!countOpen().n) { $("imgStatus").textContent = "⚠ Không có ảnh nào đang mở khóa để sao chép."; return; }
  $("btnCopy").disabled = true;
  $("copyFallback").style.display = "none";
  try {
    const r = await buildPayload(parseInt($("sizeSel").value, 10) || 640);
    const kb = Math.round(r.json.length / 1024);
    try {
      await navigator.clipboard.writeText(r.json);
      $("imgStatus").textContent = `✅ Đã sao chép mã (${r.products.length} ảnh, ${kb.toLocaleString("vi-VN")} KB)${r.failed ? `, ${r.failed} ảnh tải lỗi nên bị bỏ` : ""}. Vào app Phối Đồ bấm "📋 Dán mã" rồi Ctrl+V.`;
    } catch (e) {
      $("copyBox").value = r.json;
      $("copyFallback").style.display = "";
      $("copyBox").focus(); $("copyBox").select();
      $("imgStatus").textContent = `Mã đã sẵn sàng (${r.products.length} ảnh, ${kb.toLocaleString("vi-VN")} KB) nhưng Chrome không cho tự sao chép: nhấn Ctrl+C ở ô bên dưới.`;
    }
  } catch (e) {
    $("imgStatus").textContent = "⚠ Lỗi khi đóng gói: " + e.message;
  }
  $("btnCopy").disabled = false;
});

$("btnExport").addEventListener("click", async () => {
  const c = countOpen();
  if (!c.n) { $("imgStatus").textContent = "⚠ Không có ảnh nào đang mở khóa để xuất."; return; }
  $("btnExport").disabled = true;
  const products = [];
  let done = 0, failed = 0;
  for (const pr of Object.values(prodImages)) {
    const base = (pr.title || pr.id).replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40) || pr.id;
    let n = 0;
    for (const im of pr.images || []) {
      if (im.locked) continue;
      n += 1;
      try {
        const d = await toDataUrl(im.u);
        const ext = (d.mimeType.split("/")[1] || "webp").replace("jpeg", "jpg");
        products.push({ name: `${base}-${n}.${ext}`, mimeType: d.mimeType, dataUrl: d.dataUrl, kind: pr.kind || "top" });
      } catch (e) { failed += 1; }
      done += 1;
      $("imgStatus").textContent = `Đang tải ảnh để đóng gói ${done}/${c.n}…`;
    }
  }
  const data = { app: "AI Fashion Studio", version: 1, mode: "addProducts", exportedAt: new Date().toISOString(), outfit: { models: [], products }, scene: { model: null, scenes: [] } };
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const d = new Date();
  const p2 = (x) => String(x).padStart(2, "0");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `san-pham-phoi-do-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  $("btnExport").disabled = false;
  $("imgStatus").textContent = `Đã xuất ${products.length} ảnh${failed ? ` (${failed} ảnh tải lỗi nên bị bỏ)` : ""}. Vào app Phối Đồ bấm ⬆ Nhập rồi chọn file này.`;
});

chrome.runtime.onMessage.addListener((msg) => { if (msg.type === "img_progress") { showState(msg.state); load(false); } });
chrome.storage.onChanged.addListener((ch) => { if (ch.prodImages && !window.__saving) load(false); });

async function load(first) {
  const d = await chrome.storage.local.get(["prodImages", "imgJobState", "themePreference"]);
  prodImages = d.prodImages || {};
  document.documentElement.setAttribute("data-theme", d.themePreference === "light" ? "light" : "dark");
  if (first) showState(d.imgJobState);
  render();
}
if (new URLSearchParams(location.search).get("embed") === "1") document.body.classList.add("embed");
load(true);
