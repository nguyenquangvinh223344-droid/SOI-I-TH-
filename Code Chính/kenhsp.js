// kenhsp.js - trang "Soi sản phẩm các kênh": dán kênh -> quét (background làm) -> xuất Excel.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---- tên kênh từ chữ dán vào ---------------------------------------------------------
function extractUsername(line) {
  let s = String(line || "").trim();
  if (!s) return null;
  s = s.replace(/^https?:\/\/(www\.)?(tiktok|datakenh)\.com\//i, "").replace(/^@/, "");
  s = s.split(/[/?#\s]/)[0].replace(/^@/, "");
  return /^[A-Za-z0-9._]{2,40}$/.test(s) ? s : null;
}
function parseChannels() {
  const seen = new Set(), out = [];
  $("ksList").value.split(/[\n,;]+/).forEach((l) => {
    const u = extractUsername(l);
    if (u && !seen.has(u.toLowerCase())) { seen.add(u.toLowerCase()); out.push(u); }
  });
  return out;
}
$("ksList").addEventListener("input", () => { $("ksCount").textContent = parseChannels().length + " kênh"; });

// ---- giao diện sáng/tối --------------------------------------------------------------
async function applyTheme() {
  const { themePreference } = await chrome.storage.local.get("themePreference");
  const light = themePreference === "light";
  document.documentElement.setAttribute("data-theme", light ? "light" : "dark");
  $("btnThemeToggle").textContent = light ? "☀️" : "🌙";
}
$("btnThemeToggle").addEventListener("click", async () => {
  const { themePreference } = await chrome.storage.local.get("themePreference");
  await chrome.storage.local.set({ themePreference: themePreference === "light" ? "dark" : "light" });
  applyTheme();
});

// ---- hiển thị ------------------------------------------------------------------------
let DATA = {};
function fmtTime(t) {
  if (!t) return "";
  const d = new Date(t), p = (n) => String(n).padStart(2, "0");
  return p(d.getDate()) + "/" + p(d.getMonth() + 1) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}
function renderRows() {
  const keys = Object.keys(DATA);
  $("ksEmpty").style.display = keys.length ? "none" : "";
  $("ksRows").innerHTML = keys.map((u) => {
    const d = DATA[u];
    return `<tr><td>@${esc(u)}</td><td>${esc(d.name)}</td><td class="num">${d.products.length} <small>(${d.pagesProducts || 0} trang)</small></td><td class="num">${d.shops.length} <small>(${d.pagesShops || 0} trang)</small></td><td>${fmtTime(d.scannedAt)}</td><td><button class="ks-del" data-u="${esc(u)}" title="Xóa kênh này khỏi dữ liệu">✕</button></td></tr>`;
  }).join("");
  $("ksRows").querySelectorAll(".ks-del").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("Xóa dữ liệu đã quét của @" + b.dataset.u + "?")) return;
    await chrome.runtime.sendMessage({ type: "shop_scan_clear", user: b.dataset.u });
    await load();
  }));
  // các trường đọc được của kênh đầu tiên (để biết cột nào thiếu)
  const first = keys.length ? DATA[keys[0]] : null;
  const f = [];
  if (first && first.products[0]) f.push("Trường đọc được của dòng sản phẩm: " + (Object.keys(first.products[0].raw).join(", ") || "(không đọc được dữ liệu dòng, chỉ có chữ nhìn thấy)"));
  if (first && first.shops[0]) f.push("Trường đọc được của dòng cửa hàng: " + (Object.keys(first.shops[0].raw).join(", ") || "(không đọc được dữ liệu dòng, chỉ có chữ nhìn thấy)"));
  $("ksFields").textContent = f.join("\n");
}
function renderState(st) {
  if (!st || !Object.keys(st).length) {
    $("ksStart").disabled = false; $("ksStop").disabled = true; $("ksBar").style.width = "0%";
    $("ksStatus").textContent = "Sẵn sàng."; $("ksLog").textContent = "—";
    return;
  }
  const run = !!st.running;
  $("ksStart").disabled = run;
  $("ksStop").disabled = !run;
  const pct = st.total ? Math.round(((run ? Math.max(0, (st.index || 1) - 1) : (st.index || 0)) / st.total) * 100) : 0;
  $("ksBar").style.width = (st.done && !st.stopped ? 100 : pct) + "%";
  if (run) $("ksStatus").textContent = `Đang quét kênh ${st.index}/${st.total}: @${st.current || ""} · ${st.note || ""}`;
  else if (st.done) $("ksStatus").textContent = st.stopped ? "Đã dừng." : "Xong. Bấm \"Xuất Excel\" để lấy file.";
  $("ksLog").textContent = (st.log && st.log.length) ? st.log.join("\n") : "—";
}
async function load() {
  const g = await chrome.storage.local.get(["shopScanData", "shopScanState"]);
  DATA = g.shopScanData || {};
  renderRows();
  renderState(g.shopScanState);
}

