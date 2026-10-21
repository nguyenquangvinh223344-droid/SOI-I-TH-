// ============================================================================
// shopinfo.js - SOI CỬA HÀNG (thêm 2026-10-17)
// Nạp vào background.js bằng importScripts (dùng chung sleep / randomDelay).
//
// Mỗi cửa hàng: mở thẳng tiktoday.vn/dashboard/shops/<mã cửa hàng> rồi đọc:
//  - dữ liệu cửa hàng trong React props (lượt bán, doanh thu, số sản phẩm, đơn giá, số nhà sáng tạo, số video, sao...)
//  - chữ trên thẻ bên trái (hoa hồng, KOC 30 ngày, Video 30 ngày, dải giá, số sản phẩm mở hoa hồng)
// KHÔNG lấy thông tin liên hệ (số điện thoại, email) của cửa hàng.
// Lưu: chrome.storage.local.shopInfoData[mã], tiến độ: shopInfoState. Giao diện ở kenhsp.html (mục "Soi cửa hàng").
// ============================================================================

let siStopRequested = false;
let siRunning = false;

async function siState(patch) {
  const { shopInfoState } = await chrome.storage.local.get("shopInfoState");
  const next = Object.assign({}, shopInfoState || {}, patch, { beat: Date.now() });
  await chrome.storage.local.set({ shopInfoState: next });
  chrome.runtime.sendMessage({ type: "shopinfo_progress", state: next }).catch(() => {});
  return next;
}

// ---- chạy trong trang TikToday (phải tự chứa) ------------------------------------------
function siReadMain(expectId) {
  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const prim = (v) => (typeof v === "string" ? v.slice(0, 300) : (typeof v === "number" || typeof v === "boolean") ? v : undefined);
  let shop = null;
  const els = document.querySelectorAll("div, section, main, h1, h2");
  for (let i = 0; i < els.length && i < 900 && !shop; i++) {
    const fk = Object.keys(els[i]).find((k) => k.startsWith("__reactFiber"));
    if (!fk) continue;
    let f = els[i][fk];
    for (let d = 0; d < 16 && f; d++, f = f.return) {
      const p = f.memoizedProps;
      if (p && p.shop && typeof p.shop === "object" && String(p.shop.id) === String(expectId)) { shop = p.shop; break; }
    }
  }
  const o = {};
  Object.keys(shop || {}).forEach((k) => {
    if (k === "contact") return; // không lấy thông tin liên hệ
    const v = shop[k];
    const pv = prim(v);
    if (pv !== undefined) { o[k] = pv; return; }
    if (Array.isArray(v)) {
      if (v.length && v.length <= 40 && v.every((x) => typeof x === "number")) o[k] = v.slice();
      else o[k + "#"] = v.length;
      return;
    }
    if (v && typeof v === "object" && k !== "category_stats") {
      Object.keys(v).slice(0, 15).forEach((s) => { const sv = prim(v[s]); if (sv !== undefined) o[k + "." + s] = sv; });
    }
  });
  // thẻ bên trái: tìm nhanh bằng duyệt các nút chữ (KHÔNG gọi innerText trên hàng nghìn phần tử - việc đó làm đơ trang
  // và chính là nguyên nhân quét chậm / không đọc được ở bản trước), rồi chỉ đọc innerText của ĐÚNG 1 phần tử.
  let card = "";
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = tw.nextNode())) {
    if (node.nodeValue && node.nodeValue.indexOf("KOC 30 ngày") >= 0) {
      let e = node.parentElement;
      for (let up = 0; up < 8 && e; up++, e = e.parentElement) {
        const tc = e.textContent || "";
        if (tc.indexOf("Lượt bán") >= 0 && tc.indexOf("Video 30 ngày") >= 0) {
          card = norm(e.innerText || tc);
          break;
        }
      }
      break;
    }
  }
  const ci = card.indexOf("Liên hệ");
  if (ci > 0) card = card.slice(0, ci).trim();
  card = card.slice(0, 700);
  return { found: !!(shop || card), hasShop: !!shop, shop: o, card, title: document.title || "" };
}

