// kenhsp2.js - mục "Soi cửa hàng" của trang kenhsp.html (nạp sau kenhsp.js, dùng chung $, esc, extractUsername, applyTheme...).
const S2 = (id) => document.getElementById(id);

// ---- đọc số kiểu Việt Nam: "316,13 k", "2,75 tr", "1,2 tỉ" ----------------------------------
function viNum(s) {
  if (s == null || s === "") return 0;
  if (typeof s === "number") return s;
  const m = String(s).replace(/[₫đ\s]/g, "").match(/^([\d.,]+)(k|tr|ti|tỉ|tỷ|m|b)?$/i);
  if (!m) { const n = Number(String(s).replace(/[^\d.\-]/g, "")); return isNaN(n) ? 0 : n; }
  let num = m[1];
  const suf = (m[2] || "").toLowerCase();
  if (/^\d{1,3}(\.\d{3})+$/.test(num)) num = num.replace(/\./g, "");           // 1.234.567
  else num = num.replace(/\./g, "").replace(",", ".");                          // 316,13
  let n = parseFloat(num);
  if (isNaN(n)) return 0;
  const mul = { k: 1e3, tr: 1e6, m: 1e6, b: 1e9, ti: 1e9, "tỉ": 1e9, "tỷ": 1e9 }[suf] || 1;
  return Math.round(n * mul);
}

// ---- đọc chữ trên thẻ bên trái của trang cửa hàng ----------------------------------------------
function parseCard(t) {
  t = String(t || "").replace(/\s+/g, " ");
  const g = (re) => { const m = t.match(re); return m ? m : null; };
  const out = { sold: 0, rating: 0, hhMin: 0, hhMax: 0, hhCommon: 0, koc30: 0, video30: 0, priceMin: 0, priceMax: 0, nProducts: 0, nOpen: 0, cat: "", hot: "" };
  let m = g(/Hoa hồng[^\d]{0,6}(\d+(?:[.,]\d+)?)\s*[–\-]\s*(\d+(?:[.,]\d+)?)\s*%/i);
  if (m) { out.hhMin = viNum(m[1]); out.hhMax = viNum(m[2]); }
  else if ((m = g(/Hoa hồng[^\d]{0,6}(\d+(?:[.,]\d+)?)\s*%/i))) { out.hhMin = out.hhMax = viNum(m[1]); }
  if ((m = g(/phổ biến\s*(\d+(?:[.,]\d+)?)\s*%/i))) out.hhCommon = viNum(m[1]);
  if ((m = g(/Lượt bán[^\d]{0,6}([\d.,]+\s*(?:k|tr)?)/i))) out.sold = viNum(m[1]);
  if ((m = g(/\s(\d\.\d)\s+Lượt bán/i))) out.rating = parseFloat(m[1]);
  if ((m = g(/KOC 30 ngày[^\d]{0,6}([\d.,]+\s*(?:k|tr)?)/i))) out.koc30 = viNum(m[1]);
  if ((m = g(/Video 30 ngày[^\d]{0,6}([\d.,]+\s*(?:k|tr)?)/i))) out.video30 = viNum(m[1]);
  if ((m = g(/Giá bán:?\s*₫?\s*([\d.,]+\s*(?:k|tr)?)\s*[–\-]\s*₫?\s*([\d.,]+\s*(?:k|tr)?)/i))) { out.priceMin = viNum(m[1]); out.priceMax = viNum(m[2]); }
  if ((m = g(/Sản phẩm:?\s*([\d.,]+)\s*[·•]\s*([\d.,]+)\s*mở hoa hồng/i))) { out.nProducts = viNum(m[1]); out.nOpen = viNum(m[2]); }
  if ((m = g(/Danh mục chính:?\s*(.+?)\s*(?:Nổi bật|Giá bán|Sản phẩm:|$)/i))) out.cat = m[1].slice(0, 80);
  if ((m = g(/Nổi bật:?\s*(.+?)\s*(?:Giá bán|Sản phẩm:|$)/i))) out.hot = m[1].slice(0, 120);
  return out;
}

