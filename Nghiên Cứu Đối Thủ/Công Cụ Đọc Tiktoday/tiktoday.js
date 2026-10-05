// ============================================================================
// tiktoday.js - chạy trên tiktoday.vn.
// 1) Trang DANH SÁCH sản phẩm (/dashboard/products): bấm "Ghi trang này" để chép
//    các dòng đang hiện (lượt bán, GMV, hoa hồng, số video, số nhà sáng tạo,
//    hình dáng doanh thu 7 ngày...).
// 2) Trang CHI TIẾT một sản phẩm (/dashboard/products/<mã>): đọc % doanh thu
//    từ video, % đánh giá tích cực...
// 3) Nút "Đọc chi tiết các SP trong trang": mở lần lượt từng sản phẩm ở tab nền.
// Không tự đổi bộ lọc, không tự lật trang. Bạn lọc và chuyển trang.
// ============================================================================
(function () {
  if (window.__tdLoaded) return;
  window.__tdLoaded = true;

  const LIST_KEY = "td_list";
  const DETAIL_KEY = "td_detail";
  const hasChrome = typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
  const hasRuntime = typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage;

  async function load(key) {
    if (hasChrome) { const r = await chrome.storage.local.get(key); return r[key] || {}; }
    return JSON.parse(localStorage.getItem(key) || "{}");
  }
  async function save(key, obj) {
    if (hasChrome) await chrome.storage.local.set({ [key]: obj });
    else localStorage.setItem(key, JSON.stringify(obj));
  }

  // ------------------------------------------------------------- số liệu
  // Tiktoday ghi: 1,67 tr (triệu) · 876,35 k (nghìn) · ₫40,01 ti (tỷ) · 10% · 318
  function parseVN(s) {
    if (s == null) return null;
    let t = String(s).replace(/[₫đ]/gi, "").replace(/\s+/g, " ").trim();
    if (!t || /^[-–—]+$/.test(t)) return null;
    const m = t.match(/(-?\d[\d.,]*)\s*(tỉ|tỷ|ti|tr|k|m|b)?/i);
    if (!m) return null;
    let numStr = m[1];
    const suf = (m[2] || "").toLowerCase();
    if (suf) numStr = numStr.replace(/\./g, "").replace(",", ".");
    else if (/^\d{1,3}([.,]\d{3})+$/.test(numStr)) numStr = numStr.replace(/[.,]/g, "");
    else numStr = numStr.replace(",", ".");
    const n = parseFloat(numStr);
    if (isNaN(n)) return null;
    const mult = { "tỉ": 1e9, "tỷ": 1e9, ti: 1e9, tr: 1e6, k: 1e3, m: 1e6, b: 1e9 }[suf] || 1;
    return Math.round(n * mult);
  }
  function parseRange(s) {
    if (!s) return [null, null];
    const parts = String(s).split(/\s[-–]\s/);
    return [parseVN(parts[0]), parseVN(parts[parts.length - 1])];
  }
  function parsePct(s) {
    const m = String(s || "").match(/(-?[\d.,]+)\s*%/);
    return m ? parseFloat(m[1].replace(",", ".")) : null;
  }

  // ------------------------------------------------------- đường biểu đồ
  function pathPoints(d) {
    const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
    let i = 0, cmd = null, x = 0, y = 0, guard = 0;
    const pts = [];
    const num = () => parseFloat(tokens[i++]);
    while (i < tokens.length && guard++ < 8000) {
      if (/^[a-zA-Z]$/.test(tokens[i])) cmd = tokens[i++];
      else if (cmd == null) break;
      const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
      if (C === "Z") continue;
      if (C === "M" || C === "L" || C === "T") { const a = num(), b = num(); x = rel ? x + a : a; y = rel ? y + b : b; pts.push([x, y]); if (C === "M") cmd = rel ? "l" : "L"; }
      else if (C === "H") { const a = num(); x = rel ? x + a : a; pts.push([x, y]); }
      else if (C === "V") { const b = num(); y = rel ? y + b : b; pts.push([x, y]); }
      else if (C === "C") { num(); num(); num(); num(); const a = num(), b = num(); x = rel ? x + a : a; y = rel ? y + b : b; pts.push([x, y]); }
      else if (C === "S" || C === "Q") { num(); num(); const a = num(), b = num(); x = rel ? x + a : a; y = rel ? y + b : b; pts.push([x, y]); }
      else if (C === "A") { for (let k = 0; k < 5; k++) num(); const a = num(), b = num(); x = rel ? x + a : a; y = rel ? y + b : b; pts.push([x, y]); }
      else i++;
    }
    return pts.filter((p) => isFinite(p[0]) && isFinite(p[1]));
  }
  function readSpark(cell) {
    if (!cell) return null;
    const svg = Array.from(cell.querySelectorAll("svg")).find((s) => s.getBoundingClientRect().width >= 40) || cell.querySelector("svg");
    if (!svg) return null;
    const paths = Array.from(svg.querySelectorAll("path")).map((p) => p.getAttribute("d") || "");
    const line = paths.filter((d) => pathPoints(d).length >= 3).sort((a, b) => (/z/i.test(a) ? 1 : 0) - (/z/i.test(b) ? 1 : 0))[0];
    if (!line) return null;
    const rect = svg.getBoundingClientRect();
    const vb = (svg.getAttribute("viewBox") || "").split(/[\s,]+/).map(Number);
    const h = vb.length === 4 && vb[3] > 0 ? vb[3] : rect.height || 24;
    return { h, points: pathPoints(line).map((p) => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]), path: line.slice(0, 1500) };
  }
  // điểm 0-100 (100 = cao nhất trên biểu đồ), lấy tối đa 7 điểm trải đều
  function sparkScores(sp) {
    if (!sp || !sp.points.length) return [];
    const ys = sp.points.map((p) => Math.max(0, Math.min(100, Math.round((1 - p[1] / sp.h) * 100))));
    return ys;
  }
  function trendWord(sc) {
    if (sc.length < 3) return "";
    const n = sc.length, third = Math.max(1, Math.floor(n / 3));
    const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const first = avg(sc.slice(0, third)), last = avg(sc.slice(n - third));
    const d = last - first;
    const lastStep = sc[n - 1] - avg(sc.slice(n - 3, n - 1));
    let w = d >= 12 ? "Đi lên" : d <= -12 ? "Đi xuống" : "Đi ngang";
    if (lastStep >= 15) w += " (cuối kỳ bật lên)";
    else if (lastStep <= -15) w += " (cuối kỳ sụt)";
    return w;
  }

  // ---------------------------------------------------- trang DANH SÁCH
  const HEADER_MAP = [
    [/^stt$/i, "stt"], [/thông tin sản phẩm/i, "sp"], [/cửa hàng/i, "cua_hang"], [/lượt bán/i, "luot_ban"],
    [/^gmv/i, "gmv"], [/^giá bán/i, "gia_ban"], [/đơn giá/i, "don_gia_tb"], [/hoa hồng/i, "hoa_hong"],
    [/^doanh thu/i, "doanh_thu_7n"], [/video nổi bật/i, "video_noi_bat"], [/^số video/i, "so_video"], [/số lượng nst|nhà sáng tạo/i, "so_nst"],
  ];
  const DEFAULT_COLS = ["stt", "sp", "cua_hang", "luot_ban", "gmv", "gia_ban", "don_gia_tb", "hoa_hong", "doanh_thu_7n", "video_noi_bat", "so_video", "so_nst"];

  function findListRows() {
    const trs = Array.from(document.querySelectorAll("tr")).filter((tr) => tr.querySelectorAll("td").length >= 6 && /Số sản phẩm\s*:/i.test(tr.innerText || ""));
    return trs;
  }
  function headerKeys(table, ncells) {
    const ths = table ? Array.from(table.querySelectorAll("thead th, thead td")) : [];
    const keys = ths.map((th) => { const t = (th.innerText || "").trim(); const h = HEADER_MAP.find(([re]) => re.test(t)); return h ? h[1] : "?"; });
    if (keys.length === ncells && keys.filter((k) => k !== "?").length >= 6) return keys;
    return DEFAULT_COLS.slice(0, ncells);
  }
  function idFromRow(tr) {
    const a = Array.from(tr.querySelectorAll("a[href]")).find((x) => /\/products\/(\d{10,})/.test(x.href));
    if (a) return a.href.match(/\/products\/(\d{10,})/)[1];
    const k = tr.getAttribute("data-row-key") || tr.getAttribute("data-id") || "";
    if (/^\d{10,}$/.test(k)) return k;
    return "";
  }
  function parseListRow(tr, keys) {
    const tds = Array.from(tr.querySelectorAll("td"));
    const cell = {}; keys.forEach((k, i) => { if (tds[i]) cell[k] = tds[i]; });
    const txt = (k) => (cell[k] ? (cell[k].innerText || "").trim() : "");
    const sp = cell.sp ? (cell.sp.innerText || "").trim().split("\n").filter(Boolean) : [];
    const ch = txt("cua_hang").split("\n").map((s) => s.trim()).filter(Boolean);
    const spark = readSpark(cell.doanh_thu_7n);
    const [gmin, gmax] = parseRange(txt("gia_ban"));
    const id = idFromRow(tr);
    const link = cell.sp && cell.sp.querySelector("a[href]") ? cell.sp.querySelector("a[href]").href : "";
    return {
      id_sp: id,
      ten_sp: sp.join(" ").slice(0, 300),
      cua_hang: ch[0] || "",
      so_sp_cua_hang: parseVN((ch.find((s) => /Số sản phẩm/i.test(s)) || "").replace(/.*:/, "")),
      luot_ban_raw: txt("luot_ban"), luot_ban: parseVN(txt("luot_ban")),
      gmv_raw: txt("gmv"), gmv: parseVN(txt("gmv")),
      gia_ban_raw: txt("gia_ban"), gia_min: gmin, gia_max: gmax,
      don_gia_tb: parseVN(txt("don_gia_tb")),
      hoa_hong_pct: parsePct(txt("hoa_hong")),
      so_video: parseVN(txt("so_video")),
      so_nst: parseVN(txt("so_nst")),
      doanh_thu_7n_ys: spark ? spark.points.map((p) => p[1]).join(";") : "",
      doanh_thu_7n_h: spark ? spark.h : "",
      doanh_thu_7n_path: spark ? spark.path : "",
      link_tiktoday: id ? "https://tiktoday.vn/dashboard/products/" + id : link,
      html_goc: tr.outerHTML.slice(0, 15000),
    };
  }
  async function recordList() {
    const rows = findListRows();
    if (!rows.length) return { found: 0, saved: 0, total: Object.keys(await load(LIST_KEY)).length, noid: 0 };
    const table = rows[0].closest("table");
    const nCells = rows[0].querySelectorAll("td").length;
    const keys = headerKeys(table, nCells);
    const all = await load(LIST_KEY);
    let saved = 0, noid = 0;
    for (const tr of rows) {
      const r = parseListRow(tr, keys);
      if (!r.id_sp) noid++;
      const key = r.id_sp || r.ten_sp;
      if (!key) continue;
      all[key] = Object.assign({ thoi_gian: new Date().toISOString(), url_loc: location.href }, r);
      saved++;
    }
    await save(LIST_KEY, all);
    return { found: rows.length, saved, noid, total: Object.keys(all).length };
  }

  // ----------------------------------------------------- trang CHI TIẾT
  function onDetailPage() { return /\/dashboard\/products\/\d{10,}/.test(location.pathname); }
  function detailId() { return (location.pathname.match(/\/products\/(\d{10,})/) || [])[1] || ""; }
  function readDetail() {
    const body = document.body.innerText || "";
    const sec = (() => {
      const a = body.indexOf("Chiến lược bán hàng");
      if (a < 0) return "";
      const b = body.indexOf("Sản phẩm cùng danh mục", a);
      return body.slice(a, b > a ? b : a + 800);
    })();
    const pctOf = (label) => { const m = sec.match(new RegExp(label + "[\\s\\S]{0,80}?\\(\\s*([\\d.,]+)\\s*%\\s*\\)", "i")); return m ? parseFloat(m[1].replace(",", ".")) : null; };
    const video = pctOf("Video"), sanpham = pctOf("Sản phẩm");
    const pos = (body.match(/Đánh giá tích cực\s*([\d.,]+)\s*%/i) || [])[1];
    const neg = (body.match(/Đánh giá tiêu cực\s*([\d.,]+)\s*%/i) || [])[1];
    const rating = body.match(/(\d\.\d)\s*·\s*([\d.,]+\s*[kKmM]?)\s*đánh giá/i);
    const get = (re) => { const m = body.match(re); return m ? m[1].trim() : ""; };
    // số trang -> ước lượng số nhà sáng tạo / số video (15 mỗi trang)
    const lastPage = () => {
      const nums = Array.from(document.querySelectorAll("li, button, a, span")).filter((e) => e.children.length === 0 && /^\d{1,4}$/.test((e.textContent || "").trim())).map((e) => +e.textContent.trim());
      return nums.length ? Math.max(...nums) : null;
    };
    return {
      id_sp: detailId(),
      ten_sp: (document.querySelector("h1, h2") || {}).innerText || "",
      video_pct: video, sanpham_pct: sanpham,
      dg_tich_cuc_pct: pos ? parseFloat(pos.replace(",", ".")) : null,
      dg_tieu_cuc_pct: neg ? parseFloat(neg.replace(",", ".")) : null,
      sao: rating ? rating[1] : "",
      so_danh_gia: rating ? parseVN(rating[2]) : null,
      hoa_hong_pct: parsePct(get(/Hoa hồng\s*\n?\s*([\d.,]+\s*%)/i)),
      luot_ban_raw: get(/Lượt bán\s*\n?\s*([\d.,]+\s*(?:tr|k|ti|tỉ)?)/i),
      gmv_raw: get(/GMV[^\n]*\n?\s*(₫?\s*[\d.,]+\s*(?:tr|k|ti|tỉ)?)/i),
      cap_nhat: get(/(Cập nhật [^\n]+)/i),
      so_trang_cuoi_cua_bang_hien_co: lastPage(),
      tho_chien_luoc: sec.slice(0, 400),
    };
  }
  let detailTried = 0;
  async function recordDetail(auto) {
    const d = readDetail();
    if (!d.id_sp) return { ok: false, why: "không phải trang chi tiết" };
    if (d.video_pct == null && auto && detailTried < 20) { detailTried++; return { ok: false, retry: true }; }
    const all = await load(DETAIL_KEY);
    all[d.id_sp] = Object.assign({ thoi_gian: new Date().toISOString(), url: location.href }, d);
    await save(DETAIL_KEY, all);
    return { ok: true, d, total: Object.keys(all).length };
  }

  // ------------------------------------------------------------ xuất file
  const csvCell = (v) => { if (v == null) return ""; const s = String(v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const download = (name, text, type) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  function chamDiem(r, d) {
    // Điểm sơ bộ 0-100 (ĐOÁN, cần chỉnh theo kết quả thật):
    // 25: doanh thu 7 ngày đi lên · 25: ít nhà sáng tạo (<=300 tốt) · 25: % doanh thu từ video · 25: hoa hồng (15% = đủ điểm)
    const sc = sparkScores({ points: (r.doanh_thu_7n_ys ? r.doanh_thu_7n_ys.split(";").map((y) => [0, +y]) : []), h: +r.doanh_thu_7n_h || 24 });
    const tw = trendWord(sc);
    const up = tw.startsWith("Đi lên") ? 25 : tw.startsWith("Đi ngang") ? 10 : 0;
    const nst = r.so_nst == null ? 0 : Math.round(25 * clamp(1 - r.so_nst / 300, 0, 1));
    const vp = d && d.video_pct != null ? Math.round(25 * clamp(d.video_pct / 100, 0, 1)) : null;
    const hh = r.hoa_hong_pct == null ? 0 : Math.round(25 * clamp(r.hoa_hong_pct / 15, 0, 1));
    const total = up + nst + (vp == null ? 0 : vp) + hh;
    return { diem: total, thieu_video: vp == null, tw, sc };
  }
  function buildRows(list, detail) {
    const rows = Object.values(list).map((r) => {
      const d = detail[r.id_sp] || null;
      const c = chamDiem(r, d);
      const dung = r.so_nst ? Math.round(r.luot_ban / r.so_nst) : "";
      return {
        "Điểm sơ bộ (0-100)": c.diem + (c.thieu_video ? " (chưa có % video)" : ""),
        "Tên sản phẩm": r.ten_sp, "Cửa hàng": r.cua_hang,
        "Lượt bán (tổng)": r.luot_ban, "GMV (tỷ đồng)": r.gmv == null ? "" : Math.round(r.gmv / 1e7) / 100,
        "Giá thấp (đ)": r.gia_min, "Giá cao (đ)": r.gia_max, "Hoa hồng (%)": r.hoa_hong_pct,
        "Số video": r.so_video, "Số nhà sáng tạo": r.so_nst,
        "Lượt bán / mỗi nhà sáng tạo": dung,
        "Doanh thu 7 ngày": c.tw, "Doanh thu 7 ngày (điểm 0-100, trái=cũ, phải=mới)": c.sc.join(" > "),
        "% doanh thu từ VIDEO": d ? d.video_pct : "", "% đánh giá tích cực": d ? d.dg_tich_cuc_pct : "",
        "Link Tiktoday": r.link_tiktoday, "Link TikTok": r.id_sp ? "https://www.tiktok.com/view/product/" + r.id_sp : "",
        "Mã sản phẩm": r.id_sp ? "'" + r.id_sp : "", "Thời gian ghi": (r.thoi_gian || "").replace("T", " ").slice(0, 16),
        _s: c.diem,
      };
    });
    rows.sort((a, b) => b._s - a._s);
    rows.forEach((r) => delete r._s);
    return rows;
  }
  async function exportCsv() {
    const rows = buildRows(await load(LIST_KEY), await load(DETAIL_KEY));
    if (!rows.length) { show("Chưa có gì để xuất."); return; }
    const cols = Object.keys(rows[0]);
    download("tiktoday-san-pham.csv", "﻿" + [cols.map(csvCell).join(",")].concat(rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))).join("\n"), "text/csv;charset=utf-8");
  }
  async function exportJson() {
    download("tiktoday-san-pham.json", JSON.stringify({ danh_sach: Object.values(await load(LIST_KEY)), chi_tiet: Object.values(await load(DETAIL_KEY)) }, null, 2), "application/json");
  }
  async function diagnose() {
    const rows = findListRows();
    const tbl = rows[0] ? rows[0].closest("table") : document.querySelector("table");
    const payload = {
      url: location.href, so_dong_tim_thay: rows.length,
      tieu_de_bang: tbl ? Array.from(tbl.querySelectorAll("thead th, thead td")).map((x) => (x.innerText || "").trim()) : [],
      dong_mau: rows.slice(0, 2).map((tr) => ({ van_ban: (tr.innerText || "").split("\n").filter(Boolean), html: tr.outerHTML.slice(0, 8000) })),
      chi_tiet_mau: onDetailPage() ? readDetail() : null,
      so_bang: document.querySelectorAll("table").length,
      body_mau: (document.body.innerText || "").slice(0, 1500),
    };
    download("tiktoday-chan-doan.json", JSON.stringify(payload, null, 2), "application/json");
  }

  // ------------------------------------------------------------------ UI
  let statusEl = null, panel = null;
  const show = (t) => { if (statusEl) statusEl.textContent = t; };
  async function summary() {
    const l = Object.keys(await load(LIST_KEY)).length, d = Object.keys(await load(DETAIL_KEY)).length;
    return `Đã lưu ${l} sản phẩm (${d} có % video).`;
  }
  const getAuto = () => { try { return localStorage.getItem("td_auto") === "1"; } catch (e) { return false; } };
  const setAuto = (v) => { try { localStorage.setItem("td_auto", v ? "1" : "0"); } catch (e) {} };

  async function doRecordList(prefix) {
    try {
      const r = await recordList();
      if (!r.found) show("Không thấy dòng nào. Mở danh sách sản phẩm, hoặc bấm Chẩn đoán.");
      else show(`${prefix || ""}Thấy ${r.found} dòng, lưu ${r.saved}${r.noid ? `, ${r.noid} dòng chưa có mã` : ""}. ` + (await summary()));
    } catch (e) { show("Lỗi: " + e.message); }
  }
  let autoTimer = null, lastSig = "";
  function scheduleAuto(muts) {
    if (!getAuto() || onDetailPage()) return;
    if (muts && muts.every((m) => panel && panel.contains(m.target))) return;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(async () => {
      const rows = findListRows();
      if (!rows.length) return;
      const sig = location.search + "|" + (rows[0].innerText || "").slice(0, 80) + rows.length;
      if (sig === lastSig) return;
      lastSig = sig;
      await doRecordList("[Tự ghi] ");
    }, 2000);
  }
  async function readAllDetails() {
    const list = await load(LIST_KEY), det = await load(DETAIL_KEY);
    const urls = Object.values(list).filter((r) => r.id_sp && !det[r.id_sp]).map((r) => "https://tiktoday.vn/dashboard/products/" + r.id_sp);
    if (!urls.length) { show("Không còn sản phẩm nào cần đọc chi tiết (hoặc chưa có mã sản phẩm)."); return; }
    const maxN = parseInt(prompt(`Có ${urls.length} sản phẩm chưa đọc chi tiết. Đọc tối đa bao nhiêu cái (mỗi cái mất khoảng 10 giây)?`, String(Math.min(30, urls.length))), 10);
    if (!maxN) return;
    show(`Đang mở ${Math.min(maxN, urls.length)} sản phẩm ở tab nền...`);
    if (hasRuntime) chrome.runtime.sendMessage({ type: "scan_details", urls: urls.slice(0, maxN) });
  }
  if (hasRuntime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(async (msg) => {
      if (msg.type === "detail_progress") show(`Đọc chi tiết ${msg.i}/${msg.n} (ok ${msg.ok}, lỗi ${msg.fail})`);
      if (msg.type === "detail_finished") show(`Xong: ok ${msg.ok}, lỗi ${msg.fail}${msg.stopped ? " (đã dừng)" : ""}. ` + (await summary()));
    });
  }

  function buildPanel() {
    panel = document.createElement("div");
    panel.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#111;color:#fff;border:1px solid #22c55e;border-radius:12px;padding:10px 12px;font:13px/1.4 system-ui,sans-serif;width:262px;box-shadow:0 4px 16px rgba(0,0,0,.5)";
    const btn = (id, txt, css) => `<button id="${id}" style="${css || "flex:1;padding:5px;border-radius:6px;border:1px solid #555;background:#222;color:#fff;cursor:pointer"}">${txt}</button>`;
    panel.innerHTML =
      '<div style="font-weight:600;margin-bottom:6px">Đọc Tiktoday</div>' +
      '<div id="tdStatus" style="font-size:12px;color:#ddd;margin-bottom:8px;min-height:44px">Lọc sản phẩm, rồi bấm Ghi trang này.</div>' +
      '<label style="display:flex;gap:6px;align-items:center;font-size:12px;margin-bottom:8px;cursor:pointer"><input type="checkbox" id="tdAuto"> Tự ghi khi tôi đổi trang</label>' +
      btn("tdRec", "📥 Ghi trang này", "width:100%;padding:7px;border:0;border-radius:8px;background:#22c55e;color:#04210f;font-weight:700;cursor:pointer") +
      '<div style="display:flex;gap:6px;margin-top:6px">' + btn("tdDet", "Đọc % video của các SP") + btn("tdStop", "Dừng") + "</div>" +
      '<div style="display:flex;gap:6px;margin-top:6px">' + btn("tdCsv", "Tải CSV") + btn("tdJson", "Tải JSON") + btn("tdDiag", "Chẩn đoán") + "</div>" +
      btn("tdClear", "Xoá hết đã lưu", "width:100%;margin-top:6px;padding:4px;border-radius:6px;border:1px solid #733;background:#222;color:#f99;cursor:pointer;font-size:11px");
    document.body.appendChild(panel);
    statusEl = panel.querySelector("#tdStatus");
    summary().then((t) => show(t + " Lọc sản phẩm, rồi bấm Ghi trang này."));
    const chk = panel.querySelector("#tdAuto"); chk.checked = getAuto();
    chk.onchange = () => { setAuto(chk.checked); lastSig = ""; if (chk.checked) scheduleAuto(); };
    panel.querySelector("#tdRec").onclick = async () => {
      if (onDetailPage()) { const r = await recordDetail(false); show(r.ok ? `Đã ghi chi tiết: video ${r.d.video_pct}% doanh thu. ` + (await summary()) : "Chưa đọc được % video, đợi trang tải xong rồi bấm lại."); }
      else doRecordList("");
    };
    panel.querySelector("#tdDet").onclick = readAllDetails;
    panel.querySelector("#tdStop").onclick = () => hasRuntime && chrome.runtime.sendMessage({ type: "stop_details" });
    panel.querySelector("#tdCsv").onclick = exportCsv;
    panel.querySelector("#tdJson").onclick = exportJson;
    panel.querySelector("#tdDiag").onclick = diagnose;
    panel.querySelector("#tdClear").onclick = async () => { if (confirm("Xoá toàn bộ dữ liệu đã lưu?")) { await save(LIST_KEY, {}); await save(DETAIL_KEY, {}); show("Đã xoá hết."); } };
    new MutationObserver(scheduleAuto).observe(document.body, { childList: true, subtree: true, characterData: true });
    scheduleAuto();

    // Tab nền do công cụ mở (#dgauto): tự đọc rồi báo xong
    if (onDetailPage() && (location.hash.includes("dgauto") || getAuto())) {
      const iv = setInterval(async () => {
        const r = await recordDetail(true);
        if (r.ok) {
          clearInterval(iv);
          if (hasRuntime) chrome.runtime.sendMessage({ type: "detail_done" });
          show(`Đã ghi chi tiết: video ${r.d.video_pct}% doanh thu.`);
        } else if (!r.retry) clearInterval(iv);
      }, 1500);
    }
  }
  if (document.body) buildPanel(); else document.addEventListener("DOMContentLoaded", buildPanel);

  window.__tdTest = { parseVN, parseRange, findListRows, recordList, readDetail, recordDetail, buildRows, load, pathPoints };
})();