$("ksStart").addEventListener("click", async () => {
  const list = parseChannels();
  if (!list.length) { $("ksStatus").textContent = "Chưa có kênh nào trong danh sách."; return; }
  const r = await chrome.runtime.sendMessage({ type: "shop_scan_start", channels: list });
  if (!r || !r.ok) $("ksStatus").textContent = (r && r.error) || "Không bắt đầu được.";
});
$("ksStop").addEventListener("click", () => chrome.runtime.sendMessage({ type: "shop_scan_stop" }));
$("ksClear").addEventListener("click", async () => {
  if (!Object.keys(DATA).length) return;
  if (!confirm("Xóa TOÀN BỘ dữ liệu đã quét của các kênh? (Không lấy lại được, phải quét lại.)")) return;
  await chrome.runtime.sendMessage({ type: "shop_scan_clear" });
  await load();
});
chrome.runtime.onMessage.addListener((m) => { if (m && m.type === "shop_progress") { renderState(m.state); chrome.storage.local.get("shopScanData").then((g) => { DATA = g.shopScanData || {}; renderRows(); }); } });

// ---- đọc số liệu từ dòng ---------------------------------------------------------------
const has = (v) => v !== undefined && v !== null && v !== "";
const pick = (raw, keys) => { for (const k of keys) if (has(raw[k])) return raw[k]; return ""; };
const toNum = (v) => { if (typeof v === "number") return v; const n = Number(String(v == null ? "" : v).replace(/[^\d.\-]/g, "")); return isNaN(n) ? 0 : n; };
const normName = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

function mapProduct(ch, r, i) {
  const raw = r.raw || {};
  const id = String(pick(raw, ["id", "product_id", "productId"]) || "");
  let comm = toNum(pick(raw, ["commission_rate", "commission", "commission_percent", "commissionRate"]));
  if (comm > 0 && comm <= 1) comm = Math.round(comm * 1000) / 10;
  return {
    ch, stt: i + 1, id,
    title: String(pick(raw, ["product_title", "title", "name", "product_name"]) || "").trim(),
    pmin: toNum(pick(raw, ["min_real_price", "min_price", "price_min", "unit_price", "price"])),
    pmax: toNum(pick(raw, ["max_real_price", "max_price", "price_max"])),
    rev: toNum(pick(raw, ["revenue", "gmv"])),
    sold: toNum(pick(raw, ["sold_count", "sales", "sold", "total_sold", "units_sold"])),
    comm,
    videos: toNum(pick(raw, ["koc_video_count", "video_count", "videos", "video_num", "videos#"])),
    shop: String(pick(raw, ["shop_name", "shop.name", "seller_name"]) || ""),
    shopId: String(pick(raw, ["shop_id", "seller_id"]) || ""),
    text: r.text || "",
    rawObj: raw,
  };
}
function mapShop(ch, r, i) {
  const raw = r.raw || {};
  const id = String(pick(raw, ["id", "shop_id", "seller_id", "shopId"]) || "");
  const name = String(pick(raw, ["name", "shop_name", "shop.name", "seller_name", "title"]) || "").trim() || String(r.text || "").slice(0, 40);
  return {
    ch, stt: i + 1, id, name,
    cat: String(pick(raw, ["category_name", "category", "main_category", "pri_category_id"]) || ""),
    videos: toNum(pick(raw, ["koc_video_count", "video_count", "videos", "video_num", "videos#"])),
    kocProducts: toNum(pick(raw, ["koc_product_count", "koc_products#"])),
    rev: toNum(pick(raw, ["revenue"])),
    last: String(pick(raw, ["last_time", "latest_time", "last_collab_time", "last_video_time", "updated_at", "last_date"]) || ""),
    products: toNum(pick(raw, ["product_count", "products_count", "product_num"])),
    rating: toNum(pick(raw, ["rating", "shop_rating", "score", "star"])),
    key: id || normName(name),
    text: r.text || "",
    rawObj: raw,
  };
}
const link = (id) => (id ? "https://www.tiktok.com/shop/vn/pdp/" + id : "");

