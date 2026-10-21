// ============================================================================
// shopscan.js - SOI SẢN PHẨM + CỬA HÀNG HỢP TÁC của nhiều kênh (thêm 2026-10-17)
// Nạp vào background.js bằng importScripts, dùng chung sleep / randomDelay / extractUsername.
//
// Mỗi kênh: mở datakenh.com/@kênh (tự nhảy sang TikToday) -> bấm tab "Sản phẩm" -> lật HẾT các trang,
// rồi tab "Cửa hàng đã hợp tác" -> lật HẾT các trang. Dữ liệu mỗi dòng đọc từ dữ liệu React của bảng
// (giống nút "Lấy giỏ hàng"), kèm chữ nhìn thấy trên dòng để không mất gì nếu TikToday đổi tên trường.
// Lưu: chrome.storage.local.shopScanData[kênh], tiến độ: shopScanState. Trang kenhsp.html hiện + xuất Excel.
// Các hàm *Main chạy trong "thế giới chính" của trang TikToday, phải tự chứa.
// ============================================================================

let ssStopRequested = false;
let ssRunning = false;

async function ssState(patch) {
  const { shopScanState } = await chrome.storage.local.get("shopScanState");
  const next = Object.assign({}, shopScanState || {}, patch);
  await chrome.storage.local.set({ shopScanState: next });
  chrome.runtime.sendMessage({ type: "shop_progress", state: next }).catch(() => {});
  return next;
}

async function ssRunMain(tabId, func, args) {
  const res = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func, args: args || [] });
  return res && res[0] ? res[0].result : null;
}

// ---- chạy trong trang TikToday ----------------------------------------------------------

// Tìm bảng theo tiêu đề cột ("Thông tin sản phẩm" / "Thông tin cửa hàng"), đánh dấu bảng đó và cuộn tới.
// Trang kênh bản rộng có SẴN cả bảng Sản phẩm lẫn bảng Cửa hàng đã hợp tác trên 1 trang (không phải bấm tab).
function ssFocusMain(key) {
  const norm = (x) => String(x || "").replace(/\s+/g, " ").trim();
  const want = key === "shop" ? /Thông tin cửa hàng/i : /Thông tin sản phẩm/i;
  document.querySelectorAll("[data-qv-t]").forEach((t) => t.removeAttribute("data-qv-t"));
  const tables = Array.from(document.querySelectorAll("table"));
  const t = tables.find((tb) => Array.from(tb.querySelectorAll("thead th")).some((th) => want.test(norm(th.textContent))));
  if (!t) return { found: false, tables: tables.length };
  t.setAttribute("data-qv-t", key);
  try { t.scrollIntoView({ block: "center" }); } catch (e) { /* bỏ qua */ }
  return { found: true, tables: tables.length };
}

// Bấm tab con của trang kênh (Sản phẩm / Cửa hàng đã hợp tác). Ưu tiên nút nằm cùng hàng với "Video bán hàng".
function ssClickTabMain(label, startsWith) {
  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const ok = (t) => (startsWith ? t.indexOf(label) === 0 : t === label);
  const btns = Array.from(document.querySelectorAll("button, [role='tab']"));
  const anchor = btns.find((b) => /^Video bán hàng/.test(norm(b.textContent)));
  let target = null;
  if (anchor && anchor.parentElement) {
    target = Array.from(anchor.parentElement.children).find((b) => ok(norm(b.textContent)));
  }
  if (!target) target = btns.find((b) => ok(norm(b.textContent)));
  if (!target) return { clicked: false };
  target.click();
  return { clicked: true };
}

