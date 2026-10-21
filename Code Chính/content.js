// ============================================================================
// content.js - chạy sẵn trên mọi trang tiktok.com (khai báo trong manifest).
// Chờ background.js gửi lệnh "scrape_page" rồi đọc lưới video ngay trong
// DOM của trang, trả kết quả về - không gọi API nội bộ nào của TikTok (API
// đó yêu cầu chữ ký ẩn, gọi từ ngoài bị chặn - đã test thật, xem HUONG_DAN.md).
//
// CUỘN THÍCH ỨNG THEO NGÀY (sửa 2026-10-14): trước đây cuộn cố định 6 lần cho
// mọi kênh nên chỉ đọc được vài chục video gần nhất. Giờ cuộn tới khi đã
// thấy video cũ hơn mốc "từ ngày" (kênh đăng dày thì tự cuộn nhiều hơn), hoặc
// tới khi kênh thật sự hết video, chứ không theo số lần cố định.
// ============================================================================

// Số view TikTok hiện dạng rút gọn: "1,2K" / "1.2K" / "12,6N" / "1,2M" / "850".
function parseViews(text) {
  if (!text) return 0;
  const s = String(text).trim().replace(/\s+/g, "");
  const m = s.match(/^([\d.,]+)(K|M|B|N|TR)?$/i);
  if (!m) {
    // Dang la: giu cach doc cu cho chac.
    const mult = s.includes("M") ? 1e6 : s.includes("K") ? 1e3 : 1;
    const num = parseFloat(s.replace(/[KM]/gi, "").replace(",", "."));
    return Math.round((isNaN(num) ? 0 : num) * mult);
  }
  const suf = (m[2] || "").toUpperCase();
  let n;
  if (suf) {
    n = parseFloat(m[1].replace(",", "."));
    n *= suf === "K" || suf === "N" ? 1e3 : suf === "M" || suf === "TR" ? 1e6 : 1e9;
  } else if (/^\d{1,3}([.,]\d{3})+$/.test(m[1])) {
    n = parseInt(m[1].replace(/[.,]/g, ""), 10); // "1.234" = 1234 (dau cham ngan cach hang nghin)
  } else {
    n = parseFloat(m[1].replace(",", "."));
  }
  return Math.round(isNaN(n) ? 0 : n);
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

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
const countItems = () => document.querySelectorAll('[data-e2e="user-post-item"]').length;

// Doi toi khi so video HIEN RA tang them (toi da timeoutMs) - khong ket luan "het video"
// chi vi TikTok tai cham 1 nhip.
async function waitGrow(before, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (countItems() > before) return true;
    if (hasCaptcha()) return false;
    await sleepMs(400);
  }
  return countItems() > before;
}

// TikTok chi tai them video khi tab THAT SU dang hien (IntersectionObserver khong chay o tab an).
// Neu nguoi dung chuyen sang tab/cua so khac giua luc quet, nho background keo tab nay len lai;
// khong thi se tuong nham la "het video" (da bat duoc loi nay khi test that).
const isVisible = () => document.visibilityState === "visible";
async function ensureVisible(maxMs) {
  const t0 = Date.now();
  while (!isVisible() && Date.now() - t0 < maxMs) {
    try { chrome.runtime.sendMessage({ type: "need_visible" }); } catch (e) { /* khong sao */ }
    await sleepMs(1500);
  }
  return isVisible();
}

// Doi trang LOAD XONG TU TE roi moi cuon: sau khi co video dau tien, TikTok con "hydrate" (dung lai trang)
// vai giay; neu cuon luc do, trang bi dua nguoc ve dau (da gap khi test that). Doi tới khi so video
// khong doi trong ~2.5 giay, trang da load xong, co so follower, roi moi bat dau.
async function waitPageStable(maxMs) {
  const t0 = Date.now();
  let lastCount = -1;
  let stableSince = Date.now();
  while (Date.now() - t0 < maxMs) {
    if (hasCaptcha()) return;
    const c = countItems();
    if (c !== lastCount) { lastCount = c; stableSince = Date.now(); }
    const hasFollowers = !!document.querySelector('[data-e2e="followers-count"]');
    const ready = document.readyState === "complete" && c > 0 && (hasFollowers || Date.now() - t0 > 8000);
    if (ready && Date.now() - stableSince >= 3500 && Date.now() - t0 >= 6000) return;
    await sleepMs(300);
  }
}

