// kenhsp3.js - mục "Kalodata" của trang kenhsp.html (nạp sau kenhsp2.js; dùng chung viNum, S2).
// Dữ liệu do kalodata.js ghi vào chrome.storage.local.kaloData khi sếp bấm "Đọc 3 khoảng ngày" trên trang Kalodata.
const K3 = (id) => document.getElementById(id);
const K_RANGES = ["Hôm qua", "7 ngày trước", "30 ngày trước"];
let KALO = {};

const kFmt = (t) => { if (!t) return ""; const d = new Date(t), p = (n) => String(n).padStart(2, "0"); return p(d.getDate()) + "/" + p(d.getMonth() + 1) + " " + p(d.getHours()) + ":" + p(d.getMinutes()); };
const kEsc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function renderKalo() {
  const keys = Object.keys(KALO);
  K3("kaCount").textContent = keys.length + " kênh đã đọc";
  K3("kaRows").innerHTML = keys.length ? keys.map((h) => {
    const d = KALO[h];
    const cells = K_RANGES.map((r) => { const x = d.ranges && d.ranges[r]; const g = (x && x.diag) || {}; return "<td class=\"num\">" + (x ? x.videos.length + " video (" + (g.videoPages || 0) + "/" + (g.videoTotalPages || "?") + " trang) · " + x.products.length + " SP (" + (g.productPages || 0) + "/" + (g.productTotalPages || "?") + " trang)" : "—") + "</td>"; }).join("");
    return "<tr><td>" + kEsc(h) + "</td>" + cells + "<td>" + kFmt(d.scannedAt) + "</td><td><button class=\"ks-del\" data-h=\"" + kEsc(h) + "\" title=\"Xóa kênh này\">✕</button></td></tr>";
  }).join("") : "";
  K3("kaEmpty").style.display = keys.length ? "none" : "";
  K3("kaRows").querySelectorAll(".ks-del").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("Xóa dữ liệu Kalodata của " + b.dataset.h + "?")) return;
    const g = (await chrome.storage.local.get("kaloData")).kaloData || {};
    delete g[b.dataset.h];
    await chrome.storage.local.set({ kaloData: g });
    await loadKalo();
  }));
}
async function loadKalo() {
  KALO = (await chrome.storage.local.get("kaloData")).kaloData || {};
  renderKalo();
  fillQrChan();
}
chrome.storage.onChanged.addListener((ch) => { if (ch.kaloData) { KALO = ch.kaloData.newValue || {}; renderKalo(); fillQrChan(); } });

K3("kaClear").addEventListener("click", async () => {
  if (!Object.keys(KALO).length) return;
  if (!confirm("Xóa TOÀN BỘ dữ liệu Kalodata đã đọc?")) return;
  await chrome.storage.local.set({ kaloData: {} });
  await loadKalo();
});

