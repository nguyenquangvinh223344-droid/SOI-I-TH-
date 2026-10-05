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
    return Math.round(n * mult);
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
  // ---- Bảng Excel dễ đọc: cột tiếng Việt, đường biểu đồ đổi thành điểm 0-100
  // (100 = cao nhất trên biểu đồ) đọc từ TRÁI (cũ) sang PHẢI (mới).
  function scoresOf(ysStr, h) {
    if (!ysStr) return [];
    const H = h || 24;
    return String(ysStr).split(";").map(Number).map((y) => Math.max(0, Math.min(100, Math.round((1 - y / H) * 100))));
  }
  function trendWord(sc) {
    if (sc.length < 2) return "";
    const first = sc[0], last = sc[sc.length - 1], prev = sc[sc.length - 2];
    const mn = Math.min(...sc), mx = Math.max(...sc);
    const mi = sc.indexOf(mn), xi = sc.indexOf(mx);
    let w = last - first >= 15 ? "Đi lên" : last - first <= -15 ? "Đi xuống" : "Đi ngang";
    if (mi > 0 && mi < sc.length - 1 && last - mn >= 25 && first - mn >= 25) w = "Sụt rồi bật lên";
    else if (xi > 0 && xi < sc.length - 1 && mx - last >= 25 && mx - first >= 25) w = "Lên rồi sụt";
    const recent = last - prev >= 8 ? " (gần đây tăng)" : last - prev <= -8 ? " (gần đây giảm)" : "";
    return w + recent;
  }
  function csvCell(v) {
    if (v == null) return "";
    const s = String(v);
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  const ORDER = { "Vào ngay": 1, "Đang hot": 2, "Né ra": 3, "Theo dõi": 4, "Đang giảm": 5 };
  function readableRows(all) {
    const sorted = all.slice().sort((a, b) =>
      (a.nganh_hang + a.nganh_hang_chi_tiet).localeCompare(b.nganh_hang + b.nganh_hang_chi_tiet, "vi") ||
      (ORDER[a.nhan] || 9) - (ORDER[b.nhan] || 9));
    return sorted.map((r) => {
      const hD = r.spark_info && r.spark_info[0] ? r.spark_info[0].h : 24;
      const hV = r.spark_info && r.spark_info[1] ? r.spark_info[1].h : 24;
      const sD = scoresOf(r.trend_don_ys, hD), sV = scoresOf(r.trend_video_ys, hV);
      return {
        "Ngành lớn": r.nganh_hang,
        "Ngách con": r.nganh_hang_chi_tiet,
        "Nhãn": r.nhan,
        "Tên sản phẩm (bị che)": r.ten_sp,
        "Đơn 30N": r.don30n,
        "Đơn đang": (r.mui_ten || "").replace("(màu)", ""),
        "Đã bán (trọn đời)": r.da_ban,
        "Video mới 30N (%)": r.video_moi_pct,
        "GMV 30N (triệu đồng)": r.gmv30n_vnd == null ? "" : Math.round(r.gmv30n_vnd / 1e6),
        "Hoa hồng (%)": r.hoa_hong_pct == null ? "" : r.hoa_hong_pct,
        "Trend đơn 90 ngày": trendWord(sD),
        "Trend đơn (điểm 0-100, trái=cũ, phải=mới)": sD.join(" > "),
        "Trend video 90 ngày": trendWord(sV),
        "Trend video (điểm 0-100, trái=cũ, phải=mới)": sV.join(" > "),
        "Link sản phẩm": r.link_sp,
        "Mã sản phẩm": r.id_sp ? "'" + r.id_sp : "",
        "Thời gian ghi": (r.thoi_gian || "").replace("T", " ").slice(0, 16),
      };
    });
  }
  function buildCsv(all) {
    const rows = readableRows(all);
    if (!rows.length) return "";
    const cols = Object.keys(rows[0]);
    return [cols.map(csvCell).join(",")].concat(rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))).join("\n");
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
    download("datangon-mau-de-doc.csv", "\ufeff" + buildCsv(all), "text/csv;charset=utf-8");
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
  let statusEl = null;
  const show = (t) => { if (statusEl) statusEl.textContent = t; };
  let panelEl = null;

  async function summary() {
    const a = Object.values(await loadAll());
    const nganh = new Set(a.map((r) => r.nganh_hang + ">" + r.nganh_hang_chi_tiet));
    return `Đã lưu ${a.length} dòng, ${nganh.size} ngách.`;
  }

  function getAuto() { try { return localStorage.getItem("dg_auto") === "1"; } catch (e) { return false; } }
  function setAuto(v) { try { localStorage.setItem("dg_auto", v ? "1" : "0"); } catch (e) {} }

  async function doRecord(prefix) {
    try {
      const r = await record();
      if (r.found === 0) show("Không thấy dòng nào. Bấm Chẩn đoán và gửi file cho Claude.");
      else show(`${prefix || ""}Thấy ${r.found} dòng, lưu ${r.saved}, khoá ${r.locked}, lỗi ${r.bad}. ` + (await summary()));
    } catch (e) { show("Lỗi: " + e.message); }
  }

  // Chế độ tự ghi: khi bạn đổi sang ngách khác và bảng hiện xong, tự ghi 1 lần.
  // Vẫn là bạn tự bấm chuyển ngách, công cụ chỉ ghi lại thay cho nút Ghi lại.
  let autoTimer = null, lastSig = "";
  function scheduleAuto(mutations) {
    if (!getAuto()) return;
    if (mutations && mutations.every((m) => panelEl && panelEl.contains(m.target))) return;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(async () => {
      const rows = findRows();
      if (!rows.length) return;
      const sig = location.search + "|" + (rows[0].innerText || "").slice(0, 80);
      if (sig === lastSig) return;
      lastSig = sig;
      await doRecord("[Tự ghi] ");
    }, 2000);
  }

  function buildPanel() {
    const box = document.createElement("div");
    panelEl = box;
    box.style.cssText =
      "position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#111;color:#fff;" +
      "border:1px solid #f97316;border-radius:12px;padding:10px 12px;font:13px/1.4 system-ui,sans-serif;" +
      "width:250px;box-shadow:0 4px 16px rgba(0,0,0,.5)";
    box.innerHTML =
      '<div style="font-weight:600;margin-bottom:6px">Thu thập mẫu</div>' +
      '<div id="dgStatus" style="font-size:12px;color:#ddd;margin-bottom:8px;min-height:44px">Mở một ngách rồi bấm Ghi lại.</div>' +
      '<label style="display:flex;gap:6px;align-items:center;font-size:12px;margin-bottom:8px;cursor:pointer"><input type="checkbox" id="dgAuto"> Tự ghi khi tôi đổi ngách</label>' +
      '<button id="dgRec" style="width:100%;padding:7px;border:0;border-radius:8px;background:#f97316;color:#fff;font-weight:600;cursor:pointer">📥 Ghi lại trang này</button>' +
      '<div style="display:flex;gap:6px;margin-top:6px">' +
      '<button id="dgCsv" style="flex:1;padding:5px;border-radius:6px;border:1px solid #555;background:#222;color:#fff;cursor:pointer">Tải CSV</button>' +
      '<button id="dgJson" style="flex:1;padding:5px;border-radius:6px;border:1px solid #555;background:#222;color:#fff;cursor:pointer">Tải JSON</button>' +
      '<button id="dgDiag" style="flex:1;padding:5px;border-radius:6px;border:1px solid #555;background:#222;color:#fff;cursor:pointer" title="Tải file để gửi cho Claude nếu đọc sai">Chẩn đoán</button>' +
      "</div>" +
      '<button id="dgClear" style="width:100%;margin-top:6px;padding:4px;border-radius:6px;border:1px solid #733;background:#222;color:#f99;cursor:pointer;font-size:11px">Xoá hết mẫu đã lưu</button>';
    document.body.appendChild(box);
    statusEl = box.querySelector("#dgStatus");
    summary().then((t) => show(t + " Mở một ngách rồi bấm Ghi lại."));

    const chk = box.querySelector("#dgAuto");
    chk.checked = getAuto();
    chk.onchange = () => { setAuto(chk.checked); lastSig = ""; if (chk.checked) scheduleAuto(); };

    box.querySelector("#dgRec").onclick = () => doRecord("");
    box.querySelector("#dgCsv").onclick = exportCsv;
    box.querySelector("#dgJson").onclick = exportJson;
    box.querySelector("#dgDiag").onclick = diagnose;
    box.querySelector("#dgClear").onclick = async () => {
      if (confirm("Xoá toàn bộ mẫu đã lưu?")) { await saveAll({}); show("Đã xoá hết."); }
    };
    new MutationObserver(scheduleAuto).observe(document.body, { childList: true, subtree: true, characterData: true });
    scheduleAuto();
  }

  if (document.body) buildPanel();
  else document.addEventListener("DOMContentLoaded", buildPanel);

  // để chạy thử tự động
  window.__dgTest = { buildCsv, readableRows, findRows, parseRow, pageInfo, record, parseCompact, pathPoints, loadAll };
})();