// ---- phía background -------------------------------------------------------------------
async function siRun(ids, force) {
  if (siRunning) return;
  siRunning = true;
  siStopRequested = false;
  const log = [];
  let tabId = null;
  let okCount = 0;
  try {
    if (!force) {
      const have = (await chrome.storage.local.get("shopInfoData")).shopInfoData || {};
      const todo = ids.filter((x) => !have[x]);
      if (todo.length < ids.length) log.push(`Bỏ qua ${ids.length - todo.length} shop đã quét xong (bật "Quét lại cả shop đã có" nếu muốn quét lại).`);
      ids = todo;
    }
    await siState({ running: true, done: false, stopped: false, total: ids.length, index: 0, current: "", ok: 0, waitSec: 0, log: log.slice() });
    if (!ids.length) { log.push("Không còn shop nào cần quét."); return; }
    const tab = await chrome.tabs.create({ url: "about:blank", active: true });
    tabId = tab.id;
    for (let i = 0; i < ids.length; i++) {
      if (siStopRequested) break;
      const id = ids[i];
      await siState({ index: i + 1, current: id });
      try {
        await chrome.tabs.update(tabId, { url: `https://tiktoday.vn/dashboard/shops/${id}`, active: true });
        let res = null, loginNeeded = false, why = "";
        const hasNums = (r) => !!(r && r.found && r.card && /Lượt bán\s*[\d]/.test(r.card) && /KOC 30 ngày\D{0,6}\d/.test(r.card) && /Video 30 ngày\D{0,6}\d/.test(r.card));
        const tStart = Date.now();
        let lastBeat = -1;
        while (Date.now() - tStart < 30000) {
          await sleep(700);
          const sec = Math.floor((Date.now() - tStart) / 5000);
          if (sec !== lastBeat) { lastBeat = sec; await siState({ waitSec: Math.round((Date.now() - tStart) / 1000) }); }
          const cur = await chrome.tabs.get(tabId);
          const url = cur.url || "";
          if (/tiktoday\.vn/.test(url) && /login|sign|auth|dang-nhap/i.test(url)) { loginNeeded = true; break; }
          if (!/\/dashboard\/shops\//.test(url) || url.indexOf(id) < 0) { why = "trang chưa chuyển sang đúng cửa hàng (" + url.slice(0, 70) + ")"; continue; }
          const r2 = await ssRunMain(tabId, siReadMain, [id]).catch((e) => { why = "lỗi đọc trang: " + String(e && e.message || e).slice(0, 60); return null; });
          if (r2) { if (!r2.found) why = "chưa thấy dữ liệu cửa hàng " + id; else if (!r2.card) why = "có dữ liệu nhưng chưa thấy thẻ bên trái"; else why = ""; res = r2; }
          if (hasNums(res)) break;
          if (res && res.found && res.card && Date.now() - tStart > 14000) break; // có thẻ mà số chưa hiện đủ: đừng chờ lâu
        }
        if (loginNeeded) { log.push(`${id}: ⚠ TikToday đang yêu cầu đăng nhập. Đã dừng, sếp đăng nhập rồi quét lại.`); break; }
        if (!res || !res.found) { log.push(`${id}: ⚠ không đọc được (${why || "tải quá lâu"}).`); await siState({ log: log.slice(-80) }); continue; }
        if (!hasNums(res)) log.push(`${id}: ⚠ đọc được nhưng thẻ chưa hiện đủ số (hoa hồng / KOC / video 30 ngày) - đã lưu phần có.`);
        const { shopInfoData } = await chrome.storage.local.get("shopInfoData");
        const data = shopInfoData || {};
        data[id] = { id, scannedAt: Date.now(), shop: res.shop, card: res.card, title: res.title };
        await chrome.storage.local.set({ shopInfoData: data });
        okCount += 1;
        await siState({ ok: okCount });
      } catch (e) {
        log.push(`${id}: ⚠ ${e.message}`);
      }
      await siState({ log: log.slice(-80) });
      if (i < ids.length - 1 && !siStopRequested) await randomDelay(1.5, 3);
    }
  } finally {
    if (tabId != null) chrome.tabs.remove(tabId).catch(() => {});
    await siState({ running: false, done: true, stopped: siStopRequested, current: "", ok: okCount, log: log.slice(-80) });
    siRunning = false;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string" || msg.type.indexOf("shopinfo_") !== 0) return;
  if (msg.type === "shopinfo_start") {
    if (siRunning) { sendResponse({ ok: false, error: "Đang quét rồi." }); return; }
    const ids = Array.from(new Set((msg.ids || []).map((x) => String(x)).filter((x) => /^\d{15,22}$/.test(x))));
    if (!ids.length) { sendResponse({ ok: false, error: "Chưa có mã cửa hàng hợp lệ." }); return; }
    siRun(ids, !!msg.force).catch(() => {});
    sendResponse({ ok: true, count: ids.length });
    return;
  }
  if (msg.type === "shopinfo_stop") { siStopRequested = true; sendResponse({ ok: true }); return; }
  if (msg.type === "shopinfo_clear") {
    if (siRunning) { sendResponse({ ok: false, error: "Đang quét, bấm Dừng trước." }); return; }
    chrome.storage.local.set({ shopInfoData: {}, shopInfoGroups: {}, shopInfoState: {} }).then(() => sendResponse({ ok: true }));
    return true;
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "open_kenhsp") chrome.tabs.create({ url: chrome.runtime.getURL("kenhsp.html") });
});
