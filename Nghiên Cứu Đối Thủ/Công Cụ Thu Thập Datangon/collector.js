// ============================================================================
// collector.js - chạy trên datangon.com. KHÔNG tự động lướt hay bấm gì.
// Chỉ khi bạn bấm nút "Ghi lại" thì nó mới đọc các dòng sản phẩm ĐANG HIỆN
// trên màn hình bạn và lưu vào bộ nhớ của trình duyệt. Dòng bị khoá (mờ,
// có chữ "Khoá") thì bỏ qua.
// Lưu cả "đường biểu đồ nhỏ" (Trend đơn, Trend video) vì nhãn có thể được
// tính từ hình dáng của hai đường đó.
// ============================================================================
(function () {
  if (window.__dgCollectorLoaded) return;
  window.__dgCollectorLoaded = true;

  const STORE_KEY = "dg_samples";
  const LABELS = ["Vào ngay", "Đang hot", "Né ra", "Theo dõi", "Đang giảm"];

  // ---------------------------------------------------------------- lưu trữ
  const hasChrome = typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
  async function loadAll() {
    if (hasChrome) {
      const r = await chrome.storage.local.get(STORE_KEY);
      return r[STORE_KEY] || {};
    }
    return JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
  }
  async function saveAll(obj) {
    if (hasChrome) await chrome.storage.local.set({ [STORE_KEY]: obj });
    else localStorage.setItem(STORE_KEY, JSON.stringify(obj));
  }

  // ---------------------------------------------------------- đọc con số
  // Datangon ghi gọn: 22.9K, 406M, 2.1T. Đoán "T" = tỷ (đã so với đơn x giá
  // thì khớp). Luôn lưu cả chữ gốc để sau này sửa được.
  function parseCompact(s) {
    if (s == null) return null;
    s = String(s).replace(/[↑↓↗↘▲▼]/g, "").replace(/\s/g, "");
    if (!s || /^[—–-]+$/.test(s)) return null;
    const m = s.match(/^([\d.,]+)([KkMmBbTt]?)/);
    if (!m) return null;
    const n = parseFloat(m[1].replace(/,/g, "."));
    if (isNaN(n)) return null;
    const mult = { K: 1e3, M: 1e6, B: 1e9, T: 1e9 }[m[2].toUpperCase()] || 1;
    return n * mult;
  }
  function parsePct(s) {
    if (s == null) return null;
    const m = String(s).match(/(-?[\d.,]+)\s*%/);
    return m ? parseFloat(m[1].replace(/,/g, ".")) : null;
  }
  function parseCount(s) {
    // số đếm kiểu "2.403" hoặc "5.048" (dấu chấm là phân cách hàng nghìn)
    const d = String(s).replace(/[^\d]/g, "");
    return d ? parseInt(d, 10) : null;
  }

  // ------------------------------------------------------- đường biểu đồ
  function pathPoints(d) {
    const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
    let i = 0, cmd = null, x = 0, y = 0;
    const pts = [];
    const num = () => parseFloat(tokens[i++]);
    let guard = 0;
    while (i < tokens.length && guard++ < 5000) {
      if (/^[a-zA-Z]$/.test(tokens[i])) cmd = tokens[i++];
      else if (cmd == null) break;
      const rel = cmd === cmd.toLowerCase();
      const C = cmd.toUpperCase();
      if (C === "Z") continue;
      if (C === "M" || C === "L" || C === "T") {
        const nx = num(), ny = num();
        x = rel ? x + nx : nx; y = rel ? y + ny : ny; pts.push([x, y]);
        if (C === "M") cmd = rel ? "l" : "L";
      } else if (C === "H") {
        const nx = num(); x = rel ? x + nx : nx; pts.push([x, y]);
      } else if (C === "V") {
        const ny = num(); y = rel ? y + ny : ny; pts.push([x, y]);
      } else if (C === "C") {
        num(); num(); num(); num();
        const nx = num(), ny = num();
        x = rel ? x + nx : nx; y = rel ? y + ny : ny; pts.push([x, y]);
      } else if (C === "S" || C === "Q") {
        num(); num();
        const nx = num(), ny = num();
        x = rel ? x + nx : nx; y = rel ? y + ny : ny; pts.push([x, y]);
      } else if (C === "A") {
        for (let k = 0; k < 5; k++) num();
        const nx = num(), ny = num();
        x = rel ? x + nx : nx; y = rel ? y + ny : ny; pts.push([x, y]);
      } else { i++; }
    }
    return pts.filter((p) => isFinite(p[0]) && isFinite(p[1]));
  }

  function readSparklines(row) {
    const out = [];
    row.querySelectorAll("svg").forEach((svg) => {
      const rect = svg.getBoundingClientRect();
      const paths = Array.from(svg.querySelectorAll("path, polyline")).map((p) => {
        const d = p.getAttribute("d") || p.getAttribute("points") || "";
        const pts = p.tagName.toLowerCase() === "polyline"
          ? d.trim().split(/\s+/).map((s) => s.split(",").map(Number))
          : pathPoints(d);
        return { d, hasZ: /z/i.test(d), points: pts };
      });
      const best = paths.filter((p) => p.points.length >= 4);
      if (!best.length || rect.width < 40) return; // bỏ icon nhỏ (bookmark, mở link...)
      const line = best.find((p) => !p.hasZ) || best[0];
      out.push({
        left: Math.round(rect.left),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        viewBox: svg.getAttribute("viewBox") || "",
        points: line.points.map((p) => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]),
        rawPaths: paths.map((p) => p.d).slice(0, 3),
      });
    });
    out.sort((a, b) => a.left - b.left); // trái -> phải: Trend đơn, rồi Trend video
    return out;
  }

  // ------------------------------------------------------------ tìm dòng
  // Không biết cấu trúc trang, nên tìm theo chữ: dòng sản phẩm là phần tử
  // nhỏ nhất vừa chứa chữ "hoa hồng", "đã bán", "GMV", "video mới" và ảnh.
  function findRows() {
    const leaves = Array.from(document.querySelectorAll("*")).filter(
      (el) => el.children.length === 0 && /^hoa hồng$/i.test((el.textContent || "").trim())
    );
    const rows = [];
    for (const leaf of leaves) {
      let el = leaf.parentElement;
      while (el && el !== document.body) {
        const t = el.innerText || "";
        if ((t.match(/hoa hồng/gi) || []).length > 1) break;
        if (/đã bán/i.test(t) && /GMV/i.test(t) && /video mới/i.test(t) && el.querySelector("img")) {
          if (!rows.includes(el)) rows.push(el);
          break;
        }
        el = el.parentElement;
      }
    }
    return rows;
  }

  function linesOf(row) {
    return (row.innerText || "")
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function valueBefore(lines, captionRe) {
    const i = lines.findIndex((l) => captionRe.test(l));
    if (i <= 0) return null;
    for (let k = i - 1; k >= 0; k--) {
      const stripped = lines[k].replace(/[↑↓↗↘▲▼]/g, "").trim();
      if (stripped) return lines[k];
    }
    return null;
  }

  function colorOfValue(row, valueText) {
    if (!valueText) return "";
    const clean = valueText.replace(/[↑↓↗↘▲▼]/g, "").trim();
    const els = Array.from(row.querySelectorAll("*")).filter(
      (e) => (e.textContent || "").trim().replace(/[↑↓↗↘▲▼]/g, "").trim() === clean
    );
    const el = els[els.length - 1];
    return el ? getComputedStyle(el).color : "";
  }

  function arrowOf(valueText, color) {
    if (!valueText) return "";
    if (/[↑↗▲]/.test(valueText)) return "tăng";
    if (/[↓↘▼]/.test(valueText)) return "giảm";
    const m = (color || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (m) {
      const r = +m[1], g = +m[2], b = +m[3];
      if (g > r + 30 && g > b + 30) return "tăng(màu)";
      if (r > g + 40 && r > b + 40) return "giảm(màu)";
    }
    return "";
  }

  function parseRow(row) {
    const lines = linesOf(row);
    const text = lines.join(" | ");
    if (/Khoá|Khóa/.test(text)) return { locked: true };

    const label = lines.map((l) => LABELS.find((x) => x.toLowerCase() === l.toLowerCase())).find(Boolean) || "";
    const labelIdx = lines.findIndex((l) => l.toLowerCase() === label.toLowerCase());

    // điểm sao và số đánh giá có thể nằm chung một dòng (kèm icon ngôi sao)
    const rm = text.match(/(\d\.\d)\D{0,6}\(\s*([\d.,]+\s*[KkMm]?)\s*\)/);
    const rating = rm ? rm[1] : "";
    const reviews = rm ? rm[2].replace(/\s/g, "") : "";
    const nameLine = lines.find((l, i) => i < (labelIdx < 0 ? 6 : labelIdx) && /[A-Za-zÀ-ỹ]{3,}/.test(l) && !/^\d/.test(l)) || "";

    const donRaw = valueBefore(lines, /^đơn 30n$/i);
    const baRaw = valueBefore(lines, /^đã bán$/i);
    const vmRaw = valueBefore(lines, /^video mới/i);
    const gmvRaw = valueBefore(lines, /^GMV 30n$/i);
    const hhRaw = valueBefore(lines, /^hoa hồng$/i);

    const donColor = colorOfValue(row, donRaw);
    const spark = readSparklines(row);
    const ys = (s) => (s ? s.points.map((p) => p[1]).join(";") : "");

    const img = row.querySelector("img");
    // link "mở sản phẩm trên TikTok" (biểu tượng ở cuối dòng), có chứa mã sản phẩm
    const linkEl = Array.from(row.querySelectorAll("a[href]")).find((a) => /\/product\/\d+/.test(a.href)) ||
      Array.from(row.querySelectorAll("a[href]")).find((a) => /tiktok\.com/.test(a.href));
    const link = linkEl ? linkEl.href : "";
    const idm = link.match(/\/product\/(\d+)/);
    return {
      locked: false,
      id_sp: idm ? idm[1] : "",
      link_sp: link,
      nhan: label,
      ten_sp: nameLine,
      sao: rating,
      so_danh_gia_raw: reviews,
      don30n_raw: donRaw ? donRaw.replace(/[↑↓↗↘▲▼]/g, "").trim() : "",
      don30n: parseCompact(donRaw),
      mui_ten: arrowOf(donRaw, donColor),
      don30n_mau: donColor,
      da_ban_raw: baRaw || "",
      da_ban: parseCompact(baRaw),
      video_moi_pct: parsePct(vmRaw),
      video_moi_raw: vmRaw || "",
      gmv30n_raw: gmvRaw || "",
      gmv30n_vnd: parseCompact(gmvRaw),
      hoa_hong_raw: hhRaw || "",
      hoa_hong_pct: parsePct(hhRaw),
      trend_don_ys: ys(spark[0]),
      trend_video_ys: ys(spark[1]),
      so_duong_bieu_do: spark.length,
      spark_info: spark.map((s) => ({ w: s.width, h: s.height, viewBox: s.viewBox })),
      anh: img ? img.src : "",
      van_ban_dong: text,
      html_goc: row.outerHTML.slice(0, 6000), // để mình sửa lỗi nếu đọc sai
    };
  }

  // ---------------------------------------------------- thông tin ngách
  function pageInfo() {
    const u = new URL(location.href);
    const nganh = u.searchParams.get("nganh_hang") || "";
    const chiTiet = u.searchParams.get("nganh_hang_chi_tiet") || "";
    const counts = {};
    Array.from(document.querySelectorAll("button, a, div, span")).forEach((el) => {
      if (el.children.length > 2) return;
      const m = (el.textContent || "").trim().match(/^(Vào ngay|Đang hot|Né ra|Theo dõi|Đang giảm)\s*\(\s*([\d.,]+)\s*\)$/i);
      if (m) counts[LABELS.find((l) => l.toLowerCase() === m[1].toLowerCase())] = parseCount(m[2]);
    });
    const body = document.body.innerText || "";
    const tong = (body.match(/([\d.,]+)\s*sản phẩm/i) || [])[1];
    const capNhat = (body.match(/Cập nhật:\s*([\d:]+\s+[\d/]+)/i) || [])[1] || "";
    return {
      nganh_hang: nganh,
      nganh_hang_chi_tiet: chiTiet,
      dem_theo_nhan: counts,
      tong_sp_ngach: tong ? parseCount(tong) : null,
      cap_nhat_tren_trang: capNhat,
    };
  }

  // ----------------------------------------------------------- ghi lại
  async function record() {
    const rows = findRows();
    const info = pageInfo();
    const all = await loadAll();
    let saved = 0, locked = 0, bad = 0;
    for (const row of rows) {
      const r = parseRow(row);
      if (r.locked) { locked++; continue; }
      if (!r.nhan) { bad++; continue; }
      const key = [info.nganh_hang, info.nganh_hang_chi_tiet, r.nhan, r.id_sp || r.anh || r.ten_sp].join("||");
      all[key] = Object.assign({ thoi_gian: new Date().toISOString(), url: location.href }, info, r);
      saved++;
    }
    await saveAll(all);
    return { found: rows.length, saved, locked, bad, total: Object.keys(all).length };
  }

  // ------------------------------------------------------------- xuất
  const CSV_COLS = [
    "thoi_gian", "nganh_hang", "nganh_hang_chi_tiet", "nhan", "id_sp", "link_sp", "ten_sp", "sao", "so_danh_gia_raw",
    "don30n_raw", "don30n", "mui_ten", "da_ban_raw", "da_ban", "video_moi_pct", "gmv30n_raw",
    "gmv30n_vnd", "hoa_hong_raw", "hoa_hong_pct", "trend_don_ys", "trend_video_ys",
    "so_duong_bieu_do", "tong_sp_ngach", "cap_nhat_tren_trang", "url",
  ];
  function csvCell(v) {
    if (v == null) return "";
    const s = String(v);
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  async function exportCsv() {
    const all = Object.values(await loadAll());
    const lines = [CSV_COLS.join(",")];
    for (const r of all) {
      const flat = Object.assign({}, r, {
        dem_theo_nhan: undefined,
      });
      lines.push(CSV_COLS.map((c) => csvCell(flat[c])).join(","));
    }
    download("datangon-mau.csv", "\ufeff" + lines.join("\n"), "text/csv;charset=utf-8");
  }
  async function exportJson() {
    download("datangon-mau.json", JSON.stringify(Object.values(await loadAll()), null, 2), "application/json");
  }
  async function diagnose() {
    const rows = findRows();
    const payload = {
      url: location.href,
      info: pageInfo(),
      so_dong_tim_thay: rows.length,
      dong: rows.slice(0, 4).map((r) => ({ vanBan: linesOf(r), html: r.outerHTML.slice(0, 5000), parse: (() => { try { const p = parseRow(r); delete p.html_goc; return p; } catch (e) { return "LOI: " + e.message; } })() })),
      bodyMau: (document.body.innerText || "").slice(0, 1500),
    };
    download("datangon-chan-doan.json", JSON.stringify(payload, null, 2), "application/json");
  }

  // ---------------------------------------------------------------- UI
  function buildPanel() {
    const box = document.createElement("div");
    box.style.cssText =
      "position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#111;color:#fff;" +
      "border:1px solid #f97316;border-radius:12px;padding:10px 12px;font:13px/1.4 system-ui,sans-serif;" +
      "width:230px;box-shadow:0 4px 16px rgba(0,0,0,.5)";
    box.innerHTML =
      '<div style="font-weight:600;margin-bottom:6px">Thu thập mẫu</div>' +
      '<div id="dgStatus" style="font-size:12px;color:#ddd;margin-bottom:8px;min-height:32px">Mở một ngách rồi bấm Ghi lại.</div>' +
      '<button id="dgRec" style="width:100%;padding:7px;border:0;border-radius:8px;background:#f97316;color:#fff;font-weight:600;cursor:pointer">📥 Ghi lại trang này</button>' +
      '<div style="display:flex;gap:6px;margin-top:6px">' +
      '<button id="dgCsv" style="flex:1;padding:5px;border-radius:6px;border:1px solid #555;background:#222;color:#fff;cursor:pointer">CSV</button>' +
      '<button id="dgJson" style="flex:1;padding:5px;border-radius:6px;border:1px solid #555;background:#222;color:#fff;cursor:pointer">JSON</button>' +
      '<button id="dgDiag" style="flex:1;padding:5px;border-radius:6px;border:1px solid #555;background:#222;color:#fff;cursor:pointer" title="Tải file để gửi cho Claude nếu đọc sai">Chẩn đoán</button>' +
      "</div>" +
      '<button id="dgClear" style="width:100%;margin-top:6px;padding:4px;border-radius:6px;border:1px solid #733;background:#222;color:#f99;cursor:pointer;font-size:11px">Xoá hết mẫu đã lưu</button>';
    document.body.appendChild(box);
    const status = box.querySelector("#dgStatus");
    const show = (s) => (status.textContent = s);
    loadAll().then((a) => show(`Đã lưu ${Object.keys(a).length} dòng. Mở một ngách rồi bấm Ghi lại.`));

    box.querySelector("#dgRec").onclick = async () => {
      try {
        const r = await record();
        if (r.found === 0) show("Không thấy dòng nào. Bấm Chẩn đoán và gửi file cho Claude.");
        else show(`Thấy ${r.found} dòng, lưu ${r.saved}, khoá ${r.locked}, lỗi ${r.bad}. Tổng đã lưu: ${r.total}.`);
      } catch (e) { show("Lỗi: " + e.message); }
    };
    box.querySelector("#dgCsv").onclick = exportCsv;
    box.querySelector("#dgJson").onclick = exportJson;
    box.querySelector("#dgDiag").onclick = diagnose;
    box.querySelector("#dgClear").onclick = async () => {
      if (confirm("Xoá toàn bộ mẫu đã lưu?")) { await saveAll({}); show("Đã xoá hết."); }
    };
  }

  if (document.body) buildPanel();
  else document.addEventListener("DOMContentLoaded", buildPanel);

  // để chạy thử tự động
  window.__dgTest = { findRows, parseRow, pageInfo, record, parseCompact, pathPoints, loadAll };
})();