// ---- nguồn shop: mã / link / tên kênh đã quét ---------------------------------------------------
async function resolveSources() {
  const { shopScanData } = await chrome.storage.local.get("shopScanData");
  const chans = shopScanData || {};
  const groups = {};            // id -> Set(nhãn nguồn)
  const notes = [];
  const add = (id, label) => { (groups[id] = groups[id] || new Set()).add(label); };
  const tokens = S2("siList").value.split(/[\n,;\s]+/).map((x) => x.trim()).filter(Boolean);
  tokens.forEach((tk) => {
    const idm = tk.match(/(\d{15,22})/);
    if (idm) { add(idm[1], "Nhập tay"); return; }
    const u = extractUsername(tk);
    if (!u) { notes.push("Bỏ qua: " + tk); return; }
    const key = Object.keys(chans).find((k) => k.toLowerCase() === u.toLowerCase());
    if (!key) { notes.push("Kênh @" + u + " chưa quét ở mục \"Soi sản phẩm các kênh\" (phía trên) nên chưa có danh sách shop. Quét kênh đó trước, hoặc dán mã shop."); return; }
    let n = 0;
    (chans[key].shops || []).forEach((r) => { const id = r.raw && r.raw.id; if (id && /^\d{15,22}$/.test(String(id))) { add(String(id), "@" + key); n++; } });
    if (!n) notes.push("Kênh @" + key + " không có shop nào có mã.");
  });
  return { groups, notes };
}
async function previewSources() {
  const { groups, notes } = await resolveSources();
  const n = Object.keys(groups).length;
  const by = {};
  Object.keys(groups).forEach((id) => groups[id].forEach((l) => { by[l] = (by[l] || 0) + 1; }));
  const have = Object.keys(SI_DATA).filter((id) => groups[id]).length;
  S2("siInfo").textContent = (n ? "Có " + n + " shop khác nhau (" + Object.keys(by).map((l) => l + ": " + by[l]).join(", ") + "). Đã quét xong " + have + " shop, sẽ quét tiếp " + (S2("siForce").checked ? n : n - have) + " shop còn lại." : "Chưa có shop nào.") + (notes.length ? "\n" + notes.join("\n") : "");
  return { groups, notes };
}
S2("siList").addEventListener("input", () => { previewSources(); });
S2("siForce").addEventListener("change", () => { previewSources(); });
S2("siFill").addEventListener("click", () => { S2("siList").value = "thch.ht.do55\nni.nguyn254"; previewSources(); });

// ---- chạy / dừng --------------------------------------------------------------------------------
let SI_DATA = {};
S2("siStart").addEventListener("click", async () => {
  const { groups } = await previewSources();
  const ids = Object.keys(groups);
  if (!ids.length) return;
  const g = (await chrome.storage.local.get("shopInfoGroups")).shopInfoGroups || {};
  ids.forEach((id) => { g[id] = Array.from(new Set([...(g[id] || []), ...groups[id]])); });
  await chrome.storage.local.set({ shopInfoGroups: g });
  const r = await chrome.runtime.sendMessage({ type: "shopinfo_start", ids, force: S2("siForce").checked });
  if (!r || !r.ok) S2("siStatus").textContent = (r && r.error) || "Không bắt đầu được.";
});
S2("siStop").addEventListener("click", () => chrome.runtime.sendMessage({ type: "shopinfo_stop" }));
S2("siClear").addEventListener("click", async () => {
  if (!Object.keys(SI_DATA).length) return;
  if (!confirm("Xóa TOÀN BỘ dữ liệu cửa hàng đã quét? (Phải quét lại.)")) return;
  await chrome.runtime.sendMessage({ type: "shopinfo_clear" });
  await loadSI();
});
function renderSI(st) {
  // tool có thể đã bị Chrome ngắt giữa chừng (trạng thái vẫn ghi "đang quét" nhưng không còn nhịp tim)
  if (st && st.running && st.beat && Date.now() - st.beat > 90000) {
    S2("siStart").disabled = false; S2("siStop").disabled = true;
    S2("siStatus").textContent = "⚠ Lần quét trước có vẻ đã bị ngắt (không thấy hoạt động hơn 1 phút). Bấm \"Quét cửa hàng\" để chạy tiếp: shop nào đã quét xong sẽ được bỏ qua.";
    S2("siLog").textContent = st.log && st.log.length ? st.log.join("\n") : "—";
    return;
  }
  if (!st || !Object.keys(st).length) {
    S2("siStart").disabled = false; S2("siStop").disabled = true; S2("siBar").style.width = "0%";
    S2("siStatus").textContent = "Sẵn sàng."; S2("siLog").textContent = "—";
    return;
  }
  const run = !!st.running;
  S2("siStart").disabled = run;
  S2("siStop").disabled = !run;
  const pct = st.total ? Math.round((((run ? Math.max(0, (st.index || 1) - 1) : (st.index || 0))) / st.total) * 100) : 0;
  S2("siBar").style.width = (st.done && !st.stopped ? 100 : pct) + "%";
  if (run) S2("siStatus").textContent = "Đang quét shop " + st.index + "/" + st.total + " (đọc được " + (st.ok || 0) + "): " + (st.current || "") + (st.waitSec ? " · đã đợi " + st.waitSec + " giây" : "");
  else if (st.done) S2("siStatus").textContent = (st.stopped ? "Đã dừng. " : "Xong. ") + "Đọc được " + (st.ok || 0) + " shop. Bấm \"Xuất Excel cửa hàng\" để lấy file.";
  S2("siLog").textContent = st.log && st.log.length ? st.log.join("\n") : "—";
}
async function loadSI() {
  const g = await chrome.storage.local.get(["shopInfoData", "shopInfoState"]);
  SI_DATA = g.shopInfoData || {};
  S2("siCount").textContent = Object.keys(SI_DATA).length + " shop đã quét";
  renderSI(g.shopInfoState);
}
chrome.runtime.onMessage.addListener((m) => { if (m && m.type === "shopinfo_progress") { renderSI(m.state); chrome.storage.local.get("shopInfoData").then((g) => { SI_DATA = g.shopInfoData || {}; S2("siCount").textContent = Object.keys(SI_DATA).length + " shop đã quét"; }); } });