// Tăng "10 / trang" lên mức lớn nhất có (nếu bảng có ô chọn). Không có thì bỏ qua, vẫn lật từng trang.
async function ssPageSizeMain(key) {
  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const slp = (ms) => new Promise((r) => setTimeout(r, ms));
  const tb = document.querySelector('table[data-qv-t="' + key + '"]');
  const cands = Array.from(document.querySelectorAll("[role='combobox'], .MuiSelect-select, .MuiTablePagination-select"));
  const box = cands.find((e) => /\/\s*trang|\/\s*page/i.test(norm(e.textContent)) && (!tb || (tb.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING)));
  if (!box) return { changed: false, why: "no-box" };
  box.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  box.click();
  await slp(500);
  const opts = Array.from(document.querySelectorAll("[role='option'], li.MuiMenuItem-root"));
  let best = null, bestN = 0;
  opts.forEach((o) => {
    const m = norm(o.textContent).match(/(\d+)/);
    const n = m ? parseInt(m[1], 10) : 0;
    if (n > bestN) { bestN = n; best = o; }
  });
  if (!best) { document.body.click(); return { changed: false, why: "no-options" }; }
  best.click();
  await slp(600);
  return { changed: true, size: bestN };
}

// Đọc các dòng của bảng đầu tiên. raw = các trường đơn giản của dữ liệu dòng (và 1 tầng trường con),
// text = chữ nhìn thấy trên dòng.
function ssReadMain(key) {
  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const prim = (v) => (typeof v === "string" ? v.slice(0, 300) : (typeof v === "number" || typeof v === "boolean") ? v : undefined);
  const flat = (row) => {
    const o = {};
    Object.keys(row).forEach((k) => {
      const v = row[k];
      const pv = prim(v);
      if (pv !== undefined) { o[k] = pv; return; }
      if (Array.isArray(v)) { o[k + "#"] = v.length; return; }
      if (v && typeof v === "object") {
        Object.keys(v).slice(0, 25).forEach((s) => { const sv = prim(v[s]); if (sv !== undefined) o[k + "." + s] = sv; });
      }
    });
    return o;
  };
  const table = document.querySelector('table[data-qv-t="' + key + '"]');
  if (!table) return { rows: [], head: [], noTable: true };
  const head = Array.from(table.querySelectorAll("thead th")).map((t) => norm(t.textContent));
  const rows = [];
  table.querySelectorAll("tbody tr").forEach((tr) => {
    const fk = Object.keys(tr).find((k) => k.startsWith("__reactFiber"));
    let raw = null;
    if (fk) {
      let f = tr[fk];
      for (let i = 0; i < 14 && f; i++, f = f.return) {
        const p = f.memoizedProps;
        if (p && p.row && typeof p.row === "object") { raw = flat(p.row); break; }
      }
    }
    rows.push({ raw: raw || {}, text: norm(tr.innerText || tr.textContent).slice(0, 400) });
  });
  return { rows, head };
}

// Sang trang kế của bảng đầu tiên (thanh số trang nằm ngay sau bảng).
function ssNextMain(key) {
  const table = document.querySelector('table[data-qv-t="' + key + '"]');
  if (!table) return { clicked: false, why: "no-table" };
  const roots = Array.from(document.querySelectorAll(".MuiPagination-root")).filter((r) => table.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING);
  const pag = roots[0];
  if (!pag) return { clicked: false, last: true, why: "no-pagination" };
  const btns = Array.from(pag.querySelectorAll("button.MuiPaginationItem-root"));
  const cur = btns.find((b) => b.getAttribute("aria-current") === "page");
  const curN = cur ? parseInt(cur.textContent, 10) : NaN;
  if (!curN) return { clicked: false, why: "no-current" };
  const nxt = btns.find((b) => parseInt((b.textContent || "").trim(), 10) === curN + 1);
  if (nxt && !nxt.disabled) { nxt.click(); return { clicked: true, from: curN }; }
  // nút "›" (trang kế) khi số trang bị rút gọn bằng "..."
  const arrow = btns.find((b) => /next|sau|tiếp/i.test(b.getAttribute("aria-label") || "") || b.querySelector("svg[data-testid='NavigateNextIcon']"));
  if (arrow && !arrow.disabled) { arrow.click(); return { clicked: true, from: curN, arrow: true }; }
  return { clicked: false, last: true, cur: curN };
}

function ssTitleMain() {
  return document.title || "";
}