async function scrapeCurrentPage(opts) {
  opts = opts || {};
  const fromMs = Number(opts.fromMs) || 0;
  const hardCapRounds = Number(opts.maxRounds) || 600; // tran an toan, khong phai muc tieu
  const hardCapMs = Number(opts.maxMs) || 20 * 60 * 1000; // toi da 20 phut / kenh

  await waitForItems(15); // cho co video dau tien
  await waitPageStable(14000); // roi cho trang load xong han (het "hydrate") moi cuon

  if (hasCaptcha()) {
    return { items: [], hadErrorText: false, hasCaptcha: true };
  }

  // Gom video qua moi vong (theo ID): neu trang bi dung lai giua chung va mat bot video, ket qua van du.
  const seen = new Map();
  const collect = () => {
    const cur = extractItems();
    for (const it of cur) {
      const old = seen.get(it.id);
      if (!old || it.playCount > old.playCount) seen.set(it.id, it);
    }
    return cur;
  };

  const t0 = Date.now();
  let rounds = 0;
  let stall = 0; // so lan lien tiep cuon ma KHONG co video moi
  let resets = 0; // so lan trang bi dua nguoc ve dau
  let reachedFrom = false;
  let endOfChannel = false;
  let capped = false;
  let hiddenAbort = false;
  let lastBeat = 0;
  let lastY = 0;
  let lastCount = countItems();

  while (true) {
    const items = collect();

    // Trang vua bi dua nguoc ve dau (hoac danh sach bi dung lai, mat bot video)? Doi load xong roi nhay xuong day.
    const y = window.scrollY || 0;
    const bigDrop = lastY > window.innerHeight * 2.5 && y < lastY - window.innerHeight * 1.5;
    const listShrunk = lastCount > 12 && items.length < lastCount * 0.7;
    if (bigDrop || listShrunk) {
      resets += 1;
      await waitPageStable(14000);
      collect();
      window.scrollTo(0, document.documentElement.scrollHeight);
      await sleepMs(800);
      lastY = window.scrollY || 0;
      lastCount = countItems();
      stall = 0;
      if (resets > 40) { capped = true; break; }
      continue;
    }
    lastCount = items.length;

    // Da cuon du sau chua? Xet 5 video CUOI (khong phai dau trang, vi video ghim nam dau
    // va cu hon): neu ca 5 deu cu hon moc "tu ngay" thi cac video tu moc do tro di da tai het.
    if (fromMs > 0 && items.length >= 8) {
      const tail = items.slice(-5);
      if (tail.every((x) => x.createTime < fromMs)) {
        reachedFrom = true;
        break;
      }
    }
    if (rounds >= hardCapRounds || Date.now() - t0 > hardCapMs) {
      capped = true;
      break;
    }
    if (hasCaptcha()) break;
    if (!isVisible()) {
      const okVis = await ensureVisible(90000);
      if (!okVis) { hiddenAbort = true; break; }
    }

    // Bao tien do ve background (dong thoi giu service worker khong bi tat giua chung).
    if (Date.now() - lastBeat > 2500) {
      lastBeat = Date.now();
      const oldest = items.length ? Math.min(...items.slice(-5).map((x) => x.createTime)) : 0;
      try {
        chrome.runtime.sendMessage({ type: "scan_heartbeat", rounds, videos: seen.size, oldestMs: oldest });
      } catch (e) { /* khong sao */ }
    }

    const before = countItems();
    rounds += 1;
    if (stall === 0) {
      // Cuon kieu nguoi that: ~1 man hinh, khong nhay thang xuong day.
      window.scrollBy({ top: window.innerHeight * (0.8 + Math.random() * 0.4), behavior: "smooth" });
      await sleepMs(700 + Math.random() * 500);
    } else {
      // Da co lan khong thay video moi: xuong tan day roi "lac" nhe de kich TikTok tai tiep.
      window.scrollTo(0, document.documentElement.scrollHeight);
      await sleepMs(500);
      window.scrollBy({ top: -300, behavior: "auto" });
      await sleepMs(500);
      window.scrollTo(0, document.documentElement.scrollHeight);
    }
    lastY = window.scrollY || 0;
    const grew = await waitGrow(before, stall === 0 ? 9000 : 6000);
    if (grew) {
      stall = 0;
      await sleepMs(400 + Math.random() * 700); // nghi ngau nhien cho tu nhien hon
    } else if (!isVisible()) {
      // Tab bi an giua chung: khong tinh la "het video", vong sau se doi tab hien lai roi cuon tiep.
      continue;
    } else if ((window.scrollY || 0) < lastY - window.innerHeight * 1.5) {
      // Trang vua bi dua nguoc len trong luc doi: de vong sau xu ly (khong tinh la het video).
      continue;
    } else {
      stall += 1;
      if (stall >= 4) {
        endOfChannel = true; // 4 lan lien tiep (co lac) van khong them video nao -> het that
        break;
      }
    }
  }

  collect();
  const finalItems = Array.from(seen.values());
  const times = finalItems.map((x) => x.createTime).filter((t) => t > 0);
  const avatarImg = document.querySelector('[data-e2e="user-avatar"] img');
  const followersEl = document.querySelector('[data-e2e="followers-count"]');

  return {
    items: finalItems,
    avatarUrl: avatarImg ? avatarImg.src : "",
    followerCount: followersEl ? parseViews(followersEl.textContent) : null,
    hadErrorText: hasErrorText(),
    hasCaptcha: hasCaptcha(),
    rounds,
    resets,
    reachedFrom,
    endOfChannel,
    capped,
    hiddenAbort,
    oldestMs: times.length ? Math.min(...times) : 0,
    newestMs: times.length ? Math.max(...times) : 0,
  };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "scrape_page") {
    scrapeCurrentPage({ fromMs: msg.fromMs, maxRounds: msg.maxRounds, maxMs: msg.maxMs }).then(sendResponse);
    return true; // giu channel mo cho response bat dong bo
  }
});
