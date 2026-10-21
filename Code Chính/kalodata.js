// ============================================================================
// kalodata.js - ĐỌC TRANG CHI TIẾT NHÀ SÁNG TẠO TRÊN KALODATA (thêm 2026-10-18, sửa lần 2)
// Chạy trên kalodata.com/creator/detail?... trong Chrome có tài khoản Kalodata của sếp.
//
// THỨ TỰ (đúng như sếp chỉ):
//   với từng khoảng ngày: Hôm qua -> 7 ngày trước -> 30 ngày trước
//     1) bảng "Video & Quảng cáo": đọc trang 1, bấm sang trang 2, 3, ... tới trang cuối
//     2) bảng "Sản phẩm": đọc trang 1, bấm sang trang 2, 3, ... tới trang cuối
//   (KHÔNG đọc bảng Cửa hàng nữa.)
//
// - CHỈ đọc trang sếp đang mở. KHÔNG mở link Kalodata nào khác => không tốn thêm lượt xem trang.
// - CHỈ đọc cái hiện trên màn hình. Cột nào Kalodata che bằng **** thì ghi **** y như vậy.
// Lưu: chrome.storage.local.kaloData[@kênh]. Xuất Excel ở trang kenhsp.html (mục Kalodata).
// ============================================================================
(function () {
  if (window.__qvKaloInit) return;
  window.__qvKaloInit = true;

  const RANGES = ["Hôm qua", "7 ngày trước", "30 ngày trước"];
  const MAX_PAGES = 400;
  const BUILD = "18Y";  // đổi mỗi lần sửa để biết trang đang chạy bản nào (hiện ở tiêu đề khung nhỏ và ở sheet Tổng quan)
  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rnd = (a, b) => sleep((a + Math.random() * (b - a)) * 1000);
  let stopFlag = false, running = false, uiRef = null, customRun = null;
  let maxPagesCur = MAX_PAGES;
  let uiAuto = false;   // true khi chạy theo lệnh từ bảng điều khiển

  // ---- tìm bảng ----------------------------------------------------------------------------------
  const wraps = () => Array.from(document.querySelectorAll(".ant-table-wrapper"));
  const heads = (w) => Array.from(w.querySelectorAll("thead th")).map((t) => norm(t.textContent));
  function findTable(kind) {
    return wraps().find((w) => {
      const h = heads(w);
      if (kind === "product") return h.includes("Thông tin sản phẩm");
      if (kind === "video") return h.includes("Video") && (h.includes("Ad ROAS") || h.includes("Lượt xem") || h.includes("Ngày đăng tải"));
      return false;
    }) || null;
  }
  const tableHeaders = () => wraps().map((w) => heads(w).filter(Boolean).slice(0, 4).join("/")).join(" | ");

  // mã định danh do kalodata_main.js ghi vào thuộc tính data-qv-ids của từng dòng (chỉ có mã, không có số liệu khác)
  function readRows(kind) {
    try { document.dispatchEvent(new Event("qv-tag")); } catch (e) { /* bỏ qua */ }
    const w = findTable(kind);
    if (!w) return [];
    return Array.from(w.querySelectorAll("tbody tr.ant-table-row")).map((tr) => {
      const cells = Array.from(tr.querySelectorAll("td")).map((td) => norm(td.innerText));
      let ids = {};
      try { ids = JSON.parse(tr.getAttribute("data-qv-ids") || "{}"); } catch (e) { ids = {}; }
      return { cells, ids };
    });
  }
  const tableSig = (kind) => readRows(kind).slice(0, 3).map((r) => r.cells.join("~")).join("|");
  const rowKey = (r) => (r.ids && r.ids.id) || r.cells.slice(1).join("~");

  // thanh số trang: .ant-pagination đầu tiên nằm SAU bảng này trong trang
  function paginationOf(w) {
    const pags = Array.from(document.querySelectorAll(".ant-pagination"));
    return pags.find((p) => w.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING) || null;
  }
  function pageInfo(w) {
    const pag = w && paginationOf(w);
    if (!pag) return { pag: null, total: 0, next: null };
    const nums = Array.from(pag.querySelectorAll("li.ant-pagination-item")).map((l) => parseInt(l.textContent, 10)).filter((n) => !isNaN(n));
    const nextLi = pag.querySelector("li.ant-pagination-next");
    const disabled = !nextLi || nextLi.classList.contains("ant-pagination-disabled") || nextLi.getAttribute("aria-disabled") === "true";
    return { pag, total: nums.length ? Math.max.apply(null, nums) : 0, next: disabled ? null : nextLi };
  }

  // ---- thao tác trang ----------------------------------------------------------------------------
  const chipEl = (lab) => Array.from(document.querySelectorAll("span.ant-radio-button-label")).find((e) => norm(e.textContent) === lab);
  const quotaLeft = () => { const m = norm(document.body.innerText).match(/còn lại (\d+) trong ngày hôm nay/); return m ? Number(m[1]) : null; };
  const dateText = () => Array.from(document.querySelectorAll(".ant-picker-input input")).map((i) => i.value).filter(Boolean).join(" → ");
  // Kalodata sang ngày mới khá muộn (thường quá trưa). Nếu ngày "đến" trong ô lịch cũ hơn HÔM QUA của máy thì số liệu chưa mới: các kênh sau cũng vậy nên dừng cả đợt, khỏi tốn lượt xem.
  const dmyParse = (s) => { const m = String(s || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/); return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null; };
  function staleInfo() {
    const to = dmyParse(dateText()); if (!to) return null;
    const y = new Date(); y.setHours(0, 0, 0, 0); y.setDate(y.getDate() - 1);
    if (to.getTime() >= y.getTime()) return null;
    const f = (d) => String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0");
    return { shown: f(to), need: f(y) };
  }
  const activeChip = () => { const e = document.querySelector(".ant-radio-button-wrapper-checked"); return e ? norm(e.textContent) : ""; };

  async function waitSigChange(kind, before, maxMs) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      await sleep(500);
      if (tableSig(kind) !== before) return true;
    }
    return false;
  }

  // đợi bảng hiện dòng (trang tải chậm / hiện khi cuộn tới) rồi cuộn bảng vào giữa màn hình
  async function bringIntoView(kind) {
    for (let k = 0; k < 60; k++) {
      const w = findTable(kind);
      if (w) {
        try { w.scrollIntoView({ block: "center" }); } catch (e) { w.scrollIntoView(); }
        const rows = readRows(kind);
        if (rows.length && rows[0].cells.some((c) => c && c.length > 1)) { await rnd(0.8, 1.5); return true; }
      }
      await sleep(600);
    }
    return false;
  }

  // ---- đọc từ trang 1 tới trang cuối của 1 bảng ------------------------------------------------------
  const rankOf = (r) => { const n = parseInt(r.cells[0], 10); return isNaN(n) ? null : n; };
  const numOf = (t) => { const n = parseInt(String(t).replace(/[.,]/g, ""), 10); return isNaN(n) ? 0 : n; };
  // tổng số dòng theo tiêu đề mục trên trang: "Sản phẩm (181 sản phẩm)", "Video & Quảng cáo (339 video)"
  function expectedTotal(kind) {
    const t = norm(document.body.innerText);
    const m = kind === "product" ? (t.match(/Sản phẩm\s*\(\s*(\d[\d.,]*)\s*sản phẩm\s*\)/i) || t.match(/Sản phẩm\s*\(\s*(\d[\d.,]*)\s*\)/i)) : t.match(/Video & Quảng cáo\s*\(\s*(\d[\d.,]*)/i);
    return m ? numOf(m[1]) : 0;
  }
  const revCell = (kind) => (kind === "video" ? 3 : 2);
  const isZeroMoney = (t) => /^\s*₫?\s*0([.,]0+)?\s*(k|tr|ti|tỉ|tỷ)?\s*$/i.test(String(t || ""));
  const poll = async (fn, maxMs, stepMs) => { const t0 = Date.now(); while (Date.now() - t0 < maxMs) { const v = fn(); if (v) return v; await sleep(stepMs || 400); } return fn(); };

  // đổi khoảng ngày xong Kalodata GIỮ NGUYÊN số trang đang đứng (ví dụ trang 34) -> phải về trang 1 trước khi đọc
  async function goFirstPage(kind) {
    for (let k = 0; k < 4; k++) {
      const rows = readRows(kind);
      if (rows.length && rankOf(rows[0]) === 1) return true;
      const w = findTable(kind), info = pageInfo(w);
      const first = info.pag && info.pag.querySelector("li.ant-pagination-item-1");
      if (!first) return rows.length > 0;
      const before = tableSig(kind);
      (first.querySelector("a,button") || first).click();
      await waitSigChange(kind, before, 9000);
      await rnd(0.8, 1.4);
    }
    const r = readRows(kind);
    return r.length > 0 && rankOf(r[0]) === 1;
  }

  // nhảy thẳng tới trang N bằng ô "Đến [ ] Trang" của thanh số trang (dùng khi quét tiếp từ chỗ đã dừng)
  async function jumpToPage(kind, n, size) {
    const info = pageInfo(findTable(kind));
    const inp = info.pag && info.pag.querySelector(".ant-pagination-options-quick-jumper input");
    if (!inp) return false;
    const want = (n - 1) * size + 1;
    const here = () => { const r = readRows(kind); return r.length ? rankOf(r[0]) : null; };
    const before = tableSig(kind);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(inp, String(n));
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    inp.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
    let ok = await poll(() => (here() === want ? true : null), 5000, 400);
    if (!ok) { inp.dispatchEvent(new Event("blur", { bubbles: true })); inp.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); ok = await poll(() => (here() === want ? true : null), 5000, 400); }
    if (ok) await rnd(0.8, 1.4);
    return !!ok;
  }

  // seed = các dòng đã đọc ở lần trước (nếu có) -> quét tiếp từ trang kế; onPartial báo định kỳ để lưu dở dang
  // Menu mục bên trái của trang (Cửa hàng / Video & Quảng cáo / Sản phẩm / Live / Người theo dõi).
  // Trang mới tải chỉ hiện trang 1 và báo "1 trang"; bấm mục này thì số trang thật + tổng số mới hiện.
  async function activateSection(kind) {
    const label = kind === "video" ? "Video & Quảng cáo" : "Sản phẩm";
    const inSidebar = (e) => { let a = e; for (let i = 0; i < 6 && a; i++, a = a.parentElement) { const t = norm(a.textContent || ""); if (/Người theo dõi/.test(t) && /Cửa hàng/.test(t) && !/Khám phá/.test(t)) return true; } return false; };
    const findSide = () => Array.from(document.querySelectorAll("div,span,a,li,button")).filter((e) => norm(e.textContent) === label && !e.querySelector("div,span,a,li,button")).find(inSidebar);   // đúng menu bên trái, KHÔNG phải thanh menu trên cùng (bấm cái đó sẽ chuyển sang trang khác)
    // tab mới mở: menu bên trái và con số tổng ("Sản phẩm (181 sản phẩm)") hiện chậm -> đợi menu, bấm, rồi kiểm tra đã hiện tổng số chưa; chưa thì bấm lại (tối đa 3 lần)
    for (let attempt = 0; attempt < 2; attempt++) {
      const side = await poll(() => findSide() || null, 9000, 500);
      if (side) {
        const target = side.closest("a,button,li,[role=menuitem]") || side.parentElement || side;
        target.click();
        await rnd(1.5, 2.5);
      }
      if (await poll(() => (expectedTotal(kind) > 0 ? true : null), 5000, 400)) return true;
      await sleep(800);
    }
    return false;
  }

  async function readAllPages(kind, label, note, seed, onPartial) {
    const out = { rows: [], pages: 0, totalPages: 0, expected: 0, missing: 0, complete: false, resumedFrom: 0, note: "" };
    await activateSection(kind);
    if (!(await bringIntoView(kind))) { out.note = "không thấy bảng " + label + " (các bảng thấy: " + tableHeaders().slice(0, 160) + ")"; out.rows = (seed || []).slice(); return out; }
    await poll(() => expectedTotal(kind) > 0, 10000, 500);      // tiêu đề có số tổng xuất hiện sau khi mục được kích hoạt
    out.expected = expectedTotal(kind);
    if (!(await goFirstPage(kind))) out.note = "không về được trang 1 của " + label;
    // thanh số trang cần vài giây để hiện đủ số trang sau khi bảng tải (nếu tiêu đề báo nhiều hơn 10 dòng mà thanh chỉ có 1 trang thì đợi thêm)
    if (out.expected > 10 || (kind === "product" && readRows(kind).length >= 10)) await poll(() => pageInfo(findTable(kind)).total > 1 || !!pageInfo(findTable(kind)).next, 5000, 400);
    // Kalodata đôi khi hiện bảng Sản phẩm chỉ "1 trang" (lỗi của trang). Đã thử trực tiếp: đổi ngày qua lại, đổi cách sắp xếp, bấm lại số trang 1, chuyển mục
    // đều KHÔNG chữa được; chỉ tải lại trang mới chữa được. Nên ở đây chỉ đánh dấu, rồi bên ngoài (hàm run) tải lại trang theo đúng ngày.
    if (kind === "product" && readRows(kind).length >= 10) {
      let i = pageInfo(findTable(kind));
      if (!i.next && !(i.total > 1) && uiAuto) {   // sếp tự vuốt xuống là bảng hiện đủ trang: làm y như vậy trước khi kết luận là kẹt
        await note(label + ": bảng chỉ báo 1 trang, đang vuốt xem lại như người thật…");
        await humanScroll(1); try { findTable(kind).scrollIntoView({ block: "center" }); } catch (e) { /* bỏ qua */ }
        await poll(() => { const x = pageInfo(findTable(kind)); return x.next || x.total > 1 ? true : null; }, 6000, 500);
        i = pageInfo(findTable(kind));
      }
      if (!i.next && !(i.total > 1)) { out.stuckPages = true; out.note = "bảng Sản phẩm chỉ báo 1 trang (lỗi của trang Kalodata)"; }
      out.expected = expectedTotal(kind) || out.expected;
    }
    const byRank = new Map();
    (seed || []).forEach((r) => { const k = rankOf(r); if (k != null) byRank.set(k, r); });
    const size = Math.max(1, readRows(kind).length || 10);
    let startPage = 1;
    if (byRank.size && (!out.expected || byRank.size < out.expected)) {
      // chỉ tính các hạng liền nhau từ 1 để biết đã xong tới trang nào
      let contiguous = 0; while (byRank.has(contiguous + 1)) contiguous++;
      const resumePage = Math.floor(contiguous / size) + 1;
      if (resumePage > 1) {
        await note(label + ": quét tiếp từ trang " + resumePage + " (lần trước đã có " + contiguous + " dòng)…");
        if (await jumpToPage(kind, resumePage, size)) { startPage = resumePage; out.resumedFrom = resumePage; }
        else { out.note = "không nhảy được tới trang " + resumePage + ", đọc lại từ trang 1 (dòng đã có vẫn được giữ)"; await goFirstPage(kind); }
      }
    }
    let noNew = 0;
    for (let page = startPage; page <= maxPagesCur; page++) {
      if (stopFlag) { out.note = "đã dừng"; break; }
      const lo = (page - 1) * size + 1, hi = out.expected ? Math.min(page * size, out.expected) : page * size;
      // đọc trang này, chờ tới khi đủ các hạng lo..hi (bảng vừa đổi trang có thể mới vẽ một phần)
      let rows = [];
      for (let t = 0; t < 8; t++) {
        rows = readRows(kind);
        const got = new Set(rows.map(rankOf));
        let full = rows.length > 0;
        if (out.expected) for (let n = lo; n <= hi; n++) if (!got.has(n)) { full = false; break; }
        if (full) break;
        await sleep(700);
      }
      let added = 0;
      rows.forEach((r) => { const k = rankOf(r); if (k != null && !byRank.has(k)) { byRank.set(k, r); added++; } });
      out.pages = page;
      if (rows.length && rows.every((r) => isZeroMoney(r.cells[revCell(kind)]))) {
        let firstZero = null; Array.from(byRank.keys()).sort((x, y) => x - y).forEach((k) => { if (firstZero == null && isZeroMoney(byRank.get(k).cells[revCell(kind)])) firstZero = k; });
        out.zeroStop = true; out.complete = true;
        out.note = "dừng ở trang " + page + ": từ hạng " + (firstZero || lo) + " doanh thu = 0 đồng (các dòng sau không còn ra đơn)";
        await note(label + ": từ hạng " + (firstZero || lo) + " doanh thu 0 đồng - dừng", { page, total: out.totalPages || page, got: byRank.size, expected: byRank.size });
        break;
      }
      const w = findTable(kind);
      let info = pageInfo(w);
      out.totalPages = Math.max(out.totalPages, info.total || 0, out.expected ? Math.ceil(out.expected / size) : 0, page);
      await note(label + ": trang " + page + "/" + (out.totalPages || "?") + " · đã đọc " + byRank.size + (out.expected ? "/" + out.expected : "") + " dòng",
        { page, total: out.totalPages, got: byRank.size, expected: out.expected });
      if (onPartial && page % 5 === 0) await onPartial(Array.from(byRank.keys()).sort((x, y) => x - y).map((k) => byRank.get(k)));
      if (out.expected && byRank.size >= out.expected) { out.complete = true; break; }
      if (!info.next) {                                   // nút "trang kế" tắt: đợi một chút phòng khi thanh số trang đang vẽ lại
        const fullPage = rows.length >= size;   // đủ 10 dòng mà chưa thấy nút sang trang = thanh số trang chưa vẽ xong (hay gặp ở bảng Sản phẩm của tab mới mở) -> đợi lâu hơn
        const waitMs = (out.expected && byRank.size < out.expected) || fullPage ? 6000 : 800;
        try { if (fullPage && info.pag) info.pag.scrollIntoView({ block: "center" }); else if (fullPage && w) w.scrollIntoView({ block: "end" }); } catch (e) { /* bỏ qua */ }
        info = await poll(() => { const i = pageInfo(findTable(kind)); return i.next ? i : null; }, waitMs, 500) || info;
        if (!info.next) {
          if (fullPage && (!out.expected || byRank.size < out.expected)) { out.note = "đủ " + rows.length + " dòng nhưng không thấy nút sang trang sau (chờ " + Math.round(waitMs / 1000) + " giây) - chỉ đọc được tới trang " + page; out.complete = false; break; }
          if (page === 1 && !info.pag) out.note = "không thấy thanh số trang (chỉ đọc 1 trang)";
          out.complete = true; break;
        }
      }
      noNew = added === 0 ? noNew + 1 : 0;
      if (noNew >= 3) { out.note = "3 trang liên tiếp không có dòng mới - dừng ở trang " + page; break; }
      const beforeFirst = rankOf(readRows(kind)[0] || { cells: [""] });
      try { w.scrollIntoView({ block: "center" }); } catch (e) { /* bỏ qua */ }
      (info.next.querySelector("button") || info.next).click();
      const moved = await poll(() => { const r = readRows(kind); return r.length && rankOf(r[0]) !== beforeFirst ? true : null; }, 12000, 400);
      if (!moved) { out.note = "bấm sang trang " + (page + 1) + " nhưng bảng không đổi (có thể Kalodata khóa các trang sau) - dừng ở trang " + page; break; }
      await rnd(0.7, 1.5);
    }
    out.rows = Array.from(byRank.keys()).sort((x, y) => x - y).map((k) => byRank.get(k));
    out.rows = out.rows.filter((r) => !isZeroMoney(r.cells[revCell(kind)]));   // bỏ các dòng 0 đồng, chỉ giữ dòng có doanh thu
    if (out.zeroStop) { out.missing = 0; return out; }
    if (out.expected) { out.missing = Math.max(0, out.expected - out.rows.length); if (out.missing && !out.note) out.note = "thiếu " + out.missing + "/" + out.expected + " dòng"; out.complete = out.missing === 0; }
    return out;
  }

  // ---- chạy 3 khoảng ngày --------------------------------------------------------------------------
  function handleOf() {
    const m = document.title.match(/@[\w.]+/);
    if (m) return m[0];
    const h = Array.from(document.querySelectorAll("h1,h2,div")).map((e) => norm(e.textContent)).find((t) => /^@[\w.]+$/.test(t));
    return h || "";
  }
  async function saveResult(result) {
    const { kaloData } = await chrome.storage.local.get("kaloData");
    const d = kaloData || {};
    d[result.handle] = result;
    await chrome.storage.local.set({ kaloData: d });
  }

  // chọn khoảng ngày tự do: bấm ô ngày, bấm 2 ô trong lịch (ô có title yyyy-mm-dd), rồi kiểm tra lại ô ngày đã đúng chưa
  const dmy = (iso) => iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4);
  async function setCustomRange(c) {
    const ins = () => Array.from(document.querySelectorAll(".ant-picker-range .ant-picker-input input"));
    const cell = (iso) => {
      const pops = Array.from(document.querySelectorAll(".ant-picker-dropdown")).filter((d) => !d.classList.contains("ant-picker-dropdown-hidden"));
      for (const p of pops) {
        const el = Array.from(p.querySelectorAll("td.ant-picker-cell")).find((td) => td.classList.contains("ant-picker-cell-in-view") && !td.classList.contains("ant-picker-cell-disabled") && (td.getAttribute("title") === iso || td.getAttribute("title") === dmy(iso)));
        if (el) return el;
      }
      return null;
    };
    const pick = async (iso) => {
      for (let k = 0; k < 4; k++) {
        const el = cell(iso);
        if (el) { (el.querySelector(".ant-picker-cell-inner") || el).click(); await rnd(0.5, 0.9); return true; }
        const pops = Array.from(document.querySelectorAll(".ant-picker-dropdown")).filter((d) => !d.classList.contains("ant-picker-dropdown-hidden"));
        const prev = pops[0] && pops[0].querySelector(".ant-picker-header-prev-btn");
        if (!prev) return false;
        prev.click(); await sleep(500);
      }
      return false;
    };
    const i0 = ins()[0];
    if (!i0) return false;
    i0.click(); i0.focus();
    await rnd(0.6, 1);
    if (!(await pick(c.from))) return false;
    if (!(await pick(c.to))) return false;
    const want = (x) => x === dmy(c.from) + "|" + dmy(c.to);
    const ok = await poll(() => (want(ins().map((i) => i.value).join("|")) ? true : null), 8000, 400);
    document.body.click();
    return !!ok;
  }

  // 4 ô tổng quan đầu trang: Doanh thu / Doanh thu LIVE / Doanh thu từ video / Giỏ hàng & Doanh thu khác (chỉ ĐỌC chữ đang hiện, không bấm gì)
  async function readSummary() {
    const L = { dt: "Doanh thu", video: "Doanh thu từ video", gio: "Giỏ hàng & Doanh thu khác" };
    const money = /₫\s?[\d.,]+\s?(?:k|tr|tỉ|ti|tỷ)?/i;
    const read = () => {
      const out = {}, all = Array.from(document.querySelectorAll("div,span,p"));
      Object.keys(L).forEach((k) => {
        const el = all.find((e) => norm(e.textContent) === L[k] && !Array.from(e.children).some((c) => norm(c.textContent) === L[k]) && e.getBoundingClientRect().top + window.scrollY < 900);
        if (!el) return;
        let a = el;
        for (let i = 0; i < 5 && a; i++, a = a.parentElement) { const tx = norm(a.innerText || ""); if (tx.length > 700) break; const m = tx.match(money); if (m) { out[k] = m[0].replace(/\s+/g, ""); return; } }
      });
      return out;
    };
    let r = read();
    for (let i = 0; i < 10 && !r.dt; i++) { await sleep(600); r = read(); }
    return r;
  }

  async function run(ui) {
    if (running) return;
    if (!/\/creator\/detail/.test(location.pathname)) { ui.status("Hãy mở trang chi tiết nhà sáng tạo trên Kalodata (đường dẫn có /creator/detail) rồi bấm lại."); return; }
    const handle = handleOf();
    if (!handle) { ui.status("Chưa thấy tên kênh trên trang. Đợi trang tải xong rồi bấm lại."); return; }
    if (!findTable("product") && !findTable("video")) { ui.status("Chưa thấy các bảng dữ liệu. Cuộn xuống mục Video & Quảng cáo, Sản phẩm một lần rồi bấm lại. Các bảng thấy: " + tableHeaders().slice(0, 200)); return; }
    const q = quotaLeft();
    if (q === 0) { ui.status("Hôm nay đã hết lượt xem trang chi tiết. Dừng để không dính rắc rối."); return; }
    const pick = Array.from(document.querySelectorAll(".qv-rg")).filter((c) => c.checked).map((c) => c.value);
    if (!pick.length && !customRun) { ui.status("Chưa tick khoảng ngày nào. Tick ít nhất một ô (Hôm qua / 7 ngày / 30 ngày)."); return; }
    const mp = document.getElementById("qv-kalo-max");
    maxPagesCur = Math.max(1, Math.min(MAX_PAGES, Number(mp && mp.value) || MAX_PAGES));
    running = true; stopFlag = false;
    const startChip = activeChip();
    const startScroll = window.scrollY;
    // quét tiếp từ lần trước (trừ khi sếp tick "Đọc lại từ đầu")
    const fresh = !!(document.getElementById("qv-kalo-fresh") || {}).checked;
    const prev = fresh ? null : ((await chrome.storage.local.get("kaloData")).kaloData || {})[handle] || null;
    const result = { handle, creatorId: (new URLSearchParams(location.search)).get("id") || "", scannedAt: Date.now(), build: BUILD, quotaLeft: q, ranges: prev && prev.ranges ? JSON.parse(JSON.stringify(prev.ranges)) : {} };
    const labs = RANGES.filter((l) => pick.includes(l)).concat(customRun ? [customRun.key] : []);
    const prog = { units: labs.length * 2, done: 0, t0: Date.now() };
    const fmtEta = (sec) => (sec > 90 ? "≈ " + Math.round(sec / 60) + " phút" : "≈ " + Math.max(5, Math.round(sec / 5) * 5) + " giây");
    const report = (frac) => {
      const pct = Math.min(99, Math.floor((100 * (prog.done + Math.max(0, Math.min(1, frac || 0)))) / prog.units));
      const el = (Date.now() - prog.t0) / 1000;
      ui.progress(pct, pct >= 3 ? "còn " + fmtEta((el * (100 - pct)) / pct) + " (ước tính, các khoảng sau có thể lâu hơn)" : "đang tính thời gian…");
    };
    ui.progress(0, "bắt đầu…");
    try {
      for (const lab of labs) {
        if (stopFlag) break;
        const isC = !!customRun && lab === customRun.key;
        const chip = isC ? true : chipEl(lab);
        if (!chip) { ui.status("Không thấy nút \"" + lab + "\"."); prog.done += 2; continue; }
        const old = result.ranges[lab] || { shops: [], videos: [], products: [], diag: {} };
        const needVideo = !old.videoDone, needProduct = !old.productDone;
        if (!needVideo && !needProduct) { ui.status("Khoảng \"" + lab + "\": lần trước đã đọc xong, bỏ qua (tick \"Đọc lại từ đầu\" nếu muốn đọc lại)."); prog.done += 2; report(0); await sleep(300); continue; }
        ui.status("Khoảng \"" + lab + "\": đang bấm nút…");
        let changedRange = false;   // true nếu vừa đổi ngày trong trang
        const sigBefore = tableSig("video") + "#" + tableSig("product");
        if (isC) {
          changedRange = true;
          if (!(await setCustomRange(customRun))) { ui.status("Không chọn được khoảng ngày " + dmy(customRun.from) + " → " + dmy(customRun.to) + " trên lịch Kalodata (bỏ qua, không quét sai ngày)."); prog.done += 2; continue; }
          const t0 = Date.now();
          while (Date.now() - t0 < 10000) { await sleep(500); if (tableSig("video") + "#" + tableSig("product") !== sigBefore) break; }
        } else if (activeChip() !== lab) {
          changedRange = true;
          chip.click();
          const t0 = Date.now();
          while (Date.now() - t0 < 10000) { await sleep(500); if (tableSig("video") + "#" + tableSig("product") !== sigBefore) break; }
        }
        if (changedRange && uiAuto) await humanWarmup(ui, false); else await rnd(1.2, 2.4);
        if (!isC && uiAuto) { const sf = staleInfo(); if (sf) { const m = "Kalodata chưa sang ngày mới: đang hiện số liệu đến " + sf.shown + ", cần đến " + sf.need + ". Đã dừng cả đợt quét để khỏi tốn lượt xem. Thử lại sau khoảng 12 giờ trưa."; window.__qvStale = m; ui.status(m); return; } }   // bấm ngày xong thì vuốt xem trang như người thật rồi mới đọc (kể cả khoảng đầu tiên)
        const note = (n, info) => {
          ui.status("Khoảng \"" + lab + "\" · " + n);
          report(info ? (info.expected ? info.got / info.expected : (info.total ? info.page / info.total : 0)) : 0);
        };
        const cur = result.ranges[lab] = Object.assign({ shops: [], videos: [], products: [], diag: {} }, old, { dateText: dateText(), sum: await readSummary() });
        const partial = (key) => async (rows) => { cur[key] = rows; await saveResult(result); };
        if (needProduct) {
          const pr = await readAllPages("product", "Sản phẩm", note, cur.products, partial("products"));
          cur.products = pr.rows; cur.productDone = !!pr.complete && !stopFlag;
          Object.assign(cur.diag, { productPages: pr.pages, productTotalPages: pr.totalPages, productNote: pr.note, productExpected: pr.expected, productMissing: pr.missing, productResumedFrom: pr.resumedFrom });
          await saveResult(result);
          if (pr.stuckPages && !stopFlag && !cur.productDone) {   // thử hết cách trong trang mà bảng Sản phẩm vẫn 1 trang: tải lại trang theo đúng ngày rồi quét tiếp từ chỗ đã đọc
            const rl0 = (await chrome.storage.local.get("kaloReload")).kaloReload || {};
            const n0 = rl0.handle === handle && Date.now() - (rl0.t || 0) < 15 * 60 * 1000 ? (rl0.n || 0) : 0;
            const qNow = quotaLeft();
            if (qNow != null && qNow <= 2) { cur.diag.productNote = ((cur.diag.productNote || "") + " · Kalodata còn " + qNow + " lượt xem hôm nay nên không tải lại trang nữa (hết lượt thì Kalodata chỉ cho xem trang 1)").slice(0, 220); }
            else if (n0 < 2) {
              await chrome.storage.local.set({ kaloReload: { handle, lab, t: Date.now(), n: n0 + 1 } });
              ui.status("Khoảng \"" + lab + "\": bảng Sản phẩm chỉ báo 1 trang, đang tải lại trang theo đúng ngày (lần " + (n0 + 1) + "/2) rồi quét tiếp…");
              window.__qvReloading = true;
              await sleep(1200);
              location.href = urlForRange(lab);
              return;
            }
          }
        }
        prog.done++;
        if (stopFlag) break;
        if (needVideo) {
          const v = await readAllPages("video", "Video & Quảng cáo", note, cur.videos, partial("videos"));
          cur.videos = v.rows; cur.videoDone = !!v.complete && !stopFlag;
          Object.assign(cur.diag, { videoPages: v.pages, videoTotalPages: v.totalPages, videoNote: v.note, videoExpected: v.expected, videoMissing: v.missing, videoResumedFrom: v.resumedFrom });
          await saveResult(result);
        }
        prog.done++;
        await rnd(0.8, 1.6);
      }
      if (startChip && activeChip() !== startChip && chipEl(startChip)) chipEl(startChip).click();
      window.scrollTo(0, startScroll);
      result.scannedAt = Date.now();
      await saveResult(result);
      if (!stopFlag) ui.progress(100, "xong");
      const sum = RANGES.filter((l) => result.ranges[l]).map((l) => { const x = result.ranges[l], g = x.diag || {}; return l + ": " + x.videos.length + (g.videoExpected ? "/" + g.videoExpected : "") + " video" + (x.videoDone ? " ✔" : " (chưa xong)") + ", " + x.products.length + (g.productExpected ? "/" + g.productExpected : "") + " SP" + (x.productDone ? " ✔" : " (chưa xong)"); }).join("\n");
      const notes = RANGES.filter((l) => result.ranges[l] && result.ranges[l].diag).map((l) => { const g = result.ranges[l].diag; return [g.videoNote && (l + " video: " + g.videoNote), g.productNote && (l + " SP: " + g.productNote)].filter(Boolean).join("; "); }).filter(Boolean).join("\n");
      ui.status((stopFlag ? "Đã dừng giữa chừng - lần sau bấm lại sẽ QUÉT TIẾP từ chỗ này.\n" : "Xong " + handle + ".\n") + sum + (notes ? "\n⚠ " + notes : "") + "\nBấm \"Mở Excel\" để xuất. Lượt xem còn lại hôm nay: " + (quotaLeft() == null ? "?" : quotaLeft()));
    } catch (e) {
      ui.status("Lỗi: " + e.message + " (dữ liệu đã đọc được vẫn được lưu, bấm lại sẽ quét tiếp)");
    } finally { running = false; ui.done(); }
  }

  // ---- khung nhỏ trên trang -------------------------------------------------------------------------
  function mountPanel() {
    if (document.getElementById("qv-kalo-panel")) return;
    const box = document.createElement("div");
    box.id = "qv-kalo-panel";
    box.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483000;width:300px;background:#111827;color:#f3f4f6;border:1px solid #f97316;border-radius:12px;padding:10px 12px;font:12px/1.45 system-ui,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.5);";
    box.innerHTML = '<div style="font-weight:700;margin-bottom:6px;color:#fb923c">Quang Vinh Pro · Kalodata <span style="font-weight:400;color:#9ca3af">(bản '+BUILD+')</span></div>' +
      '<div id="qv-kalo-st" style="min-height:34px;max-height:180px;overflow:auto;margin-bottom:8px;white-space:pre-wrap;">Mở trang chi tiết kênh rồi bấm "Đọc 3 khoảng ngày". Với mỗi khoảng (Hôm qua, 7 ngày, 30 ngày): đọc hết các trang Video &amp; Quảng cáo, rồi hết các trang Sản phẩm. Cột bị che ghi ****.</div>' +
      '<div style="height:10px;background:#374151;border-radius:6px;overflow:hidden;margin-bottom:3px"><div id="qv-kalo-bar" style="height:100%;width:0;background:linear-gradient(90deg,#fb923c,#f97316);transition:width .4s"></div></div>' +
      '<div id="qv-kalo-pct" style="font-size:11px;margin-bottom:6px;color:#d1d5db">0%</div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:6px;font-size:11px">' +
      '<label><input type="checkbox" class="qv-rg" value="Hôm qua" checked> Hôm qua</label>' +
      '<label><input type="checkbox" class="qv-rg" value="7 ngày trước" checked> 7 ngày</label>' +
      '<label><input type="checkbox" class="qv-rg" value="30 ngày trước" checked> 30 ngày</label>' +
      '<label title="Đang TICK = đọc lại từ đầu (an toàn). Bỏ tick = thử quét TIẾP từ lần trước (chế độ thử nghiệm, chưa kiểm chứng trên trang thật)."><input type="checkbox" id="qv-kalo-fresh" checked> Đọc lại từ đầu</label>' +
      '<label>Tối đa <input id="qv-kalo-max" type="number" min="1" max="400" value="400" style="width:50px;background:#1f2937;color:#fff;border:1px solid #374151;border-radius:4px"> trang/bảng</label></div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
      '<button id="qv-kalo-go" style="background:#f97316;color:#fff;border:0;border-radius:8px;padding:6px 10px;font-weight:700;cursor:pointer">Đọc 3 khoảng ngày</button>' +
      '<button id="qv-kalo-stop" disabled style="background:#7f1d1d;color:#fff;border:0;border-radius:8px;padding:6px 10px;cursor:pointer;opacity:.5">Dừng</button>' +
      '<button id="qv-kalo-open" style="background:#374151;color:#fff;border:0;border-radius:8px;padding:6px 10px;cursor:pointer">Mở Excel</button>' +
      '<button id="qv-kalo-hide" title="Thu nhỏ" style="background:transparent;color:#9ca3af;border:0;cursor:pointer;margin-left:auto">–</button></div>';
    document.body.appendChild(box);
    const st = box.querySelector("#qv-kalo-st"), go = box.querySelector("#qv-kalo-go"), stop = box.querySelector("#qv-kalo-stop");
    const ui = {
      status: (t) => { st.textContent = t; },
      progress: (pct, text) => { box.querySelector("#qv-kalo-bar").style.width = pct + "%"; box.querySelector("#qv-kalo-pct").textContent = pct + "%" + (text ? " · " + text : ""); },
      done: () => { go.disabled = false; go.style.opacity = "1"; stop.disabled = true; stop.style.opacity = ".5"; },
    };
    uiRef = ui;
    go.addEventListener("click", () => { go.disabled = true; go.style.opacity = ".5"; stop.disabled = false; stop.style.opacity = "1"; run(ui); });
    stop.addEventListener("click", () => { stopFlag = true; ui.status("Đang dừng…"); });
    box.querySelector("#qv-kalo-open").addEventListener("click", () => chrome.runtime.sendMessage({ type: "open_kenhsp" }));
    let small = false;
    box.querySelector("#qv-kalo-hide").addEventListener("click", () => { small = !small; st.style.display = small ? "none" : ""; box.style.width = small ? "120px" : "300px"; box.querySelector("#qv-kalo-hide").textContent = small ? "+" : "–"; });
  }

  // ---- chạy tự động theo lệnh từ bảng điều khiển (tab Kalo) ----
  const send = (m) => new Promise((res) => { try { chrome.runtime.sendMessage(m, (r) => res(chrome.runtime.lastError ? null : r)); } catch (e) { res(null); } });
  const slimRows = (x) => ({
    sum: x.sum || null, dtx: x.dateText || "",
    videos: (x.videos || []).map((r) => ({ k: Number(r.cells[0]) || 0, c: r.cells[1] || "", rv: r.cells[3] || "", vw: r.cells[4] || "", dt: r.cells[9] || "", id: (r.ids && r.ids.id) || "", p: (r.ids && r.ids.product_ids) || "" })),
    products: (x.products || []).map((r) => ({ k: Number(r.cells[0]) || 0, t: r.cells[1] || "", rv: r.cells[2] || "", sd: r.cells[3] || "", id: (r.ids && r.ids.id) || "" })),
  });
  // ảnh đại diện kênh: ảnh vuông/tròn đầu tiên ở phần đầu trang (cách đoán, có thể trống nếu Kalodata đổi giao diện)
  function avatarOf(handle) {
    const nick = String(handle || "").replace("@", "").toLowerCase();
    const cands = Array.from(document.querySelectorAll("img")).map((i) => {
      const r = i.getBoundingClientRect(), src = i.currentSrc || i.src || "";
      if (!/^https?:/.test(src) || r.width < 28 || r.width > 180 || Math.abs(r.width - r.height) > 8 || !(r.top < 320 || r.top + window.scrollY < 800)) return null;
      let sc = 0;
      const cs = getComputedStyle(i), par = i.parentElement ? getComputedStyle(i.parentElement) : null;
      if (parseFloat(cs.borderRadius) >= r.width * 0.4 || (par && parseFloat(par.borderRadius) >= r.width * 0.4) || /50%/.test(cs.borderRadius)) sc += 3;
      if (i.closest("[class*=avatar],[class*=Avatar]")) sc += 3;
      if (/avatar|tiktokcdn|aweme|p16-|p19-|p77-/i.test(src)) sc += 2;
      if (nick && (String(i.alt || "").toLowerCase().indexOf(nick) >= 0 || (i.parentElement && norm(i.parentElement.parentElement && i.parentElement.parentElement.innerText || "").toLowerCase().indexOf(nick) >= 0))) sc += 2;
      return sc > 0 ? { src, sc, top: r.top } : null;
    }).filter(Boolean).sort((x, y) => y.sc - x.sc || x.top - y.top);
    return cands.length ? cands[0].src : "";
  }
  // thông tin chẩn đoán (chỉ tên lớp/đường dẫn ảnh/chữ ngắn của phần đầu trang) để chỉnh cách đọc avatar và 4 ô doanh thu
  function pageDbg() {
    try {
      const imgs = Array.from(document.querySelectorAll("img")).map((i) => { const r = i.getBoundingClientRect(); return { src: String(i.currentSrc || i.src || "").slice(0, 110), w: Math.round(r.width), h: Math.round(r.height), vtop: Math.round(r.top), top: Math.round(r.top + window.scrollY), cls: String(i.className || "").slice(0, 50), par: String((i.parentElement && i.parentElement.className) || "").slice(0, 60), alt: String(i.alt || "").slice(0, 30) }; }).filter((x) => x.w >= 24 && (x.top < 900 || x.vtop < 320)).slice(0, 14);
      const txt = Array.from(document.querySelectorAll("div,span,p")).filter((e) => !e.children.length && /doanh thu|giỏ hàng/i.test(e.textContent) && e.getBoundingClientRect().top + window.scrollY < 1100).slice(0, 10).map((e) => ({ t: norm(e.textContent).slice(0, 50), cls: String(e.className || "").slice(0, 50), up: norm((e.parentElement && e.parentElement.parentElement && e.parentElement.parentElement.innerText) || "").slice(0, 90) }));
      const pags = Array.from(document.querySelectorAll(".ant-pagination")).map((p) => ({ txt: norm(p.innerText).slice(0, 70), top: Math.round(p.getBoundingClientRect().top + window.scrollY), items: p.querySelectorAll("li.ant-pagination-item").length, next: !!p.querySelector("li.ant-pagination-next:not(.ant-pagination-disabled)") })).slice(0, 8);
      const tbls = Array.from(document.querySelectorAll(".ant-table-wrapper")).map((w) => ({ h: Array.from(w.querySelectorAll("thead th")).map((t) => norm(t.textContent)).filter(Boolean).slice(0, 3).join("/"), top: Math.round(w.getBoundingClientRect().top + window.scrollY), rows: w.querySelectorAll("tbody tr.ant-table-row").length })).slice(0, 8);
      const hd = (norm(document.body.innerText).match(/(Sản phẩm|Video & Quảng cáo)\s*\([^)]{1,30}\)/g) || []).slice(0, 6);
      return { imgs, txt, pags, tbls, hd };
    } catch (e) { return { err: String(e) }; }
  }
  // Link của chính kênh này nhưng với khoảng ngày của nút (Hôm qua / 7 ngày / 30 ngày / tự chọn): tải trang theo link này thì trang vào thẳng đúng ngày, không cần đổi ngày trong trang (đổi ngày trong trang là lúc Kalodata hay bị lỗi "1 trang")
  function urlForRange(lab) {
    return location.href;   // tải lại đúng trang đang mở; ngày do nút ngày trong trang chọn (Kalodata tính "Hôm qua" theo giờ của nó, không phải giờ máy)
    const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    const y = new Date(); y.setDate(y.getDate() - 1);
    let a, b = iso(y);
    if (customRun && lab === customRun.key) { a = customRun.from; b = customRun.to; }
    else { const back = { "Hôm qua": 0, "7 ngày trước": 6, "30 ngày trước": 29 }[lab]; const s0 = new Date(y); s0.setDate(s0.getDate() - (back == null ? 6 : back)); a = iso(s0); }
    const u = new URL(location.href);
    u.searchParams.set("dateRange", JSON.stringify([a, b]));
    return u.toString();
  }
  // Giống người thật xem trang: vuốt từ từ xuống tận cuối rồi vuốt ngược lên (có nghỉ, lệch nhẹ). Kalodata chỉ vẽ đủ số trang của các bảng sau khi trang được cuộn qua;
  // bấm thẳng vào mục Sản phẩm ngay khi trang vừa tải thì bảng hay chỉ báo "1 trang".
  async function humanScroll(passes) {
    const docH = () => Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
    const smooth = async (to) => {
      const from = window.scrollY, dist = to - from, n = Math.max(4, Math.min(14, Math.round(Math.abs(dist) / 320)));
      for (let i = 1; i <= n; i++) {
        window.scrollTo({ top: Math.max(0, from + dist * (i / n) + (Math.random() - 0.5) * 50), behavior: "smooth" });
        await rnd(0.35, 0.9);
        if (i % 4 === 0) await rnd(0.4, 1.1);
      }
      window.scrollTo({ top: Math.max(0, to), behavior: "smooth" });
      await rnd(0.5, 1);
    };
    for (let p = 0; p < passes && !stopFlag; p++) {
      const bottom = Math.max(0, Math.min(docH() - window.innerHeight, 6000));
      await smooth(bottom); await rnd(1, 2);
      await smooth(Math.floor(bottom * 0.35)); await rnd(0.6, 1.2);
      await smooth(0); await rnd(0.8, 1.5);
    }
  }
  async function humanWarmup(ui, long) {
    ui.status(long ? "Đang chờ trang tải ổn định rồi vuốt xem như người thật…" : "Đang vuốt xem trang như người thật…");
    if (long) await rnd(10, 15);
    await humanScroll(1);
  }
  async function autoRun() {
    const g = await send({ type: "kalo_job_get" });
    const job = g && g.job;
    if (!job) return;
    for (let i = 0; i < 90 && !(uiRef && handleOf() && (findTable("product") || findTable("video"))); i++) await sleep(1000);
    if (!uiRef || !handleOf()) { await send({ type: "kalo_progress", p: { status: "error", msg: "Trang Kalodata không tải được (đã đăng nhập chưa? link đúng chưa?)" } }); return; }
    const handle = handleOf();
    document.querySelectorAll(".qv-rg").forEach((c) => { c.checked = (job.ranges || []).indexOf(c.value) >= 0; });
    customRun = job.custom ? { from: job.custom.from, to: job.custom.to, key: job.custom.from + "~" + job.custom.to } : null;
    const rlz = (await chrome.storage.local.get("kaloReload")).kaloReload || {};
    const justReloaded = rlz.handle === handle && Date.now() - (rlz.t || 0) < 15 * 60 * 1000;
    document.getElementById("qv-kalo-fresh").checked = justReloaded ? false : !!job.fresh;   // vừa tải lại giữa chừng thì phải QUÉT TIẾP, không xóa dữ liệu đã đọc
    document.getElementById("qv-kalo-max").value = String(job.max || 400);
    let last = "", lastPct = 0, lastSend = 0;
    const push = (force) => { const n = Date.now(); if (!force && n - lastSend < 2500) return; lastSend = n; send({ type: "kalo_progress", p: { status: "run", msg: last.slice(0, 300), pct: lastPct } }); };
    const ui = uiRef, o = { status: ui.status, progress: ui.progress, done: ui.done };
    ui.status = (t) => { o.status(t); last = String(t); push(false); };
    ui.progress = (p, t) => { o.progress(p, t); lastPct = p; if (t) last = t; push(false); };
    uiAuto = true;
    const finished = new Promise((res) => { ui.done = () => { o.done(); res(); }; });
    const stopper = setInterval(async () => { const r = await send({ type: "kalo_stop_get" }); if (r && r.stop) stopFlag = true; }, 2000);
    // cảnh báo đứng: 45 giây không có tiến độ mới thì chụp tình trạng trang gửi về bảng điều khiển (xem ở dữ liệu quét) để biết bảng / số trang đang ở trạng thái nào
    let lastChange = Date.now(), lastSeen = "";
    const watchdog = setInterval(() => {
      const cur = last + "|" + lastPct;
      if (cur !== lastSeen) { lastSeen = cur; lastChange = Date.now(); return; }
      if (Date.now() - lastChange < 45000) return;
      lastChange = Date.now();
      try {
        const rowsOf = (k) => { try { return readRows(k).slice(0, 2).map((r) => (r.cells || []).slice(0, 4).map((c) => String(c).slice(0, 24))); } catch (e) { return String(e); } };
        send({ type: "kalo_dbg", dbg: { at: Date.now(), last: last.slice(0, 200), pct: lastPct, pags: pageDbg().pags, hd: pageDbg().hd, v: rowsOf("video"), p: rowsOf("product"), url: location.href.slice(0, 160) } });
      } catch (e) { /* bỏ qua */ }
    }, 15000);
    await humanWarmup(ui, true);   // vào link xong: chờ 10-15 giây, vuốt xuống vuốt lên như người thật, RỒI MỚI thao tác
    document.getElementById("qv-kalo-go").click();
    await finished;
    clearInterval(stopper); clearInterval(watchdog);
    if (window.__qvReloading) return;   // đang tải lại trang để quét tiếp: đừng báo xong
    if (window.__qvStale) { const m = window.__qvStale; window.__qvStale = ""; await send({ type: "kalo_progress", p: { status: "error", stale: true, msg: m } }); return; }   // Kalodata chưa sang ngày mới: không lưu gì, dừng cả đợt
    try { await chrome.storage.local.remove("kaloReload"); } catch (e) { /* bỏ qua */ }   // quét xong thật rồi: lần quét sau (kể cả đọc lại từ đầu) không bị coi là vừa tải lại
    customRun = null;
    const bad = /^Lỗi|đã hết lượt|Hãy mở|Chưa /.test(last);
    const d = ((await chrome.storage.local.get("kaloData")).kaloData || {})[handle];
    const ranges = {};
    if (d && d.ranges) Object.keys(d.ranges).forEach((k) => { ranges[k] = slimRows(d.ranges[k]); });
    await send({ type: "kalo_put", put: { handle, cid: (d && d.creatorId) || "", av: avatarOf(handle), dbg: pageDbg(), ranges } });
    await send({ type: "kalo_progress", p: { status: bad ? "error" : "done", msg: last.slice(0, 300), pct: bad ? lastPct : 100 } });
  }
  setTimeout(autoRun, 2500);
  if (document.body) mountPanel(); else document.addEventListener("DOMContentLoaded", mountPanel);
  setInterval(() => { if (document.body && !document.getElementById("qv-kalo-panel")) mountPanel(); }, 3000);
})();