// ---- phía background -------------------------------------------------------------------

const ssSig = (res) => (res && res.rows ? res.rows.slice(0, 3).map((r) => r.text).join("¦") + "#" + res.rows.length : "");

async function ssWaitStable(tabId, key, tries) {
  let prev = "", stable = 0, last = null;
  for (let k = 0; k < tries; k++) {
    const res = await ssRunMain(tabId, ssReadMain, [key]).catch(() => null);
    last = res;
    const sig = ssSig(res);
    if (res && res.rows && res.rows.length) {
      if (sig === prev) { stable += 1; if (stable >= 2) return res; } else { stable = 0; prev = sig; }
    }
    await sleep(700);
  }
  return last && last.rows && last.rows.length ? last : null;
}

// Lật hết các trang của bảng đang hiện. Trả {rows, head, pages, sizeNote}
async function ssScanTable(tabId, key, tabLabel, note) {
  const out = { rows: [], head: [], pages: 0, sizeNote: "", empty: false };
  let c = null;
  for (let k = 0; k < 20; k++) { // đợi trang vẽ xong bảng (tối đa ~15s)
    c = await ssRunMain(tabId, ssFocusMain, [key]).catch(() => null);
    if (c && c.found) break;
    await sleep(750);
  }
  if (!c || !c.found) { out.empty = true; out.err = "không thấy bảng " + tabLabel; return out; }
  await sleep(1200);
  let res = await ssWaitStable(tabId, key, 25);
  if (!res) { out.empty = true; return out; }
  const ps = await ssRunMain(tabId, ssPageSizeMain, [key]).catch(() => null);
  if (ps && ps.changed) { out.sizeNote = ps.size + "/trang"; await sleep(800); res = (await ssWaitStable(tabId, key, 20)) || res; }
  out.head = res.head;
  const seen = new Set();
  let prevSig = "";
  for (let page = 1; page <= 120; page++) {
    if (ssStopRequested) break;
    const sig = ssSig(res);
    if (page > 1 && sig === prevSig) break; // không sang được trang mới
    prevSig = sig;
    let added = 0;
    res.rows.forEach((r) => {
      const key = (r.raw && r.raw.id) ? String(r.raw.id) : r.text;
      if (!seen.has(key)) { seen.add(key); out.rows.push(r); added += 1; }
    });
    out.pages = page;
    await note(`${tabLabel}: trang ${page}, đã đọc ${out.rows.length} dòng`);
    const nx = await ssRunMain(tabId, ssNextMain, [key]).catch(() => null);
    if (!nx || !nx.clicked) break;
    await randomDelay(1.2, 2.4);
    let next = null;
    for (let k = 0; k < 20; k++) {
      next = await ssRunMain(tabId, ssReadMain, [key]).catch(() => null);
      if (next && next.rows && next.rows.length && ssSig(next) !== prevSig) break;
      await sleep(600);
    }
    if (!next || !next.rows || !next.rows.length || ssSig(next) === prevSig) break;
    await sleep(500);
    res = next;
    if (!added && page > 1) { /* trang trùng hoàn toàn: vòng sau sẽ thoát */ }
  }
  return out;
}

