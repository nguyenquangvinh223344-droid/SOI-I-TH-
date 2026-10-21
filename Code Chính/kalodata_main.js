// kalodata_main.js - chạy trong "thế giới chính" của kalodata.com.
// Chỉ làm một việc: ghi MÃ ĐỊNH DANH (mã video, mã sản phẩm, mã cửa hàng) của từng dòng bảng vào thuộc tính
// data-qv-ids trên dòng đó, để kalodata.js (thế giới tách biệt) dựng link. KHÔNG lấy bất kỳ số liệu nào khác
// trong dữ liệu trang (đặc biệt không lấy các cột đang bị che ****).
(function () {
  if (window.__qvKaloMain) return;
  window.__qvKaloMain = true;
  const isId = (v) => /^\d{10,22}$/.test(String(v == null ? "" : v));

  // React giữ HAI bản "fiber" cho mỗi dòng (hiện tại và bản trước). Thuộc tính trên dòng có thể trỏ vào bản CŨ => mã của trang trước.
  // Cách chặn: lấy mã từ cả hai bản, và CHỈ nhận bản có "hạng" (rank) trùng với số hạng đang hiển thị ở ô đầu của dòng.
  function recordFrom(fiber) {
    let f = fiber;
    for (let i = 0; i < 14 && f; i++, f = f.return) {
      const p = f.memoizedProps;
      if (p && p.record && typeof p.record === "object") return p.record;
    }
    return null;
  }
  function recordOf(tr) {
    const fk = Object.keys(tr).find((k) => k.startsWith("__reactFiber"));
    if (!fk) return null;
    const f = tr[fk];
    const shownRank = parseInt(String((tr.querySelector("td") || {}).textContent || "").replace(/\D/g, ""), 10);
    const cands = [recordFrom(f), f && f.alternate ? recordFrom(f.alternate) : null].filter(Boolean);
    if (!cands.length) return null;
    if (isNaN(shownRank)) return cands[0];
    const hit = cands.find((c) => Number(c.rank) === shownRank);
    return hit || null;   // không bản nào khớp hạng đang hiển thị => bỏ trống, KHÔNG đoán mã
  }

  function tagRows() {
    document.querySelectorAll("tr.ant-table-row").forEach((tr) => {
      const rec = recordOf(tr);
      if (!rec) { if (tr.getAttribute("data-qv-ids") !== "{}") tr.setAttribute("data-qv-ids", "{}"); return; }
      const ids = {};
      if ("product_title" in rec) {                    // bảng sản phẩm
        if (isId(rec.id)) ids.id = String(rec.id);
        if (isId(rec.seller_id)) ids.seller_id = String(rec.seller_id);
      } else if ("shop_name" in rec) {                 // bảng cửa hàng
        if (isId(rec.seller_id)) ids.seller_id = String(rec.seller_id);
        if (typeof rec.seller_type === "string") ids.seller_type = rec.seller_type.slice(0, 20);
      } else if ("duration" in rec) {                  // bảng video
        if (isId(rec.id)) ids.id = String(rec.id);
        if (Array.isArray(rec.product_ids)) ids.product_ids = rec.product_ids.filter(isId).map(String).join(",");
      }
      const s = JSON.stringify(ids);
      if (tr.getAttribute("data-qv-ids") !== s) tr.setAttribute("data-qv-ids", s);
    });
  }
  setInterval(tagRows, 700);
  document.addEventListener("qv-tag", tagRows);

  // Chuột phải trên dòng bảng: ghi lại link để menu "Hiện QR" (background.js) vẽ mã QR.
  // Dòng sản phẩm -> link TikTok Shop của sản phẩm; dòng video -> link video TikTok (+ sản phẩm gắn trong video).
  const shopUrl = (id) => "https://www.tiktok.com/shop/vn/pdp/" + id;
  document.addEventListener("contextmenu", (e) => {
    const items = [];
    try {
      const tr = e.target && e.target.closest && e.target.closest("tr.ant-table-row");
      if (tr) {
        let ids = {};
        try { ids = JSON.parse(tr.getAttribute("data-qv-ids") || "{}"); } catch (err) { ids = {}; }
        const cells = Array.from(tr.querySelectorAll("td")).map((td) => String(td.textContent || "").replace(/\s+/g, " ").trim());
        const hm = (document.title.match(/@[\w.]+/) || [])[0] || "";
        if (ids.product_ids !== undefined || (ids.id && cells.length >= 8)) {           // dòng video
          const title = (cells[1] || "").replace(/^\d+\s?[sm]\b\s*/, "").replace(/\bAI\b|\bAD\b|Công cụ video/g, "").replace(/\s+/g, " ").trim().slice(0, 90);
          if (ids.id && hm) items.push({ id: ids.id, title: "Video: " + title, url: "https://www.tiktok.com/" + hm + "/video/" + ids.id });
          (ids.product_ids ? ids.product_ids.split(",") : []).slice(0, 3).forEach((pid) => items.push({ id: pid, title: "Sản phẩm gắn trong video", url: shopUrl(pid) }));
        } else if (ids.id) {                                                              // dòng sản phẩm
          items.push({ id: ids.id, title: (cells[1] || "").slice(0, 90), url: shopUrl(ids.id) });
        }
      }
    } catch (err) { /* bỏ qua */ }
    window.__qvCtx = { ids: items, t: Date.now() };
  }, true);
})();