// ---- Excel ---------------------------------------------------------------------------------------
const med = (a) => { a = a.filter((x) => typeof x === "number" && !isNaN(x)).sort((p, q) => p - q); if (!a.length) return ""; const h = a.length >> 1; return a.length % 2 ? a[h] : Math.round((a[h - 1] + a[h]) / 2 * 100) / 100; };
const mn = (a) => { a = a.filter((x) => typeof x === "number" && !isNaN(x)); return a.length ? Math.min.apply(null, a) : ""; };
const mx = (a) => { a = a.filter((x) => typeof x === "number" && !isNaN(x)); return a.length ? Math.max.apply(null, a) : ""; };
function bucketOf(v, edges, labels) { for (let i = 0; i < edges.length; i++) if (v < edges[i]) return labels[i]; return labels[labels.length - 1]; }
const B_SOLD = [[1e4, 5e4, 1e5, 3e5, 1e6, 1e7], ["<10K", "10K-50K", "50K-100K", "100K-300K", "300K-1tr", "1tr-10tr", ">10tr"]];
const B_PRICE = [[5e4, 2e5, 5e5, 1e6], ["<50K", "50K-200K", "200K-500K", "500K-1M", ">1M"]];
const B_PROD = [[100, 1e3, 1e4], ["<100", "100-1K", "1K-10K", ">10K"]];
const B_KOC = [[10, 100, 1e3], ["<10", "10-100", "100-1K", ">1K"]];
const B_VID = [[50, 500, 5e3], ["<50", "50-500", "500-5K", ">5K"]];