// ---- Excel -------------------------------------------------------------------------------
function buildWorkbook() {
  const chans = Object.keys(DATA);
  const prods = [], shops = [];
  chans.forEach((ch) => {
    DATA[ch].products.forEach((r, i) => prods.push(mapProduct(ch, r, i)));
    DATA[ch].shops.forEach((r, i) => shops.push(mapShop(ch, r, i)));
  });

  // sản phẩm theo mã
  const byProd = {};
  prods.forEach((p) => { if (!p.id) return; (byProd[p.id] = byProd[p.id] || []).push(p); });
  const byShop = {};
  shops.forEach((s) => { if (!s.key) return; (byShop[s.key] = byShop[s.key] || []).push(s); });

  const wsRows = {
    "Sản phẩm": prods.map((p) => ({ "Kênh": "@" + p.ch, "STT": p.stt, "Mã sản phẩm": p.id, "Tên sản phẩm": p.title, "Giá thấp": p.pmin || "", "Giá cao": p.pmax || "", "Lượt bán (cả SP)": p.sold || "", "Hoa hồng %": p.comm || "", "Số video của kênh": p.videos || "", "Doanh thu SP (TikToday)": p.rev || "", "Cửa hàng": p.shop, "Mã cửa hàng": p.shopId, "Số kênh cùng bán": (byProd[p.id] || []).length || "", "Link TikTok Shop": link(p.id), "Dòng gốc": p.text })),
    "SP trùng nhiều kênh": Object.keys(byProd).map((id) => byProd[id]).filter((a) => new Set(a.map((x) => x.ch)).size >= 2).map((a) => {
      const chs = Array.from(new Set(a.map((x) => x.ch)));
      return { "Mã sản phẩm": a[0].id, "Tên sản phẩm": a[0].title, "Số kênh": chs.length, "Các kênh": chs.map((c) => "@" + c).join(", "), "Lượt bán (cả SP)": Math.max.apply(null, a.map((x) => x.sold)) || "", "Tổng video các kênh": a.reduce((s, x) => s + x.videos, 0) || "", "Link TikTok Shop": link(a[0].id) };
    }).sort((x, y) => y["Số kênh"] - x["Số kênh"]),
    "Cửa hàng": shops.map((s) => ({ "Kênh": "@" + s.ch, "STT": s.stt, "Mã cửa hàng": s.id, "Tên cửa hàng": s.name, "Ngành": s.cat, "Số video của kênh": s.videos || "", "Số SP kênh bán của shop": s.kocProducts || "", "Tổng SP của shop": s.products || "", "Doanh thu shop (TikToday)": s.rev || "", "Đánh giá": s.rating || "", "Số kênh cùng hợp tác": (byShop[s.key] || []).length || "", "Dòng gốc": s.text })),
    "Shop trùng nhiều kênh": Object.keys(byShop).map((k) => byShop[k]).filter((a) => new Set(a.map((x) => x.ch)).size >= 2).map((a) => {
      const chs = Array.from(new Set(a.map((x) => x.ch)));
      return { "Cửa hàng": a[0].name, "Mã cửa hàng": a[0].id, "Ngành": a[0].cat, "Số kênh": chs.length, "Các kênh": chs.map((c) => "@" + c).join(", "), "Tổng video": a.reduce((s, x) => s + x.videos, 0) || "" };
    }).sort((x, y) => y["Số kênh"] - x["Số kênh"]),
  };

  // tổng quan từng kênh + ma trận trùng
  const idsOf = {}, shopsOf = {};
  chans.forEach((c) => { idsOf[c] = new Set(prods.filter((p) => p.ch === c && p.id).map((p) => p.id)); shopsOf[c] = new Set(shops.filter((s) => s.ch === c && s.key).map((s) => s.key)); });
  const inter = (a, b) => { let n = 0; a.forEach((x) => { if (b.has(x)) n++; }); return n; };
  wsRows["Tổng quan kênh"] = chans.map((c) => {
    const mine = prods.filter((p) => p.ch === c);
    const priced = mine.filter((p) => p.pmin > 0);
    const commd = mine.filter((p) => p.comm > 0);
    let sharedP = 0;
    idsOf[c].forEach((id) => { if (chans.some((o) => o !== c && idsOf[o].has(id))) sharedP++; });
    let sharedS = 0;
    shopsOf[c].forEach((k) => { if (chans.some((o) => o !== c && shopsOf[o].has(k))) sharedS++; });
    let best = "", bestN = 0;
    chans.forEach((o) => { if (o === c) return; const n = inter(idsOf[c], idsOf[o]); if (n > bestN) { bestN = n; best = "@" + o + " (" + n + " SP)"; } });
    return { "Kênh": "@" + c, "Tên": DATA[c].name, "Số sản phẩm": mine.length, "Số cửa hàng": shopsOf[c].size, "Giá thấp TB": priced.length ? Math.round(priced.reduce((s, p) => s + p.pmin, 0) / priced.length) : "", "Hoa hồng TB %": commd.length ? Math.round(commd.reduce((s, p) => s + p.comm, 0) / commd.length * 10) / 10 : "", "Tổng lượt bán các SP (cả SP)": mine.reduce((s, p) => s + p.sold, 0) || "", "Tổng video của kênh": mine.reduce((s, p) => s + p.videos, 0) || "", "SP trùng với kênh khác": sharedP, "Shop trùng với kênh khác": sharedS, "Kênh trùng nhiều nhất": best, "Quét lúc": fmtTime(DATA[c].scannedAt) };
  });
  wsRows["Ma trận SP trùng"] = chans.map((c) => {
    const o = { "Kênh": "@" + c };
    chans.forEach((d) => { o["@" + d] = c === d ? idsOf[c].size : inter(idsOf[c], idsOf[d]); });
    return o;
  });

  // dữ liệu thô: gộp mọi trường đọc được, để không mất cột nào
  const rawSheet = (arr, label) => {
    const keys = [];
    arr.forEach((p) => Object.keys(p.rawObj).forEach((k) => { if (!keys.includes(k)) keys.push(k); }));
    return arr.map((p) => { const o = { "Kênh": "@" + p.ch }; keys.forEach((k) => { o[k] = has(p.rawObj[k]) ? p.rawObj[k] : ""; }); o["Dòng gốc"] = p.text; return o; });
  };
  wsRows["Thô - Sản phẩm"] = rawSheet(prods, "sp");
  wsRows["Thô - Cửa hàng"] = rawSheet(shops, "shop");

  const wb = XLSX.utils.book_new();
  Object.keys(wsRows).forEach((name) => {
    const rows = wsRows[name];
    const ws = rows.length ? XLSX.utils.json_to_sheet(rows) : XLSX.utils.aoa_to_sheet([["(không có dòng nào)"]]);
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  });
  return wb;
}

$("ksExport").addEventListener("click", () => {
  if (!Object.keys(DATA).length) { $("ksStatus").textContent = "Chưa có dữ liệu để xuất. Quét kênh trước."; return; }
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  const wb = buildWorkbook();
  XLSX.writeFile(wb, `Soi san pham cac kenh ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.xlsx`);
  $("ksStatus").textContent = "Đã xuất Excel.";
});

applyTheme();
load();