// ---- đọc ô bảng ---------------------------------------------------------------------------------------
const monthOf = (d) => { const m = String(d || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? m[3] + "-" + String(m[2]).padStart(2, "0") : ""; };
const masked = (t) => /^\*+$/.test(String(t || "").trim());
function parseVideoCell(t) {
  t = String(t || "");
  const dur = (t.match(/^(\d+\s?[sm])\b/) || [])[1] || "";
  return {
    dur,
    ad: /\bAD\b/.test(t) ? "AD" : "",
    ai: /\bAI\b/.test(t) ? "AI" : "",
    desc: t.replace(/^\d+\s?[sm]\b\s*/, "").replace(/\bAI\b|\bAD\b|Công cụ video/g, "").replace(/\s+/g, " ").trim(),
  };
}
function parseShopCell(t) {
  t = String(t || "").trim();
  const m = t.match(/^(.*?)\s*(THƯƠNG HIỆU|CÁ NHÂN|KHÁC)?$/);
  return { name: (m && m[1]) || t, type: (m && m[2]) || "" };
}

function buildKaloWorkbook() {
  const prodRows = [], vidRows = [], shopRows = [], overview = [], monthRows = [];
  Object.keys(KALO).forEach((h) => {
    const d = KALO[h];
    K_RANGES.forEach((rg) => {
      const x = d.ranges && d.ranges[rg];
      if (!x) return;
      const base = { "Kênh": h, "Khoảng ngày": rg, "Ngày (trên trang)": x.dateText || "" };
      x.products.forEach((r, i) => {
        const c = r.cells, id = r.ids && r.ids.id;
        prodRows.push(Object.assign({}, base, { "Hạng": Number(c[0]) || i + 1, "Tên sản phẩm": c[1] || "", "Mã sản phẩm": id || "", "Doanh thu": c[2] || "", "Doanh thu (số)": viNum(c[2]), "Lượt bán": viNum(c[3]), "Đơn giá bình quân": viNum(c[4]), "Mã cửa hàng": (r.ids && r.ids.seller_id) || "", "Link TikTok Shop": id ? "https://www.tiktok.com/shop/vn/pdp/" + id : "" }));
      });
      x.videos.forEach((r, i) => {
        const c = r.cells, v = parseVideoCell(c[1]), id = r.ids && r.ids.id;
        vidRows.push(Object.assign({}, base, { "Hạng": Number(c[0]) || i + 1, "Thời lượng": v.dur, "Quảng cáo (AD)": v.ad, "Video AI": v.ai, "Mô tả / hashtag": v.desc, "Doanh thu": c[3] || "", "Doanh thu (số)": viNum(c[3]), "Lượt xem": viNum(c[4]),
          "Tỉ lệ giao dịch do quảng cáo": c[5] || "", "Tỉ lệ xem quảng cáo": c[6] || "", "Chi phí quảng cáo": c[7] || "", "Ad ROAS": c[8] || "", "Ngày đăng": c[9] || "", "Tháng đăng": monthOf(c[9]), "Mã video": id || "", "Mã sản phẩm gắn": (r.ids && r.ids.product_ids) || "",
          "Link video TikTok": id ? "https://www.tiktok.com/" + h + "/video/" + id : "" }));
      });
      x.shops.forEach((r, i) => {
        const c = r.cells, s = parseShopCell(c[1]);
        shopRows.push(Object.assign({}, base, { "Hạng": Number(c[0]) || i + 1, "Tên cửa hàng": s.name, "Loại": s.type || (r.ids && r.ids.seller_type) || "", "Doanh thu": c[2] || "", "Doanh thu (số)": viNum(c[2]), "Số sản phẩm": viNum(c[3]), "Lượt bán": viNum(c[4]), "Mã cửa hàng": (r.ids && r.ids.seller_id) || "" }));
      });
      const bm = {};
      x.videos.forEach((r) => { const m = monthOf(r.cells[9]) || "?"; const o = bm[m] = bm[m] || { n: 0, ad: 0, rev: 0, revAd: 0 }; const isAd = /\bAD\b/.test(r.cells[1] || ""); const rv = viNum(r.cells[3]); o.n++; o.rev += rv; if (isAd) { o.ad++; o.revAd += rv; } });
      Object.keys(bm).sort().forEach((m) => monthRows.push({ "Kênh": h, "Khoảng ngày": rg, "Tháng đăng": m, "Số video (có doanh thu)": bm[m].n, "Số video có AD": bm[m].ad, "% video AD": bm[m].n ? Math.round((bm[m].ad / bm[m].n) * 100) : "", "Doanh thu các video": bm[m].rev, "Doanh thu video AD": bm[m].revAd }));
      const nAd = x.videos.filter((r) => /\bAD\b/.test(r.cells[1] || "")).length;
      const top = x.products[0];
      overview.push({ "Kênh": h, "Khoảng ngày": rg, "Ngày (trên trang)": x.dateText || "", "Số sản phẩm đọc được": x.products.length, "Doanh thu top sản phẩm (cộng)": x.products.reduce((s, r) => s + viNum(r.cells[2]), 0), "Số video đọc được": x.videos.length, "Số video có AD": nAd, "% video có AD": x.videos.length ? Math.round((nAd / x.videos.length) * 100) : "", "Sản phẩm đứng đầu": top ? (top.cells[1] || "") : "", "Cửa hàng đứng đầu": x.shops[0] ? parseShopCell(x.shops[0].cells[1]).name : "", "Trang video đọc / tổng": ((x.diag && x.diag.videoPages) || 0) + "/" + ((x.diag && x.diag.videoTotalPages) || "?"), "Trang sản phẩm đọc / tổng": ((x.diag && x.diag.productPages) || 0) + "/" + ((x.diag && x.diag.productTotalPages) || "?"), "Video đọc / mong đợi": x.videos.length + "/" + ((x.diag && x.diag.videoExpected) || "?"), "Sản phẩm đọc / mong đợi": x.products.length + "/" + ((x.diag && x.diag.productExpected) || "?"), "Ghi chú": [x.diag && x.diag.videoNote, x.diag && x.diag.productNote].filter(Boolean).join("; "), "Lượt xem còn lại khi đọc": d.quotaLeft == null ? "" : d.quotaLeft, "Bản tool đã đọc": d.build || "cũ (trước bản 18C)" });
    });
  });
  const addLinks = (ws) => {
    if (!ws["!ref"]) return;
    const rg = XLSX.utils.decode_range(ws["!ref"]);
    for (let c = rg.s.c; c <= rg.e.c; c++) {
      const h = ws[XLSX.utils.encode_cell({ r: 0, c })];
      if (!h || !/^Link/.test(String(h.v))) continue;
      for (let r = 1; r <= rg.e.r; r++) { const cell = ws[XLSX.utils.encode_cell({ r, c })]; if (cell && /^https?:\/\//.test(String(cell.v))) cell.l = { Target: String(cell.v) }; }
    }
  };
  const wb = XLSX.utils.book_new();
  [["Tổng quan", overview], ["Theo tháng", monthRows], ["Sản phẩm", prodRows], ["Video & Quảng cáo", vidRows], ["Cửa hàng", shopRows]].filter(([n, a]) => n !== "Cửa hàng" || a.length).forEach(([n, a]) => {
    const ws = a.length ? XLSX.utils.json_to_sheet(a) : XLSX.utils.aoa_to_sheet([["(không có dòng nào)"]]);
    addLinks(ws);
    XLSX.utils.book_append_sheet(wb, ws, n.slice(0, 31));
  });
  return wb;
}
K3("kaExport").addEventListener("click", () => {
  if (!Object.keys(KALO).length) { K3("kaStatus").textContent = "Chưa có dữ liệu Kalodata. Mở trang kênh trên Kalodata, bấm \"Đọc 3 khoảng ngày\" trong khung nhỏ ở góc phải dưới."; return; }
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  XLSX.writeFile(buildKaloWorkbook(), "Kalodata " + d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + ".xlsx");
  K3("kaStatus").textContent = "Đã xuất Excel Kalodata.";
});
loadKalo();

// ---- lưới mã QR: quét bằng điện thoại để mở thẳng video TikTok / sản phẩm trên TikTok Shop ---------------------
function fillQrChan() {
  const sel = K3("qrChan"), cur = sel.value, keys = Object.keys(KALO);
  sel.innerHTML = keys.map((h) => "<option value=\"" + kEsc(h) + "\">" + kEsc(h) + "</option>").join("") || "<option value=\"\">(chưa có kênh)</option>";
  if (cur && keys.includes(cur)) sel.value = cur;
  fillQrMonths();
}
function fillQrMonths() {
  const sel = K3("qrMonth"), cur = sel.value;
  const x = KALO[K3("qrChan").value] && KALO[K3("qrChan").value].ranges && KALO[K3("qrChan").value].ranges[K3("qrRange").value];
  const cnt = {};
  (x ? x.videos : []).forEach((r) => { const m = monthOf(r.cells[9]); if (m) { const o = cnt[m] = cnt[m] || { n: 0, ad: 0 }; o.n++; if (/\bAD\b/.test(r.cells[1] || "")) o.ad++; } });
  const months = Object.keys(cnt).sort().reverse();
  sel.innerHTML = "<option value=\"\">Tất cả tháng</option>" + months.map((m) => "<option value=\"" + m + "\">Tháng " + m.slice(5) + "/" + m.slice(0, 4) + " (" + cnt[m].n + " video, " + cnt[m].ad + " AD)</option>").join("");
  if (cur && months.includes(cur)) sel.value = cur;
}
K3("qrChan").addEventListener("change", fillQrMonths);
K3("qrRange").addEventListener("change", fillQrMonths);
const qrImg = (url) => "https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=6&data=" + encodeURIComponent(url);
function qrItems(chan, range, kind, adOnly, month) {
  const x = KALO[chan] && KALO[chan].ranges && KALO[chan].ranges[range];
  if (!x) return null;
  if (kind === "product") {
    // sản phẩm không có ngày đăng: khi chọn tháng, giữ các sản phẩm được GẮN trong video đăng tháng đó (nếu tick "Chỉ video có AD" thì chỉ video AD)
    let keep = null;
    if (month) {
      keep = new Set();
      x.videos.forEach((r) => { if (monthOf(r.cells[9]) !== month) return; if (adOnly && !/\bAD\b/.test(r.cells[1] || "")) return; String((r.ids && r.ids.product_ids) || "").split(",").filter(Boolean).forEach((p) => keep.add(p)); });
    }
    return x.products.filter((r) => !keep || (r.ids && keep.has(r.ids.id))).map((r) => ({ rank: Number(r.cells[0]) || 0, title: r.cells[1] || "", meta: "Doanh thu " + (r.cells[2] || "") + " · bán " + (r.cells[3] || ""), tag: "", url: r.ids && r.ids.id ? "https://www.tiktok.com/shop/vn/pdp/" + r.ids.id : "" })).filter((i) => i.url);
  }
  return x.videos.map((r) => { const v = parseVideoCell(r.cells[1]); return { rank: Number(r.cells[0]) || 0, title: (v.dur ? v.dur + " · " : "") + v.desc, meta: "Doanh thu " + (r.cells[3] || "") + " · xem " + (r.cells[4] || "") + " · đăng " + (r.cells[9] || ""), tag: [v.ad, v.ai].filter(Boolean).join(" "), ad: !!v.ad, month: monthOf(r.cells[9]), date: r.cells[9] || "", url: r.ids && r.ids.id ? "https://www.tiktok.com/" + chan + "/video/" + r.ids.id : "" }; })
    .filter((i) => i.url && (!adOnly || i.ad) && (!month || i.month === month));
}
K3("qrShow").addEventListener("click", () => {
  const chan = K3("qrChan").value, range = K3("qrRange").value, kind = K3("qrKind").value, adOnly = K3("qrAd").checked;
  const n = Math.max(1, Math.min(200, Number(K3("qrN").value) || 24));
  const month = K3("qrMonth").value;
  const items = qrItems(chan, range, kind, adOnly, month);
  if (!items) { K3("qrInfo").textContent = "Chưa có dữ liệu \"" + range + "\" của " + (chan || "kênh nào") + ". Đọc trên Kalodata trước."; K3("qrGrid").innerHTML = ""; return; }
  items.sort((a, b) => a.rank - b.rank);
  const shown = items.slice(0, n);
  K3("qrInfo").textContent = "Hiện " + shown.length + "/" + items.length + (kind === "video" ? " video" : " sản phẩm") + (adOnly ? " có AD" : "") + (month ? ", tháng " + month.slice(5) + "/" + month.slice(0, 4) : "") + " (" + range + ")." + (month && kind === "product" ? " Sản phẩm không có ngày đăng nên đây là các sản phẩm được gắn trong video đăng tháng đó." : "") + " Quét bằng camera điện thoại. Cần có mạng để tải ảnh QR.";
  K3("qrGrid").innerHTML = shown.map((i) => "<div class=\"qr-card\"><div class=\"qr-top\"><span>#" + i.rank + "</span>" + (i.tag ? "<span class=\"qr-tag\">" + kEsc(i.tag) + "</span>" : "") + "</div><img loading=\"lazy\" alt=\"QR\" src=\"" + kEsc(qrImg(i.url)) + "\"><div class=\"qr-title\">" + kEsc(i.title) + "</div><div class=\"qr-meta\">" + kEsc(i.meta) + "</div><a href=\"" + kEsc(i.url) + "\" target=\"_blank\" rel=\"noopener\">mở link</a></div>").join("");
});