async function ssRun(channels) {
  if (ssRunning) return;
  ssRunning = true;
  ssStopRequested = false;
  const log = [];
  let tabId = null;
  try {
    await ssState({ running: true, done: false, stopped: false, total: channels.length, index: 0, current: "", note: "", log: [] });
    const tab = await chrome.tabs.create({ url: "about:blank", active: true });
    tabId = tab.id;
    for (let i = 0; i < channels.length; i++) {
      if (ssStopRequested) break;
      const u = channels[i];
      const setNote = (n) => ssState({ index: i + 1, current: u, note: n });
      await ssState({ index: i + 1, current: u, note: "đang mở kênh…" });
      try {
        await chrome.tabs.update(tabId, { url: `https://datakenh.com/@${encodeURIComponent(u)}`, active: true });
        let ok = false, loginNeeded = false, finalUrl = "";
        for (let k = 0; k < 60; k++) {
          await sleep(500);
          const cur = await chrome.tabs.get(tabId);
          const url = cur.url || "";
          if (/^https:\/\/tiktoday\.vn\/dashboard\/creators\//.test(url)) { ok = true; finalUrl = url; break; }
          if (/tiktoday\.vn/.test(url) && /login|sign|auth|dang-nhap/i.test(url)) { loginNeeded = true; break; }
        }
        if (loginNeeded) { log.push(`@${u}: ⚠ TikToday đang yêu cầu đăng nhập. Đã dừng, sếp đăng nhập TikToday rồi quét lại.`); break; }
        if (!ok) { log.push(`@${u}: ⚠ TikToday chưa có kênh này (hoặc trang không mở được).`); await ssState({ log: log.slice(-60) }); continue; }
        await randomDelay(3, 5);
        const title = await ssRunMain(tabId, ssTitleMain).catch(() => "");
        const idm = finalUrl.match(/creators\/(\d+)/);

        const prod = await ssScanTable(tabId, "sp", "Sản phẩm", setNote);
        if (ssStopRequested) { log.push(`@${u}: dừng giữa chừng (chưa lưu kênh này).`); break; }
        await randomDelay(1.5, 3);
        const shop = await ssScanTable(tabId, "shop", "Cửa hàng", setNote);

        const { shopScanData } = await chrome.storage.local.get("shopScanData");
        const data = shopScanData || {};
        data[u] = {
          user: u,
          name: String(title).split(" | ")[0].slice(0, 120),
          creatorId: idm ? idm[1] : "",
          scannedAt: Date.now(),
          products: prod.rows,
          shops: shop.rows,
          headProducts: prod.head,
          headShops: shop.head,
          pagesProducts: prod.pages,
          pagesShops: shop.pages,
        };
        await chrome.storage.local.set({ shopScanData: data });
        log.push(`@${u}: ✔ ${prod.rows.length} sản phẩm (${prod.pages} trang${prod.sizeNote ? ", " + prod.sizeNote : ""}), ${shop.rows.length} cửa hàng (${shop.pages} trang)` + (prod.empty ? " ⚠ không đọc được bảng sản phẩm" + (prod.err ? " (" + prod.err + ")" : "") : "") + (shop.empty ? " ⚠ không đọc được bảng cửa hàng" + (shop.err ? " (" + shop.err + ")" : "") : ""));
      } catch (e) {
        log.push(`@${u}: ⚠ ${e.message}`);
      }
      await ssState({ log: log.slice(-60) });
      if (i < channels.length - 1 && !ssStopRequested) await randomDelay(3, 6);
    }
  } finally {
    if (tabId != null) chrome.tabs.remove(tabId).catch(() => {});
    await ssState({ running: false, done: true, stopped: ssStopRequested, note: "", current: "", log: log.slice(-60) });
    ssRunning = false;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string" || msg.type.indexOf("shop_") !== 0) return;
  if (msg.type === "shop_scan_start") {
    if (ssRunning) { sendResponse({ ok: false, error: "Đang quét rồi." }); return; }
    const list = Array.from(new Set((msg.channels || []).map((x) => extractUsername(String(x))).filter(Boolean)));
    if (!list.length) { sendResponse({ ok: false, error: "Chưa có kênh nào." }); return; }
    ssRun(list).catch(() => {});
    sendResponse({ ok: true, count: list.length });
    return;
  }
  if (msg.type === "shop_scan_stop") { ssStopRequested = true; sendResponse({ ok: true }); return; }
  if (msg.type === "shop_scan_clear") {
    (async () => {
      if (msg.user) {
        const { shopScanData } = await chrome.storage.local.get("shopScanData");
        const d = shopScanData || {};
        delete d[msg.user];
        await chrome.storage.local.set({ shopScanData: d });
      } else {
        await chrome.storage.local.set({ shopScanData: {}, shopScanState: {} });
      }
      sendResponse({ ok: true });
    })();
    return true;
  }
});
