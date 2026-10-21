// ============================================================================
// tiktoday_qr.js - chạy trong "thế giới chính" của trang tiktoday.vn.
// Khi sếp bấm chuột phải, ghi lại các MÃ SẢN PHẨM của dòng/ô đang bấm (đọc từ dữ liệu React của
// trang, giống cách nút "Lấy giỏ hàng" đang đọc). Menu chuột phải "Hiện QR TikTok Shop" (background.js)
// sẽ lấy kết quả này để hiện mã QR. Mã sản phẩm TikToday = dãy số trong tiktok.com/shop/vn/pdp/<mã>.
// ============================================================================
(function () {
  if (window.__qvQrInit) return;
  window.__qvQrInit = true;
  const isId = (v) => /^\d{10,22}$/.test(String(v == null ? "" : v));
  const short = (s) => String(s || "").replace(/\s+/g, " ").trim().slice(0, 90);

  function fiberOf(el) {
    for (let n = el; n; n = n.parentElement) {
      const k = Object.keys(n).find((x) => x.startsWith("__reactFiber"));
      if (k) return n[k];
    }
    return null;
  }

  function resolve(el) {
    const found = [];
    const seen = new Set();
    const add = (id, title) => {
      id = String(id);
      if (isId(id) && !seen.has(id)) { seen.add(id); found.push({ id, title: short(title) }); }
    };

    const a = el.closest && el.closest('a[href*="/products/"]');
    if (a) {
      const m = (a.getAttribute("href") || "").match(/products\/(\d{10,22})/);
      if (m) add(m[1], a.innerText);
    }

    let f = found.length ? null : fiberOf(el);
    for (let i = 0; i < 30 && f && !found.length; i++, f = f.return) {
      const p = f.memoizedProps;
      if (!p || typeof p !== "object") continue;
      const r = p.row;
      if (r && typeof r === "object") {
        if (Array.isArray(r.products) && r.products.length) {
          r.products.forEach((x) => add(x && x.id, x && x.product_title));
          break;
        }
        if (isId(r.id) && (r.product_title !== undefined || r.sold_count !== undefined || r.unit_price !== undefined)) {
          add(r.id, r.product_title);
          break;
        }
      }
      if (p.product && typeof p.product === "object" && isId(p.product.id)) {
        add(p.product.id, p.product.product_title || p.product.title);
        break;
      }
    }
    return found;
  }

  document.addEventListener("contextmenu", (e) => {
    let ids = [];
    try { ids = resolve(e.target); } catch (err) { ids = []; }
    window.__qvCtx = { ids, t: Date.now() };
  }, true);
})();