async function buildShopWorkbook() {
  const g = await chrome.storage.local.get(["shopInfoData", "shopInfoGroups", "shopScanData"]);
  const data = g.shopInfoData || {}, groups = g.shopInfoGroups || {}, chans = g.shopScanData || {};
  // shop nào được bao nhiêu kênh (trong dữ liệu 18 kênh) dùng
  const usedBy = {};
  Object.keys(chans).forEach((c) => (chans[c].shops || []).forEach((r) => { const id = r.raw && r.raw.id; if (id) { (usedBy[String(id)] = usedBy[String(id)] || new Set()).add(c); } }));
  const rows = Object.keys(data).map((id) => {
    const d = data[id], s = d.shop || {}, c = parseCard(d.card);
    const sold = viNum(s.sold_count) || c.sold, nprod = viNum(s.product_count) || c.nProducts;
    return {
      id, name: String(s.name || (d.title || "").split(" | ")[0] || ""), src: (groups[id] || []).join(", "), nSrc: (groups[id] || []).length,
      usedN: (usedBy[id] || new Set()).size, used: Array.from(usedBy[id] || []).map((x) => "@" + x).join(", "),
      sold, rev: viNum(s.revenue), nprod, price: viNum(s.unit_price), creators: viNum(s.creator_count), videos: viNum(s.video_count), lives: viNum(s.live_count), rating: viNum(s.rating) || c.rating,
      hhMin: c.hhMin, hhMax: c.hhMax, hhCommon: c.hhCommon, koc30: c.koc30, video30: c.video30, priceMin: c.priceMin, priceMax: c.priceMax, nOpen: c.nOpen,
      pctOpen: (c.nProducts || nprod) ? Math.round((c.nOpen / (c.nProducts || nprod)) * 1000) / 10 : 0, cat: c.cat, hot: c.hot, card: d.card || "", s,
    };
  });
  rows.sort((a, b) => b.sold - a.sold);

  const sheetShops = rows.map((r) => ({ "Mã cửa hàng": r.id, "Tên cửa hàng": r.name, "Nguồn (kênh nhập)": r.src, "Số kênh trong dữ liệu 18 kênh dùng": r.usedN, "Các kênh dùng": r.used,
    "Lượt bán": r.sold, "Doanh thu": r.rev, "Số sản phẩm": r.nprod, "Đơn giá bình quân": r.price, "Số nhà sáng tạo (tổng)": r.creators, "Số video (tổng)": r.videos, "Số live": r.lives, "Đánh giá": r.rating,
    "Hoa hồng thấp %": r.hhMin || "", "Hoa hồng cao %": r.hhMax || "", "Hoa hồng phổ biến %": r.hhCommon || "", "KOC 30 ngày": r.koc30 || "", "Video 30 ngày": r.video30 || "",
    "Giá bán thấp": r.priceMin || "", "Giá bán cao": r.priceMax || "", "SP đã mở hoa hồng": r.nOpen || "", "% SP mở hoa hồng": r.pctOpen || "", "Danh mục chính": r.cat, "Nổi bật": r.hot,
    "Link TikToday": "https://tiktoday.vn/dashboard/shops/" + r.id, "Chữ gốc thẻ": r.card }));

  // thống kê theo nhóm nguồn
  const labelSet = new Set(); rows.forEach((r) => (groups[r.id] || []).forEach((l) => labelSet.add(l)));
  const grp = [["Tất cả", rows]];
  Array.from(labelSet).forEach((l) => grp.push([l, rows.filter((r) => (groups[r.id] || []).includes(l))]));
  if (labelSet.size >= 2) {
    grp.push(["Chung nhiều nguồn", rows.filter((r) => r.nSrc >= 2)]);
    Array.from(labelSet).forEach((l) => grp.push(["Chỉ riêng " + l, rows.filter((r) => r.nSrc === 1 && (groups[r.id] || [])[0] === l)]));
  }
  const stat = grp.map(([name, rs]) => ({ "Nhóm": name, "Số shop": rs.length,
    "Lượt bán (trung vị)": med(rs.map((r) => r.sold)), "Lượt bán (nhỏ nhất)": mn(rs.map((r) => r.sold)), "Lượt bán (lớn nhất)": mx(rs.map((r) => r.sold)),
    "Đơn giá TB (trung vị)": med(rs.map((r) => r.price)), "Số SP (trung vị)": med(rs.map((r) => r.nprod)), "Đánh giá (trung vị)": med(rs.map((r) => r.rating).filter((x) => x > 0)),
    "Hoa hồng phổ biến % (trung vị)": med(rs.map((r) => r.hhCommon).filter((x) => x > 0)), "KOC 30 ngày (trung vị)": med(rs.map((r) => r.koc30).filter((x) => x > 0)),
    "Video 30 ngày (trung vị)": med(rs.map((r) => r.video30).filter((x) => x > 0)), "% SP mở hoa hồng (trung vị)": med(rs.map((r) => r.pctOpen).filter((x) => x > 0)),
    "Số nhà sáng tạo tổng (trung vị)": med(rs.map((r) => r.creators)) }));
  const bucket = (title, key, spec) => {
    const out = [];
    spec[1].forEach((lab) => { const o = { "Chỉ tiêu": title, "Khoảng": lab }; grp.forEach(([name, rs]) => { o[name] = rs.filter((r) => bucketOf(r[key], spec[0], spec[1]) === lab).length; }); out.push(o); });
    return out;
  };
  const dist = [].concat(bucket("Lượt bán", "sold", B_SOLD), bucket("Đơn giá bình quân", "price", B_PRICE), bucket("Số sản phẩm", "nprod", B_PROD), bucket("Số nhà sáng tạo", "creators", B_KOC), bucket("Số video", "videos", B_VID));

  const keys = []; rows.forEach((r) => Object.keys(r.s).forEach((k) => { if (!keys.includes(k)) keys.push(k); }));
  const raw = rows.map((r) => { const o = { "Mã cửa hàng": r.id }; keys.forEach((k) => { const v = r.s[k]; o[k] = Array.isArray(v) ? v.join(",") : (v == null ? "" : v); }); return o; });

  const wb = XLSX.utils.book_new();
  [["Cửa hàng", sheetShops], ["Thống kê theo nhóm", stat], ["Phân bố theo khoảng", dist], ["Thô - Cửa hàng", raw]].forEach(([n, a]) => {
    XLSX.utils.book_append_sheet(wb, a.length ? XLSX.utils.json_to_sheet(a) : XLSX.utils.aoa_to_sheet([["(không có dòng nào)"]]), n.slice(0, 31));
  });
  return wb;
}
S2("siExport").addEventListener("click", async () => {
  if (!Object.keys(SI_DATA).length) { S2("siStatus").textContent = "Chưa có dữ liệu cửa hàng. Quét trước."; return; }
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  XLSX.writeFile(await buildShopWorkbook(), "Soi cua hang " + d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + ".xlsx");
  S2("siStatus").textContent = "Đã xuất Excel cửa hàng.";
});

loadSI();
