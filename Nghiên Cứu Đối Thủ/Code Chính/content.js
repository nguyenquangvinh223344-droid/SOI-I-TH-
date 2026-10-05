// ============================================================================
// content.js - chạy sẵn trên mọi trang tiktok.com (khai báo trong manifest).
// Chờ background.js gửi lệnh "scrape_page" rồi đọc lưới video ngay trong
// DOM của trang, trả kết quả về - không gọi API nội bộ nào của TikTok (API
// đó yêu cầu chữ ký ẩn, gọi từ ngoài bị chặn - đã test thật, xem HUONG_DAN.md).
// ============================================================================

function parseViews(text) {
  if (!text) return 0;
  text = text.trim();
  const mult = text.includes("M") ? 1e6 : text.includes("K") ? 1e3 : 1;
  const num = parseFloat(text.replace(/[KM]/gi, ""));
  return Math.round((isNaN(num) ? 0 : num) * mult);
}

function extractItems() {
  const nodes = document.querySelectorAll('[data-e2e="user-post-item"]');
  return Array.from(nodes)
    .map((node) => {
      const a = node.querySelector("a");
      const img = node.querySelector("img");
      const viewEl = node.querySelector("strong");
      const href = a ? a.href : "";
      const m = href.match(/\/video\/(\d+)/);
      const id = m ? m[1] : null;
      if (!id) return null;
      // ID video TikTok la snowflake - timestamp Unix (giay) nam o 32 bit cao.
      const tsSeconds = Number(BigInt(id) >> 32n);
      return {
        id,
        pageUrl: href,
        createTime: tsSeconds * 1000,
        coverUrl: img ? img.src : "",
        desc: img ? img.alt || "" : "",
        playCount: parseViews(viewEl ? viewEl.textContent : ""),
      };
    })
    .filter(Boolean);
}

function hasCaptcha() {
  const bodyText = document.body.innerText || "";
  return (
    !!document.querySelector('[id*="captcha"]') ||
    bodyText.includes("Verify to continue") ||
    bodyText.includes("Xác minh để tiếp tục") ||
    bodyText.includes("Please verify")
  );
}

function hasErrorText() {
  return (document.body.innerText || "").includes("Something went wrong");
}

async function waitForItems(maxSec) {
  let waited = 0;
  while (document.querySelectorAll('[data-e2e="user-post-item"]').length === 0 && waited < maxSec) {
    if (hasCaptcha()) return; // dung cho luon neu dinh captcha, khong co y nghia cho tiep
    await new Promise((r) => setTimeout(r, 1000));
    waited += 1;
  }
}

async function scrapeCurrentPage(maxScrollRounds) {
  await waitForItems(15); // theo mo ta: cho ~15 giay de TikTok render du luot view

  if (hasCaptcha()) {
    return { items: [], hadErrorText: false, hasCaptcha: true };
  }

  let lastCount = -1;
  for (let i = 0; i < maxScrollRounds; i++) {
    const current = document.querySelectorAll('[data-e2e="user-post-item"]').length;
    if (current === lastCount) break;
    lastCount = current;
    // Cuon kieu nguoi that hon: khong nhay thang xuong day, ma cuon tung
    // doan ngau nhien + nghi ngoi thoi gian ngau nhien giua moi lan - tranh
    // kieu "may moc" (dung 1 khoang co dinh lap lai) de nhin tu nhien hon.
    const scrollAmount = window.innerHeight * (0.6 + Math.random() * 0.5);
    window.scrollBy({ top: scrollAmount, behavior: "smooth" });
    await new Promise((r) => setTimeout(r, 1200 + Math.random() * 1800));
  }

  const avatarImg = document.querySelector('[data-e2e="user-avatar"] img');
  const followersEl = document.querySelector('[data-e2e="followers-count"]');

  return {
    items: extractItems(),
    avatarUrl: avatarImg ? avatarImg.src : "",
    followerCount: followersEl ? parseViews(followersEl.textContent) : null,
    hadErrorText: hasErrorText(),
    hasCaptcha: hasCaptcha(),
  };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "scrape_page") {
    scrapeCurrentPage(msg.maxScrollRounds || 6).then(sendResponse);
    return true; // giu channel mo cho response bat dong bo
  }
});
