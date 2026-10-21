// ============================================================================
// Quangg Ving Scanner Pro - background.js
// Toàn bộ logic quét nằm ở đây (service worker) - popup chỉ gửi lệnh +
// hiển thị tiến độ, KHÔNG tự quét, vì popup đóng là code trong nó dừng theo.
//
// Cách lấy dữ liệu (đã test thật trên TikTok, xem HUONG_DAN.md):
// KHÔNG gọi API nội bộ item_list của TikTok (API đó cần "chữ ký" ẩn do
// chính JS TikTok tự sinh, gọi từ ngoài bị chặn trả về rỗng dù có đăng
// nhập). Thay vào đó: mở tab tới trang profile, nhờ content.js (đã khai
// báo chạy sẵn trên tiktok.com) đọc thẳng dữ liệu hiển thị trên trang + tự
// giải mã ngày đăng từ ID video (snowflake, xem content.js).
// ============================================================================

// Gioi han rong (khong phai 4) - truoc day gioi han 4 lam mat lich su cu
// neu quet nhieu lan/ngay, khong con biet video "bung no" that qua nhieu
// ngay hay khong. Chi gioi han rat rong de chan truong hop cuc doan.
const MAX_HISTORY = 500;
// Tran an toan cho so lan cuon / kenh (KHONG phai muc tieu): content.js cuon toi khi qua moc "tu ngay"
// hoac het video that, chi dung vi tran nay trong truong hop cuc doan.
const HARD_CAP_ROUNDS = 600;

importScripts("shopscan.js", "shopinfo.js"); // Soi sản phẩm + cửa hàng hợp tác của nhiều kênh (trang kenhsp.html)

let stopRequested = false;
// Hai chế độ quét, DỮ LIỆU TÁCH RIÊNG: "rival" (soi đối thủ, khóa cũ) và "dance" (soi kênh nhảy, khóa có đuôi "Dance").
let SCAN_SFX = "";
let SCAN_BUSY = false;
const sfxOf = (mode) => (mode === "dance" ? "Dance" : "");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fmtDate(ms) {
  const d = new Date(ms);
  return String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear();
}

function randomDelay(minSec, maxSec) {
  const ms = (minSec + Math.random() * (maxSec - minSec)) * 1000;
  return sleep(ms);
}

function extractUsername(line) {
  let s = line.trim();
  if (!s) return null;
  s = s.replace(/^https?:\/\/(www\.)?tiktok\.com\//i, "");
  s = s.replace(/^@/, "");
  s = s.split(/[/?]/)[0];
  return s || null;
}

async function updateScanState(patch) {
  const key = "scanState" + SCAN_SFX;
  const got = await chrome.storage.local.get(key);
  const next = Object.assign({}, got[key] || {}, patch);
  await chrome.storage.local.set({ [key]: next });
  chrome.runtime.sendMessage({ type: "scan_progress", mode: SCAN_SFX ? "dance" : "rival", state: next }).catch(() => {
    // Khong co popup nao dang mo de nhan - khong sao.
  });
  rivalHook(next).catch(() => {});
}

// ---------------------------------------------------------------------------
// 1 TAB DUY NHẤT dùng chung cho cả phiên quét (tạo 1 lần, dùng lại cho mọi
// kênh bằng cách đổi URL, đóng lại khi xong hẳn) - KHÔNG mở/đóng tab liên
// tục mỗi kênh như bản trước. Có 2 lý do:
// 1. Mở/đóng hàng loạt tab trông "máy móc" hơn, dễ bị để ý là bot.
// 2. QUAN TRỌNG HƠN: Chrome "đóng băng" bớt việc render của tab nền (không
//    active) để tiết kiệm tài nguyên - TikTok dùng cơ chế cuộn-mới-tải (lazy
//    load) cần tab thật sự hiển thị (active) mới chạy đúng. Tab nền đôi khi
//    load thiếu/sai, đã xác nhận qua test. Nên tab dùng để quét phải
//    active:true - nghĩa là nó SẼ chiếm màn hình lúc quét, không thể quét
//    hoàn toàn ẩn trong nền được (đánh đổi cần thiết để chạy đúng).
// ---------------------------------------------------------------------------
function waitForTabComplete(tabId) {
  return new Promise((resolve) => {
    function listener(id, info) {
      if (id === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function sendScrapeMessage(tabId, maxAttempts, fromMs) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, {
        type: "scrape_page",
        fromMs,
        maxRounds: HARD_CAP_ROUNDS,
      });
      if (res) return res;
    } catch (e) {
      // content script chua san sang - thu lai
    }
    await sleep(500);
  }
  throw new Error("Không liên lạc được với trang TikTok (content script chưa sẵn sàng).");
}

async function openScanTab() {
  const tab = await chrome.tabs.create({ url: "about:blank", active: true });
  return tab.id;
}

async function gotoChannel(tabId, username) {
  await chrome.tabs.update(tabId, { url: `https://www.tiktok.com/@${encodeURIComponent(username)}` });
  await waitForTabComplete(tabId);
  await randomDelay(2.5, 4); // cho trang ổn định hẳn rồi mới thao tác
}

// TikTok thỉnh thoảng tự lỗi "Something went wrong" ngay trên trang (lỗi
// phía TikTok) - F5 lại là hết, nên thử reload tối đa 2 lần nếu gặp.
async function scrapeChannelWithRetry(tabId, fromMs) {
  let res = await sendScrapeMessage(tabId, 20, fromMs); // cho content script san sang, toi da 10s
  let retry = 0;
  while (res.items.length === 0 && res.hadErrorText && !res.hasCaptcha && retry < 2) {
    await chrome.tabs.reload(tabId);
    await waitForTabComplete(tabId);
    res = await sendScrapeMessage(tabId, 20, fromMs);
    retry += 1;
  }
  return res;
}

// ---------------------------------------------------------------------------
// Lưu/merge vào chrome.storage.local - moi clip khoa theo videoId, history
// toi da MAX_HISTORY moc {ts, views}, moc cu nhat bi bo khi vuot qua.
// ---------------------------------------------------------------------------
function mapScrapedItem(item, username) {
  return {
    id: item.id,
    channel: username,
    desc: item.desc || "",
    createTime: item.createTime,
    createDate: new Date(item.createTime).toISOString(),
    coverUrl: item.coverUrl || "",
    pageUrl: item.pageUrl,
    stats: { diggCount: null, commentCount: null, shareCount: null },
  };
}

async function saveOrMergeVideo(mapped, views) {
  const vkey = "videos" + SCAN_SFX;
  const got = await chrome.storage.local.get(vkey);
  const store = got[vkey] || {};
  const now = Date.now();
  const existing = store[mapped.id];

  if (existing) {
    existing.desc = mapped.desc;
    existing.coverUrl = mapped.coverUrl || existing.coverUrl;
    existing.history = existing.history || [];
    existing.history.push({ ts: now, views });
    // KHONG xoa bot lich su cu (truoc day gioi han 4 moc lam mat het du lieu
    // neu quet nhieu lan/ngay, khong con biet video tang "bung no" that su
    // qua nhieu ngay hay khong). Gioi han rat rong (MAX_HISTORY) chi de
    // chan truong hop cuc doan (vd auto-quet lau nam), khong anh huong dung.
    if (existing.history.length > MAX_HISTORY) {
      existing.history = existing.history.slice(existing.history.length - MAX_HISTORY);
    }
    store[mapped.id] = existing;
  } else {
    mapped.history = [{ ts: now, views }];
    store[mapped.id] = mapped;
  }

  await chrome.storage.local.set({ [vkey]: store });
}

// ---------------------------------------------------------------------------
// Vòng lặp quét chính
// ---------------------------------------------------------------------------
async function runScan(args) {
  if (SCAN_BUSY) throw new Error("busy");
  SCAN_BUSY = true;
  try { await runScanCore(args); } finally { SCAN_BUSY = false; }
}

async function runScanCore({ profiles, fromDate, toDate, threshold, mode }) {
  SCAN_SFX = sfxOf(mode);
  stopRequested = false;
  const fromMs = fromDate ? new Date(fromDate + "T00:00:00").getTime() : 0;
  const toMs = toDate ? new Date(toDate + "T23:59:59").getTime() : Date.now();

  let videosRead = 0;
  let clipsMatched = 0;
  let errorCount = 0;
  let zeroResultCount = 0;
  let captchaHit = false;
  let capCount = 0;
  const coverageLines = [];
  const cartChannels = [];

  await updateScanState({
    running: true,
    total: profiles.length,
    currentIndex: 0,
    currentChannel: "",
    videosRead: 0,
    clipsMatched: 0,
    errorCount: 0,
    error: null,
    needCaptcha: false,
    done: false,
    channelNote: "",
    coverage: [],
  });

  const tabId = await openScanTab();

  try {
    for (let i = 0; i < profiles.length; i++) {
      if (stopRequested) break;
      const username = profiles[i];

      await updateScanState({ currentIndex: i + 1, currentChannel: username });

      try {
        await gotoChannel(tabId, username);
        const res = await scrapeChannelWithRetry(tabId, fromMs);

        if (res.hasCaptcha) {
          captchaHit = true;
          await updateScanState({ needCaptcha: true, running: false, done: true });
          return; // dung han phien quet - CO Y KHONG dong tab, de nguoi dung tu giai captcha ngay trong tab do
        }

        if (res.avatarUrl || res.followerCount != null) {
          const { channelAvatars, channelFollowers } = await chrome.storage.local.get(["channelAvatars", "channelFollowers"]);
          const avatars = channelAvatars || {};
          const followers = channelFollowers || {};
          if (res.avatarUrl) avatars[username] = res.avatarUrl;
          if (res.followerCount != null) followers[username] = res.followerCount;
          await chrome.storage.local.set({ channelAvatars: avatars, channelFollowers: followers });
        }

        if (res.items.length > 0) cartChannels.push(username);
        if (res.items.length === 0) {
          errorCount += 1;
          zeroResultCount += 1;
          await updateScanState({
            errorCount,
            error: `Kênh @${username}: không đọc được video (riêng tư, không có video, hoặc sai tên).`,
          });
        }

        // Bao cao do phu: kenh nay da cuon toi dau, co du khong (de sep tu kiem chung, khong phai doan).
        if (res.items.length > 0 && res.rounds != null) {
          let note = `@${username}: đọc ${res.items.length} video` + (res.oldestMs ? `, cũ nhất ${fmtDate(res.oldestMs)}` : "") + ` (cuộn ${res.rounds} lần${res.resets ? `, trang bị dựng lại ${res.resets} lần và đã tự xử lý` : ""})`;
          if (res.reachedFrom) note += " ✔ đã cuộn quá mốc ngày";
          else if (res.endOfChannel) note += " ✔ hết video của kênh";
          else if (res.hiddenAbort) { note += " ⚠ tab bị ẩn quá lâu nên dừng, có thể còn thiếu"; capCount += 1; }
          else if (res.capped) { note += " ⚠ chạm giới hạn cuộn, có thể còn thiếu"; capCount += 1; }
          coverageLines.push(note);
          await updateScanState({ channelNote: "", coverage: coverageLines.slice(-80) });
        }

        for (const item of res.items) {
          videosRead += 1;
          if (item.createTime >= fromMs && item.createTime <= toMs && item.playCount >= threshold) {
            const mapped = mapScrapedItem(item, username);
            await saveOrMergeVideo(mapped, item.playCount);
            clipsMatched += 1;
          }
        }

        await updateScanState({ videosRead, clipsMatched });
      } catch (err) {
        errorCount += 1;
        await updateScanState({ errorCount, error: `Lỗi ở kênh @${username}: ${err.message}` });
        // Khong dung ca phien vi 1 kenh loi - bo qua, qua kenh tiep theo.
      }

      if (i < profiles.length - 1 && !stopRequested) {
        await randomDelay(4, 9); // delay 4-9s giua cac kenh, ngau nhien de ne bi phat hien la bot
      }
    }
  } finally {
    if (!captchaHit) chrome.tabs.remove(tabId).catch(() => {});
  }

  // Giỏ hàng từ TikToday (tự động, theo mốc ngày) - chỉ khi quét TikTok chạy trọn vẹn.
  const cartOn = !!(await chrome.storage.local.get("cartScanOn")).cartScanOn; // nút gạt trong popup (mặc định tắt)
  if (!stopRequested && !captchaHit && cartChannels.length && !SCAN_SFX && cartOn) {
    const cl = await autoCartForChannels(cartChannels, fromMs, (n) => updateScanState({ channelNote: n }));
    cl.forEach((l) => coverageLines.push(l));
    await updateScanState({ channelNote: "", coverage: coverageLines.slice(-120) });
  }

  let finalNote = null;
  let healthWarning = false;
  // Qua nua so kenh cung luc ra 0 ket qua trong 1 lan quet thuc (toi thieu 2
  // kenh de tranh bao dong gia khi chi quet 1 kenh) -> nhieu kha nang TikTok
  // da doi giao dien, khong phai do tung kenh rieng le bi loi.
  if (!stopRequested && profiles.length >= 2 && zeroResultCount / profiles.length > 0.5) {
    healthWarning = true;
    finalNote = "⚠️ Nhiều kênh cùng lúc không đọc được - TikTok có thể đã đổi giao diện, cần nhờ Claude kiểm tra lại code.";
  } else if (!stopRequested && videosRead > 0 && clipsMatched === 0) {
    finalNote = `Đã đọc ${videosRead} video nhưng KHÔNG có video nào đạt ngưỡng view/khoảng ngày đã chọn - không phải lỗi, thử nới ngưỡng view thấp hơn hoặc mở rộng khoảng ngày.`;
  }

  if (capCount > 0 && !stopRequested) {
    const capNote = `⚠ ${capCount} kênh chạm giới hạn cuộn (có thể còn thiếu video cũ), xem chi tiết ở mục "Độ phủ từng kênh".`;
    finalNote = finalNote ? finalNote + " " + capNote : capNote;
  }

  const patch = { running: false, done: true, healthWarning, channelNote: "" };
  if (finalNote) patch.error = finalNote;
  await updateScanState(patch);

  if (!stopRequested) backupData().catch(() => {});
}

// ---------------------------------------------------------------------------
// Sao lưu: 1 file .json DUY NHẤT, luôn ghi đè lên chính nó (khong tich tu
// nhieu ban giong nhau) - tu dong chay xong moi lan quet that, cong them nut
// "Sao luu ngay" trong Dashboard de bam tay bat cu luc nao.
// ---------------------------------------------------------------------------
async function backupData() {
  const data = await chrome.storage.local.get(["videos", "videosDance", "videosTrash", "channelAvatars", "channelFollowers"]);
  const payload = {
    exportedAt: new Date().toISOString(),
    videos: data.videos || {},
    videosDance: data.videosDance || {},
    videosTrash: data.videosTrash || {},
    channelAvatars: data.channelAvatars || {},
    channelFollowers: data.channelFollowers || {},
  };
  // Ưu tiên gửi sang bảng điều khiển: ghi đè 1 file trong "Nghiên Cứu Đối Thủ\\DỮ LIỆU MỚI NHẤT", không rơi vào thư mục Tải xuống của Chrome.
  try {
    const cfg = await khoCfg();
    if (cfg.key) {
      const r = await fetch(cfg.url.replace(/\/+$/, "") + "/api/backup_save", { method: "POST", headers: { "X-Key": cfg.key }, body: JSON.stringify(payload, null, 2) });
      const j = await r.json();
      if (j && j.ok) return;
    }
  } catch (e) { /* bảng điều khiển chưa bật: lưu tạm bằng cách cũ bên dưới */ }
  const dataUrl = "data:application/json," + encodeURIComponent(JSON.stringify(payload, null, 2));
  await chrome.downloads.download({
    url: dataUrl,
    filename: "Nghiên Cứu Đối Thủ - Sao Lưu/Du Lieu Nghien Cuu Doi Thu.json",
    conflictAction: "overwrite",
    saveAs: false,
  });
}

// ---------------------------------------------------------------------------
// Tự quét lại theo lịch (chrome.alarms) - popup bật/tắt qua message.
// ---------------------------------------------------------------------------
const AUTO_RESCAN_ALARM = "quangg_ving_auto_rescan";

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_RESCAN_ALARM || alarm.name === AUTO_RESCAN_ALARM + "_dance") {
    const mode = alarm.name === AUTO_RESCAN_ALARM ? "rival" : "dance";
    const key = "lastSettings" + sfxOf(mode);
    chrome.storage.local.get(key).then((got) => {
      const ls = got[key];
      if (ls && ls.profiles && ls.profiles.length) {
        runScan(Object.assign({}, ls, { mode })).catch(() => {});
      }
    });
  }
});


// ---------------------------------------------------------------------------
// GIỎ HÀNG TỪ TIKTODAY (thêm 2026-10-14)
// Sếp mở trang kênh trên TikToday (tab "Video bán hàng"), bấm nút trong popup.
// Mỗi dòng video của TikToday có sẵn trong dữ liệu: id = MÃ VIDEO TikTok (khớp
// đúng với link video) và products = các sản phẩm gắn giỏ (có MÃ SẢN PHẨM).
// Đã test thật: mã sản phẩm này đúng bằng dãy số trong
// tiktok.com/shop/vn/pdp/<mã>. Nên không cần ghép tên hay bấm từng sản phẩm.
// Hàm *Main chạy trong "thế giới chính" của trang (cần để đọc dữ liệu React),
// phải tự chứa, không dùng biến bên ngoài.
// ---------------------------------------------------------------------------
function cartExtractMain() {
  const out = [];
  document.querySelectorAll("table tbody tr").forEach((tr) => {
    const fk = Object.keys(tr).find((k) => k.startsWith("__reactFiber"));
    if (!fk) return;
    let f = tr[fk], r = null;
    for (let i = 0; i < 12 && f; i++, f = f.return) {
      const p = f.memoizedProps;
      if (p && p.row && p.row.id && Array.isArray(p.row.products)) { r = p.row; break; }
    }
    if (!r) return;
    out.push({
      id: String(r.id),
      isEc: !!r.is_ec,
      products: r.products
        .map((p) => ({ id: String(p.id), title: String(p.product_title || "").slice(0, 200) }))
        .filter((p) => /^\d{10,22}$/.test(p.id)),
    });
  });
  return { rows: out };
}

function cartNextMain() {
  const table = document.querySelector("table");
  if (!table) return { clicked: false, why: "no-table" };
  // Trang co nhieu bang; lay thanh so trang NGAY SAU bang video dau tien.
  const roots = Array.from(document.querySelectorAll(".MuiPagination-root")).filter((r) => table.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING);
  const pag = roots[0];
  if (!pag) return { clicked: false, why: "no-pagination" };
  const btns = Array.from(pag.querySelectorAll("button.MuiPaginationItem-root"));
  const cur = btns.find((b) => b.getAttribute("aria-current") === "page");
  const curN = cur ? parseInt(cur.textContent, 10) : NaN;
  if (!curN) return { clicked: false, why: "no-current" };
  const nxt = btns.find((b) => parseInt((b.textContent || "").trim(), 10) === curN + 1);
  if (!nxt || nxt.disabled) return { clicked: false, last: true, cur: curN };
  nxt.click();
  return { clicked: true, from: curN, to: curN + 1 };
}

function cartFirstMain() {
  const table = document.querySelector("table");
  if (!table) return { clicked: false };
  const roots = Array.from(document.querySelectorAll(".MuiPagination-root")).filter((r) => table.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING);
  const pag = roots[0];
  if (!pag) return { clicked: false };
  const btns = Array.from(pag.querySelectorAll("button.MuiPaginationItem-root"));
  const one = btns.find((b) => (b.textContent || "").trim() === "1");
  if (!one || one.getAttribute("aria-current") === "page") return { clicked: false };
  one.click();
  return { clicked: true };
}

async function runInMain(tabId, func) {
  const res = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func });
  return res && res[0] ? res[0].result : null;
}

async function updateCartState(patch) {
  const { cartState } = await chrome.storage.local.get("cartState");
  const next = Object.assign({}, cartState || {}, patch);
  await chrome.storage.local.set({ cartState: next });
  chrome.runtime.sendMessage({ type: "cart_progress", state: next }).catch(() => {});
}

let cartStopRequested = false;

async function waitCartRows(tabId, notFirstId, tries) {
  let data = null;
  for (let t = 0; t < tries; t++) {
    data = await runInMain(tabId, cartExtractMain).catch(() => null);
    if (data && data.rows && data.rows.length && (notFirstId == null || data.rows[0].id !== notFirstId)) return data;
    await sleep(500);
  }
  return data && data.rows && data.rows.length && (notFirstId == null || data.rows[0].id !== notFirstId) ? data : null;
}

// ID video TikTok chua san ngay dang (32 bit cao cua ID la giay Unix).
function idToMs(id) {
  try { return Number(BigInt(id) >> 32n) * 1000; } catch (e) { return 0; }
}

// Doc bang "Video ban hang" cua tab dang mo. Chi doc toi khi gap video cu hon moc fromMs
// (neu bang xep moi nhat truoc), khong doc het moi trang.
// Doi bang TikToday load XONG TU TE: co dong, khong con khung xam (skeleton), va nhom dong khong doi
// trong ~2 giay, roi nghi them 1-2 giay nhu nguoi that.
async function waitCartReady(tabId) {
  let prev = "";
  let stableCount = 0;
  for (let k = 0; k < 60; k++) {
    await sleep(1000);
    const d = await runInMain(tabId, cartExtractMain).catch(() => null);
    const sig = d && d.rows && d.rows.length ? d.rows.length + ":" + d.rows[0].id + ":" + d.rows[d.rows.length - 1].id : "";
    if (sig && sig === prev) stableCount += 1; else stableCount = 0;
    prev = sig;
    if (stableCount >= 2) { await randomDelay(1, 2); return true; }
  }
  return false;
}

async function scanCartCore(tabId, fromMs, onProgress) {
  const { cartData } = await chrome.storage.local.get("cartData");
  const store = cartData || {};
  let pages = 0, rowsTotal = 0, withCart = 0, sorted = null, reachedFrom = false, endOfList = false;
  const fst = await runInMain(tabId, cartFirstMain).catch(() => null);
  if (fst && fst.clicked) await sleep(1500);
  await waitCartReady(tabId);
  let data = await waitCartRows(tabId, null, 10);
  if (!data) throw new Error("Không đọc được bảng video (bảng chưa hiện, hoặc kênh chưa có dữ liệu bán hàng trên TikToday).");
  while (data && !cartStopRequested && pages < 400) {
    pages += 1;
    const now = Date.now();
    const times = data.rows.map((r) => idToMs(r.id));
    if (pages === 1) {
      // Bang co xep moi nhat truoc khong? (xet trang dau)
      let ok = times.length >= 3;
      for (let i = 1; i < times.length; i++) if (times[i] > times[i - 1]) ok = false;
      sorted = ok;
    }
    for (const r of data.rows) {
      store[r.id] = { products: r.products, isEc: r.isEc, ts: now };
      rowsTotal += 1;
      if (r.products.length) withCart += 1;
    }
    const lastFirst = data.rows[0].id;
    await chrome.storage.local.set({ cartData: store });
    if (onProgress) await onProgress({ page: pages, rows: rowsTotal, withCart });
    if (fromMs > 0 && sorted && times.length && times.every((x) => x < fromMs)) { reachedFrom = true; break; }
    const nx = await runInMain(tabId, cartNextMain).catch(() => null);
    if (!nx || !nx.clicked) { endOfList = true; break; }
    await randomDelay(1.5, 3);
    data = await waitCartRows(tabId, lastFirst, 40);
    if (data) { await randomDelay(1, 1.8); data = (await waitCartRows(tabId, lastFirst, 10)) || data; }
  }
  return { pages, rows: rowsTotal, withCart, sorted, reachedFrom, endOfList, stopped: cartStopRequested };
}

function cartNote(r) {
  let n = `${r.rows} video (${r.pages} trang), ${r.withCart} gắn giỏ`;
  if (r.reachedFrom) n += " ✔ đã đọc tới mốc ngày";
  else if (r.endOfList) n += r.sorted === false ? " ✔ đã đọc hết (bảng không xếp theo ngày nên không dừng sớm được)" : " ✔ hết bảng";
  else if (r.stopped) n += " ⚠ đã dừng giữa chừng";
  return n;
}

// Nut thu cong trong popup: doc tab TikToday dang mo.
async function scanCart(tabId, fromMs) {
  cartStopRequested = false;
  await updateCartState({ running: true, done: false, stopped: false, page: 0, rows: 0, withCart: 0, error: null, note: "" });
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || !/^https:\/\/tiktoday\.vn\/dashboard\/creators\//.test(tab.url || "")) {
      throw new Error("Hãy mở trang kênh trên TikToday (Nhà sáng tạo → bấm vào kênh) rồi bấm lại.");
    }
    const r = await scanCartCore(tabId, Number(fromMs) || 0, (s) => updateCartState(s));
    await updateCartState({ running: false, done: true, page: r.pages, rows: r.rows, withCart: r.withCart, stopped: r.stopped, note: cartNote(r) });
  } catch (e) {
    await updateCartState({ running: false, done: true, error: e.message });
  }
}

// Tu dong: sau khi quet TikTok xong, voi tung kenh mo datakenh.com/@kenh (tu nhay sang TikToday),
// bam tab "Video ban hang", doc gio hang toi moc ngay. Tra ve cac dong bao cao.
async function autoCartForChannels(usernames, fromMs, setNote) {
  const lines = [];
  if (!usernames.length) return lines;
  cartStopRequested = false;
  const tab = await chrome.tabs.create({ url: "about:blank", active: true });
  const tabId = tab.id;
  try {
    for (let i = 0; i < usernames.length; i++) {
      if (stopRequested || cartStopRequested) break;
      const u = usernames[i];
      await setNote(`Giỏ hàng: kênh @${u} (${i + 1}/${usernames.length})…`);
      try {
        await chrome.tabs.update(tabId, { url: `https://datakenh.com/@${encodeURIComponent(u)}`, active: true });
        // doi toi khi o trang kenh TikToday (toi da ~25s)
        let ok = false, loginNeeded = false;
        for (let k = 0; k < 50; k++) {
          await sleep(500);
          const cur = await chrome.tabs.get(tabId);
          const url = cur.url || "";
          if (/^https:\/\/tiktoday\.vn\/dashboard\/creators\//.test(url)) { ok = true; break; }
          if (/tiktoday\.vn/.test(url) && /login|sign|auth|dang-nhap/i.test(url)) { loginNeeded = true; break; }
        }
        if (loginNeeded) { lines.push(`@${u} (giỏ hàng): ⚠ TikToday đang yêu cầu đăng nhập, sếp đăng nhập TikToday rồi lấy giỏ hàng lại. Đã dừng phần giỏ hàng.`); break; }
        if (!ok) { lines.push(`@${u} (giỏ hàng): ⚠ TikToday chưa có kênh này (hoặc trang không mở được).`); continue; }
        await randomDelay(3, 5);
        const r = await scanCartCore(tabId, fromMs, null);
        lines.push(`@${u} (giỏ hàng): ${cartNote(r)}`);
      } catch (e) {
        lines.push(`@${u} (giỏ hàng): ⚠ ${e.message}`);
      }
      if (i < usernames.length - 1) await randomDelay(2, 4);
    }
  } finally {
    chrome.tabs.remove(tabId).catch(() => {});
  }
  return lines;
}

// ---------------------------------------------------------------------------
// THEO DÕI SẢN PHẨM (thêm 2026-10-14)
// - Trang chi tiết sản phẩm TikToday có sẵn đối tượng "product" (đã test thật):
//   lượt bán, doanh thu, số creator, số video, số live, hoa hồng, sao, số đánh giá...
//   (nếu TikToday chưa có dữ liệu của mã đó thì các số này = 0 → coi là "chưa rõ").
// - Trang bảng xếp hạng Sản phẩm có thêm "trend_data" = doanh thu cộng dồn 7 ngày gần nhất.
// Dữ liệu lưu: watchlist (danh sách theo dõi), productSnaps (mỗi lần đo 1 điểm), productTrend7.
// Các hàm *Main chạy trong "thế giới chính" của trang, phải tự chứa.
// ---------------------------------------------------------------------------
function productReadMain() {
  const els = document.querySelectorAll("*");
  for (const el of els) {
    const fk = Object.keys(el).find((k) => k.startsWith("__reactFiber"));
    if (!fk) continue;
    let f = el[fk];
    for (let i = 0; i < 25 && f; i++, f = f.return) {
      const p = f.memoizedProps;
      if (p && p.product && typeof p.product === "object" && p.product.creator_count !== undefined && p.product.id) {
        const x = p.product;
        const n = (v) => { const z = Number(v); return isNaN(z) ? 0 : z; };
        return {
          id: String(x.id),
          title: String(x.product_title || "").slice(0, 200),
          price: n(x.unit_price),
          minP: n(x.min_real_price),
          maxP: n(x.max_real_price),
          sold: n(x.sold_count),
          rev: n(x.revenue),
          cr: n(x.creator_count),
          vid: n(x.video_count),
          live: n(x.live_count),
          comm: n(x.commission_rate),
          rating: n(x.rating),
          reviews: n(x.review_count),
          shopRating: n(x.shop_rating),
          shop: x.shop && x.shop.name ? String(x.shop.name).slice(0, 80) : "",
          cover: x.cover ? String(x.cover) : "",
          imgs: Array.isArray(x.img) ? x.img.map((s) => String(s)).slice(0, 30) : [],
        };
      }
    }
  }
  return null;
}

// Trang chi tiết báo "Không tìm thấy bản ghi" = TikToday chưa có mã này trong dữ liệu (đã gặp thật).
function notFoundMain() {
  return /Không tìm thấy bản ghi/i.test(document.body ? document.body.innerText : "");
}

function listReadMain() {
  const out = [];
  document.querySelectorAll("table tbody tr").forEach((tr) => {
    const fk = Object.keys(tr).find((k) => k.startsWith("__reactFiber"));
    if (!fk) return;
    let f = tr[fk], r = null;
    for (let i = 0; i < 14 && f; i++, f = f.return) {
      const p = f.memoizedProps;
      if (p && p.row && typeof p.row === "object" && p.row.id && p.row.sold_count !== undefined) { r = p.row; break; }
    }
    if (!r) return;
    const n = (v) => { const z = Number(v); return isNaN(z) ? 0 : z; };
    out.push({
      id: String(r.id),
      title: String(r.product_title || "").slice(0, 200),
      price: n(r.unit_price),
      sold: n(r.sold_count),
      rev: n(r.revenue),
      cr: n(r.creator_count),
      vid: n(r.video_count),
      comm: n(r.commission_rate),
      rating: n(r.rating),
      reviews: n(r.review_count),
      shopRating: n(r.shop_rating),
      shop: r.shop && r.shop.name ? String(r.shop.name).slice(0, 80) : "",
      cover: r.cover ? String(r.cover) : "",
      trend: Array.isArray(r.trend_data) ? r.trend_data.map(n) : [],
    });
  });
  const head = Array.from(document.querySelectorAll("th")).map((t) => t.textContent || "").find((t) => /Doanh thu\s*\(/.test(t)) || "";
  return { rows: out, label: head.trim().slice(0, 40) };
}

async function updateTrackState(patch) {
  const { trackState } = await chrome.storage.local.get("trackState");
  const next = Object.assign({}, trackState || {}, patch);
  await chrome.storage.local.set({ trackState: next });
  chrome.runtime.sendMessage({ type: "track_progress", state: next }).catch(() => {});
}

let trackStopRequested = false;

// Gộp 1 điểm đo vào lịch sử (mỗi sản phẩm tối đa 200 điểm, bỏ điểm trùng trong 20 phút).
function addSnap(snaps, id, s) {
  const arr = snaps[id] || [];
  const last = arr[arr.length - 1];
  const pt = { t: Date.now(), sold: s.sold, rev: s.rev, cr: s.cr, vid: s.vid, live: s.live || 0, comm: s.comm, rating: s.rating, reviews: s.reviews, shopRating: s.shopRating, price: s.price };
  if (last && pt.t - last.t < 20 * 60 * 1000) arr[arr.length - 1] = pt; else arr.push(pt);
  snaps[id] = arr.slice(-200);
}

async function readProductPage(tabId, id) {
  let first = null;
  for (let k = 0; k < 75; k++) {
    await sleep(1000);
    const p = await runInMain(tabId, productReadMain).catch(() => null);
    if (p && p.id === id) { first = p; break; }
    if (k >= 4 && k % 3 === 0 && (await runInMain(tabId, notFoundMain).catch(() => false))) return { notFound: true };
  }
  if (!first) return null;
  // Chỉ nhận số khi 2 lần đọc cách nhau ~3 giây GIỐNG HỆT nhau (tránh lấy số khi trang còn đang cập nhật).
  let prev = first;
  for (let k = 0; k < 4; k++) {
    await randomDelay(2.5, 3.5);
    const cur = await runInMain(tabId, productReadMain).catch(() => null);
    if (!cur || cur.id !== id) continue;
    if (JSON.stringify(cur) === JSON.stringify(prev)) return cur;
    prev = cur;
  }
  return prev;
}

async function trackProducts(onlyIds) {
  trackStopRequested = false;
  const { watchlist, productSnaps } = await chrome.storage.local.get(["watchlist", "productSnaps"]);
  const wl = watchlist || {};
  const snaps = productSnaps || {};
  const ids = (onlyIds && onlyIds.length ? onlyIds : Object.keys(wl)).filter((i) => wl[i]);
  if (!ids.length) {
    await updateTrackState({ running: false, done: true, error: "Danh sách theo dõi đang trống.", total: 0, index: 0, ok: 0, fail: 0 });
    return;
  }
  await updateTrackState({ running: true, done: false, error: null, total: ids.length, index: 0, ok: 0, fail: 0, current: "" });
  let ok = 0, fail = 0;
  const tab = await chrome.tabs.create({ url: "about:blank", active: true });
  try {
    for (let i = 0; i < ids.length; i++) {
      if (trackStopRequested) break;
      const id = ids[i];
      await updateTrackState({ index: i + 1, current: (wl[id].title || id).slice(0, 50) });
      try {
        await chrome.tabs.update(tab.id, { url: `https://tiktoday.vn/dashboard/products/${id}`, active: true });
        const p = await readProductPage(tab.id, id);
        if (p && p.notFound) { fail += 1; wl[id].lastError = "TikToday chưa có mã này (trang báo Không tìm thấy bản ghi) - cần kiểm bằng app TikTok"; }
        else if (!p) { fail += 1; wl[id].lastError = "Không đọc được trang (TikToday tải quá lâu hoặc cần đăng nhập)"; }
        else {
          ok += 1;
          wl[id].lastError = "";
          wl[id].title = p.title || wl[id].title;
          wl[id].cover = p.cover || wl[id].cover;
          wl[id].shop = p.shop || wl[id].shop;
          addSnap(snaps, id, p);
        }
        await chrome.storage.local.set({ watchlist: wl, productSnaps: snaps });
      } catch (e) {
        fail += 1;
        wl[id].lastError = e.message;
      }
      await updateTrackState({ ok, fail });
      if (i < ids.length - 1) await randomDelay(2, 4);
    }
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
  await chrome.storage.local.set({ watchlist: wl, productSnaps: snaps, trackLastRun: Date.now() });
  await updateTrackState({ running: false, done: true, ok, fail, stopped: trackStopRequested });
}

// Nhập các sản phẩm đang hiện trên trang "Bảng xếp hạng Sản phẩm" (kèm biểu đồ doanh thu 7 ngày của TikToday).
async function importProductList(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab || !/^https:\/\/tiktoday\.vn\/dashboard\/products(\?|$|#)/.test(tab.url || "")) {
    return { ok: false, error: "Hãy mở trang Sản phẩm của TikToday (menu Sản phẩm, trang danh sách) rồi bấm lại." };
  }
  let res = null;
  for (let k = 0; k < 40; k++) {
    res = await runInMain(tabId, listReadMain).catch(() => null);
    if (res && res.rows && res.rows.length) break;
    await sleep(1000);
  }
  if (!res || !res.rows.length) return { ok: false, error: "Chưa thấy bảng sản phẩm. Chờ bảng hiện đủ rồi bấm lại." };
  const { watchlist, productSnaps, productTrend7 } = await chrome.storage.local.get(["watchlist", "productSnaps", "productTrend7"]);
  const wl = watchlist || {};
  const snaps = productSnaps || {};
  const tr = productTrend7 || {};
  let added = 0;
  const now = Date.now();
  for (const r of res.rows) {
    if (!wl[r.id]) { wl[r.id] = { id: r.id, title: r.title, cover: r.cover, shop: r.shop, addedAt: now }; added += 1; }
    addSnap(snaps, r.id, r);
    if (r.trend.length >= 3) tr[r.id] = { t: now, pts: r.trend, label: res.label };
  }
  await chrome.storage.local.set({ watchlist: wl, productSnaps: snaps, productTrend7: tr });
  return { ok: true, count: res.rows.length, added };
}

// ---------------------------------------------------------------------------
// TẢI ẢNH SẢN PHẨM → JSON cho app Phối Đồ (thêm 2026-10-14)
// Bước 1: lấy ảnh từ TikToday (danh sách ảnh nằm sẵn trong dữ liệu sản phẩm, không bị hỏi "bot hay người").
// Bước 2: mã nào TikToday không có thì mở link TikTok Shop, đọc ảnh gallery + ảnh các màu trên trang.
//         Gặp bước xác minh của TikTok thì DỪNG, giữ tab cho người dùng tự xác minh rồi bấm Tiếp tục.
// Dữ liệu lưu: prodImages {id:{id,title,source,kind,addedAt,images:[{u,locked}]}}, imgJobState.
// ---------------------------------------------------------------------------
function shopImagesMain() {
  const out = new Map();
  document.querySelectorAll("img").forEach((i) => {
    const u = i.currentSrc || i.src || "";
    if (!/^https?:/.test(u)) return;
    if (/avt|avatar|emoji|sticker|logo|icon/i.test(u)) return;
    const m = u.match(/^(https:\/\/[^/]+)\/(tos-[^?~]+)(?:~(tplv-[^?]+))?/);
    if (!m) return;
    const r = i.getBoundingClientRect();
    const y = r.top + window.scrollY;
    if (y > 800) return; // chỉ khu vực đầu trang (gallery + ảnh màu), bỏ ảnh đánh giá / gợi ý ở dưới
    if (r.width < 30 || r.height < 30) return;
    const key = m[2];
    if (out.has(key)) return;
    const tplv = m[3] ? m[3].replace(/:\d+:\d+(\.\w+)$/, ":800:800$1") : "";
    out.set(key, { u: m[1] + "/" + m[2] + (tplv ? "~" + tplv : "") });
  });
  return { imgs: Array.from(out.values()).map((x) => x.u), title: (document.title || "").replace(/\s*-\s*TikTok Shop.*$/i, "").slice(0, 200) };
}

function botCheckMain() {
  const t = document.body ? document.body.innerText : "";
  return !!document.querySelector('[id*="captcha"], [class*="captcha"], iframe[src*="captcha"]') || /Verify to continue|Xác minh để tiếp tục|Drag the slider|Kéo thanh trượt|Select 2 objects|verify you are human|bạn là người/i.test(t);
}

function parseProductIds(text) {
  const ids = [];
  String(text || "").split(/\s+/).forEach((tok) => {
    const m = tok.match(/\/pdp\/(\d{15,22})/) || tok.match(/products\/(\d{15,22})/) || tok.match(/^(\d{15,22})$/);
    if (m && !ids.includes(m[1])) ids.push(m[1]);
  });
  return ids;
}

async function updateImgState(patch) {
  const { imgJobState } = await chrome.storage.local.get("imgJobState");
  const next = Object.assign({}, imgJobState || {}, patch);
  await chrome.storage.local.set({ imgJobState: next });
  chrome.runtime.sendMessage({ type: "img_progress", state: next }).catch(() => {});
}

let imgStopRequested = false;
let imgResumeFlag = false;

async function saveProdImages(id, entry) {
  const { prodImages } = await chrome.storage.local.get("prodImages");
  const all = prodImages || {};
  const old = all[id];
  all[id] = Object.assign({ kind: "top", addedAt: Date.now() }, old || {}, entry);
  await chrome.storage.local.set({ prodImages: all });
}

// Đọc ảnh từ trang chi tiết TikToday. Trả về {notFound:true} nếu TikToday chưa có mã này.
async function imagesFromTikToday(tabId, id) {
  await chrome.tabs.update(tabId, { url: `https://tiktoday.vn/dashboard/products/${id}`, active: false });
  for (let k = 0; k < 80; k++) {
    await sleep(1000);
    const p = await runInMain(tabId, productReadMain).catch(() => null);
    if (p && p.id === id) {
      const host = p.cover ? (p.cover.match(/^https:\/\/[^/]+/) || [""])[0] : "";
      const tplv = p.cover && /~(tplv-[^?]+)/.test(p.cover) ? p.cover.match(/~(tplv-[^?]+)/)[1] : "";
      const list = (p.imgs || []).map((path) => host + "/" + path + (tplv ? "~" + tplv : ""));
      if (!list.length && p.cover) list.push(p.cover.split("?")[0]);
      return { title: p.title, imgs: list };
    }
    if (k >= 4 && k % 3 === 0 && (await runInMain(tabId, notFoundMain).catch(() => false))) return { notFound: true };
  }
  return { notFound: true, timeout: true };
}

async function imagesFromShop(tabId, id) {
  await chrome.tabs.update(tabId, { url: `https://www.tiktok.com/shop/vn/pdp/${id}`, active: true });
  await waitForTabComplete(tabId).catch(() => {});
  await randomDelay(4, 6);
  for (let k = 0; k < 20; k++) {
    if (await runInMain(tabId, botCheckMain).catch(() => false)) return { bot: true };
    const r = await runInMain(tabId, shopImagesMain).catch(() => null);
    if (r && r.imgs && r.imgs.length >= 2) {
      await randomDelay(1, 2);
      const r2 = await runInMain(tabId, shopImagesMain).catch(() => null);
      return r2 && r2.imgs && r2.imgs.length >= r.imgs.length ? r2 : r;
    }
    await sleep(1000);
  }
  return { imgs: [], title: "" };
}

async function runImageJob(ids) {
  imgStopRequested = false;
  imgResumeFlag = false;
  const { prodImages } = await chrome.storage.local.get("prodImages");
  const have = prodImages || {};
  const todo = ids.filter((id) => !have[id] || !(have[id].images || []).length);
  await updateImgState({ running: true, done: false, paused: false, error: null, total: ids.length, finished: ids.length - todo.length, fromTikToday: 0, fromShop: 0, failed: [], note: "", current: "" });
  if (!todo.length) { await updateImgState({ running: false, done: true, note: "Các mã này đã có ảnh rồi." }); return; }
  const missing = [];
  let fin = ids.length - todo.length, fromTT = 0, fromShop = 0;
  const failed = [];
  // --- Bước 1: TikToday (3 tab song song) ---
  const queue = todo.slice();
  const workers = [];
  const tabsOpen = [];
  async function worker() {
    const t = await chrome.tabs.create({ url: "about:blank", active: false });
    tabsOpen.push(t.id);
    while (queue.length && !imgStopRequested) {
      const id = queue.shift();
      await updateImgState({ current: "TikToday: " + id });
      try {
        const r = await imagesFromTikToday(t.id, id);
        if (r.notFound || !r.imgs.length) missing.push(id);
        else {
          await saveProdImages(id, { id, title: r.title, source: "TikToday", images: r.imgs.map((u) => ({ u, locked: false })) });
          fin += 1; fromTT += 1;
        }
      } catch (e) { missing.push(id); }
      await updateImgState({ finished: fin, fromTikToday: fromTT });
    }
  }
  for (let w = 0; w < Math.min(3, queue.length); w++) workers.push(worker());
  await Promise.all(workers);
  tabsOpen.forEach((t) => chrome.tabs.remove(t).catch(() => {}));

  // --- Bước 2: TikTok Shop cho các mã TikToday không có ---
  if (missing.length && !imgStopRequested) {
    const tab = await chrome.tabs.create({ url: "about:blank", active: true });
    try {
      for (let i = 0; i < missing.length && !imgStopRequested; i++) {
        const id = missing[i];
        await updateImgState({ current: `TikTok Shop (${i + 1}/${missing.length}): ${id}` });
        let r = await imagesFromShop(tab.id, id).catch(() => ({ imgs: [] }));
        while (r.bot && !imgStopRequested) {
          await updateImgState({ paused: true, note: `⚠ TikTok đang hỏi xác minh ở mã ${id}. Sếp qua tab TikTok đang mở, tự xác minh, rồi bấm "Tiếp tục".` });
          imgResumeFlag = false;
          while (!imgResumeFlag && !imgStopRequested) await sleep(1000);
          if (imgStopRequested) break;
          await updateImgState({ paused: false, note: "" });
          r = await imagesFromShop(tab.id, id).catch(() => ({ imgs: [] }));
        }
        if (imgStopRequested) break;
        if (r.imgs && r.imgs.length) {
          await saveProdImages(id, { id, title: r.title, source: "TikTok Shop", images: r.imgs.map((u) => ({ u, locked: false })) });
          fin += 1; fromShop += 1;
        } else failed.push(id);
        await updateImgState({ finished: fin, fromShop, failed });
        if (i < missing.length - 1) await randomDelay(8, 14);
      }
    } finally {
      chrome.tabs.remove(tab.id).catch(() => {});
    }
  } else if (missing.length) {
    failed.push(...missing);
  }
  await updateImgState({ running: false, done: true, paused: false, finished: fin, fromTikToday: fromTT, fromShop, failed, stopped: imgStopRequested, current: "" });
}

// ---------------------------------------------------------------------------
// KHO ẢNH SẢN PHẨM (thêm 2026-10-15)
// Bảng điều khiển trên laptop lưu các link sếp dán. Tiện ích này cứ 30 giây hỏi bảng điều khiển
// "có link nào chờ tải không", lấy ảnh sản phẩm (TikToday trước, TikTok Shop sau) rồi ghi ảnh GỐC
// vào thư mục thật "KHO ẢNH SẢN PHẨM/1 - ẢNH SẢN PHẨM/1 - ẢNH SẢN PHẨM CẦN SẾP XỬ LÍ" qua chương trình chạy ngầm trên laptop.
// Gặp bước "xác minh bot" của TikTok thì dừng và báo, KHÔNG tự giải.
// ---------------------------------------------------------------------------
const KHO_ALARM = "khoPoll";
let khoBusy = false;

async function khoCfg() {
  const { khoCfg: c } = await chrome.storage.local.get("khoCfg");
  return Object.assign({ url: "http://localhost:8800", key: "" }, c || {});
}
async function khoFetch(cfg, path, opt) {
  const o = Object.assign({}, opt || {});
  o.headers = Object.assign({ "X-Key": cfg.key }, o.headers || {});
  const r = await fetch(cfg.url.replace(/\/+$/, "") + path, o);
  if (r.status === 401) throw new Error("sai mật khẩu (key) của bảng điều khiển");
  const j = await r.json();
  if (j.ok === false) throw new Error(j.error || "lỗi từ bảng điều khiển");
  return j;
}
const khoPost = (cfg, path, body) => khoFetch(cfg, path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function khoState(patch) {
  const { khoState: s } = await chrome.storage.local.get("khoState");
  const next = Object.assign({}, s || {}, patch);
  await chrome.storage.local.set({ khoState: next });
  chrome.runtime.sendMessage({ type: "kho_state", state: next }).catch(() => {});
}

async function khoPoll() {
  if (khoBusy) return;
  const cfg = await khoCfg();
  if (!cfg.key) return;
  khoBusy = true;
  try {
    const r = await khoFetch(cfg, "/api/links?pending=1");
    await khoState({ online: true, error: null, lastPoll: Date.now(), pending: r.links.length });
    for (const l of r.links) {
      await khoState({ working: l.link });
      await khoProcess(cfg, l.link);
    }
    await khoState({ working: "", pending: 0 });
  } catch (e) {
    await khoState({ online: false, error: String(e.message || e), lastPoll: Date.now(), working: "" });
  } finally {
    khoBusy = false;
  }
}

async function khoProcess(cfg, link) {
  const set = (status, note, rel) => khoPost(cfg, "/api/links", { set: [{ link, status, note: note || "", rel }] });
  let ids = parseProductIds(link);
  if (!ids.length) { const m = String(link).match(/(\d{15,22})/); if (m) ids = [m[1]]; }
  if (!ids.length) return set("error", "Không thấy mã sản phẩm trong link");
  const id = ids[0];
  try {
    const f = await khoFetch(cfg, "/api/find?ma=" + id);
    if (f.found) return set("done", "Đã có sẵn trong kho, không tải lại", f.rel);
    await set("doing", "Đang tải ảnh…");
    const tab = await chrome.tabs.create({ url: "about:blank", active: false });
    let res = null;
    try {
      res = await imagesFromTikToday(tab.id, id);
      if (!res || res.notFound || !(res.imgs || []).length) {
        res = await imagesFromShop(tab.id, id);
        if (res && res.bot) {
          await set("error", "TikTok đang hỏi xác minh. Mở tab TikTok vừa hiện, xác minh xong rồi bấm Thử lại.");
          return;
        }
      }
    } finally {
      if (!(res && res.bot)) chrome.tabs.remove(tab.id).catch(() => {});
    }
    const imgs = (res && res.imgs) || [];
    if (!imgs.length) return set("error", "Không lấy được ảnh nào (TikToday chưa có mã này và TikTok Shop không cho đọc).");
    const title = String((res && res.title) || "").replace(/\s+/g, " ").trim() || "Sản phẩm";
    const np = await khoPost(cfg, "/api/newproduct", { path: "1 - ẢNH SẢN PHẨM/1 - ẢNH SẢN PHẨM CẦN SẾP XỬ LÍ", name: title.slice(0, 60) + " " + id, link, ma: id });
    let ok = 0, dup = 0;
    for (let i = 0; i < imgs.length; i++) {
      try {
        const r = await fetch(imgs[i]);
        if (!r.ok) continue;
        const b = await r.blob();
        const ext = /png/.test(b.type) ? ".png" : /jpe?g/.test(b.type) ? ".jpg" : ".webp";
        const u = await khoFetch(cfg, "/api/upload?path=" + encodeURIComponent(np.rel) + "&name=" + encodeURIComponent(i + 1 + ext), { method: "POST", body: b });
        if (u.dup) dup++; else ok++;
      } catch (e) { /* bỏ ảnh lỗi, làm ảnh kế */ }
    }
    if (!ok && !dup) {
      await khoPost(cfg, "/api/delete", { items: [np.rel], hard: true }).catch(() => {});
      return set("error", "Tải ảnh về thất bại (không tải được ảnh nào từ link ảnh).");
    }
    return set("done", "Đã tải " + ok + " ảnh" + (dup ? " (bỏ " + dup + " trùng)" : ""), np.rel);
  } catch (e) {
    return set("error", String(e.message || e)).catch(() => {});
  }
}

// Chờ sẵn: hỏi bảng điều khiển kiểu "giữ máy 20 giây", có link là nhận ngay. Báo thức 30 giây chỉ để đánh thức lại nếu vòng chờ bị tắt.
async function khoRefreshTabs(L, cfg) {
  // Làm mới trang bảng điều khiển + App Phối Đồ (để tiện ích mới gắn vào), chưa mở thì mở.
  const appId = (String(L.app_url).match(/\/app\/([0-9a-f]+)/) || [])[1] || "";
  const tabs = await chrome.tabs.query({});
  const urlOf = (t) => t.url || t.pendingUrl || "";   // tab đang tải chưa có url thì dùng pendingUrl, kẻo tưởng chưa có rồi mở thêm
  const panel = tabs.filter((t) => urlOf(t).indexOf(cfg.url.replace(/\/+$/, "")) === 0);
  const app = tabs.filter((t) => urlOf(t).indexOf("https://gemini.google.com/") === 0 && appId && urlOf(t).indexOf("/app/" + appId) >= 0);
  const justOpened = L.chrome_at && L.now && L.now - L.chrome_at < 120;   // dây chuyền vừa tự mở Chrome với đủ 2 trang: không mở thêm
  if (panel.length) panel.forEach((t) => chrome.tabs.reload(t.id)); else if (!justOpened) chrome.tabs.create({ url: L.panel_url, active: false });
  if (app.length) app.forEach((t) => chrome.tabs.reload(t.id)); else if (!justOpened) chrome.tabs.create({ url: L.app_url, active: false });
}
async function khoLaunchCheck(cfg) {
  const L = await khoFetch(cfg, "/api/launch");
  const st = await chrome.storage.local.get(["launchSeen", "extVerSeen", "pendingTabReload"]);
  if (st.extVerSeen != null && st.extVerSeen !== L.ext_ver) {  // file tiện ích đã được sửa: tự tải lại chính mình, rồi làm mới các trang
    await chrome.storage.local.set({ extVerSeen: L.ext_ver, pendingTabReload: true });
    chrome.runtime.reload();
    return;
  }
  if (st.extVerSeen == null) await chrome.storage.local.set({ extVerSeen: L.ext_ver });
  if (st.pendingTabReload) {  // vừa tự tải lại xong: trang App Phối Đồ cũ đã mất kết nối với tiện ích, làm mới nó
    await chrome.storage.local.set({ pendingTabReload: false, launchSeen: L.launch });
    await khoRefreshTabs(L, cfg);
    return;
  }
  if (st.launchSeen === L.launch) return;
  await chrome.storage.local.set({ launchSeen: L.launch });
  if (st.launchSeen == null) return;  // lần đầu tiên: chỉ ghi nhớ, không động vào trang nào
  await khoRefreshTabs(L, cfg);  // bảng điều khiển vừa được bật lại
}
// ---------------------------------------------------------------------------
// ĐỐI THỦ -> BẢNG ĐIỀU KHIỂN: đẩy bảng clip (thu gọn) + tiến độ về panel, nhận lệnh "Quét view ngay" từ panel.
// Dùng đúng dữ liệu "videos" và đúng cách tính xu hướng/tốc độ của dashboard; không quét gì khác.
// ---------------------------------------------------------------------------
function rivalTrend(history, followerCount) {
  // Bộ luật đã chỉnh theo số liệu thật (21/10/2026): 🔥 cần tăng tốc >= x2 và >= 1.000 lượt/ngày; 📉 khi <= x0,5 / không tăng / dưới 1.000 lượt/ngày; hai lần quét cách nhau < 1 giờ thì bỏ lần cuối (số view nhảy theo nấc, tốc độ rất giật)
  if (history.length < 2) return { icon: "🆕", label: "Mới, chưa đủ dữ liệu" };
  const n = history.length, last = history[n - 1], prev = history[n - 2];
  if ((last.ts - prev.ts) / 3600000 < 1) return n > 2 ? rivalTrend(history.slice(0, -1), followerCount) : { icon: "🆕", label: "Mới, chưa đủ dữ liệu" };
  const day = (a, b) => ((b.views - a.views) / Math.max(0.0001, (b.ts - a.ts) / 3600000)) * 24;   // lượt xem / ngày
  const lastDay = day(prev, last), MIN = 1000;
  let icon, label;
  if (n >= 3) {
    const prevDay = day(history[n - 3], prev);
    if (lastDay >= MIN && lastDay >= prevDay * 2) { icon = "🔥"; label = "Đang bùng nổ"; }
    else if (lastDay < MIN || lastDay <= prevDay * 0.5) { icon = "📉"; label = "Đang chững"; }
    else { icon = "📈"; label = "Đang tăng đều"; }
  } else if (lastDay >= MIN) { icon = "📈"; label = "Đang tăng đều"; } else { icon = "📉"; label = "Đang chững"; }
  if (followerCount && last.views >= followerCount * 5 && lastDay >= MIN) { icon = "🔥"; label = "Đang bùng nổ"; }
  return { icon, label };
}
async function rivalPush(cfg) {
  const g = await chrome.storage.local.get(["videos", "channelFollowers", "channelAvatars"]);
  const store = g.videos || {}, fol = g.channelFollowers || {}, av = g.channelAvatars || {};
  const rows = Object.values(store).map((v) => {
    const h = v.history || [], last = h[h.length - 1], first = h[0], prev = h.length >= 2 ? h[h.length - 2] : null;
    const cv = last ? last.views : 0;
    let d = 0;
    if (h.length >= 2 && first) d = Math.round(((cv - first.views) / Math.max(0.0001, (last.ts - first.ts) / 3600000)) * 24);
    const tr = rivalTrend(h, fol[v.channel]);
    return { i: v.id, ch: v.channel, ct: v.createTime || 0, u: v.pageUrl || "", f: first ? [first.ts, first.views] : null, r: h.slice(-4).map((e) => [e.ts, e.views]), cv, g: prev ? cv - prev.views : 0, d, tr: tr.icon, tl: tr.label, fr: fol[v.channel] ? Math.round((cv / fol[v.channel]) * 100) / 100 : 0 };
  });
  rows.sort((a, b) => b.d - a.d);
  const avs = {};
  rows.forEach((r) => { const a = av[r.ch]; if (typeof a === "string" && /^https?:/.test(a) && a.length < 500) avs[r.ch] = a; });
  await khoPost(cfg, "/api/doithu", { put: { rows, av: avs } });
}
let rivalLast = 0, rivalPushedOnce = false;
async function rivalHook(st) {
  if (SCAN_SFX) return;  // chỉ chế độ "đối thủ", không tính chế độ viral
  const fin = !!st.done && !st.running, now = Date.now();
  if (!fin && now - rivalLast < 2500) return;
  rivalLast = now;
  const cfg = await khoCfg();
  if (!cfg.key) return;
  if (fin) await rivalPush(cfg);
  const msg = fin ? (st.error ? String(st.error).slice(0, 220) : "Xong: " + (st.clipsMatched || 0) + " clip đạt ngưỡng") : "Kênh " + (st.currentIndex || 0) + "/" + (st.total || 0) + (st.currentChannel ? " @" + st.currentChannel : "") + " · đã đọc " + (st.videosRead || 0) + " video, " + (st.clipsMatched || 0) + " đạt ngưỡng";
  const pct = fin ? 100 : st.total ? Math.round(((st.currentIndex || 0) / st.total) * 100) : 0;
  await khoPost(cfg, "/api/doithu", { progress: { status: fin ? (st.needCaptcha || (st.error && !st.clipsMatched) ? "error" : "done") : "run", msg, pct } });
}
async function rivalPoll() {
  const cfg = await khoCfg();
  if (!cfg.key) return;
  const r = await khoFetch(cfg, "/api/doithu");
  if (!r.n && !rivalPushedOnce) { rivalPushedOnce = true; await rivalPush(cfg); }  // lần đầu: gửi sẵn dữ liệu đã có
  // luật gắn nhãn xu hướng vừa đổi: gửi lại bảng một lần để nhãn trên bảng điều khiển đổi ngay, không phải đợi lần quét sau
  { const TV = "trend-2026-10-21b", sv = (await chrome.storage.local.get("rivalTrendVer")).rivalTrendVer; if (sv !== TV) { await chrome.storage.local.set({ rivalTrendVer: TV }); rivalPushedOnce = true; await rivalPush(cfg); } }
  // lệnh xóa / thùng rác / khôi phục từ bảng điều khiển: áp dụng đúng vào kho "videos" + "videosTrash" (cùng thùng rác với dashboard), rồi gửi lại bảng mới
  if (r.cmds && r.cmds.length && !SCAN_BUSY) {
    const g = await chrome.storage.local.get(["videos", "videosTrash"]);
    let vs = g.videos || {}, tr = g.videosTrash || {};
    for (const c of r.cmds) {
      if (c.op === "trash") (c.ids || []).forEach((id) => { if (vs[id]) { vs[id].deletedAt = Date.now(); tr[id] = vs[id]; delete vs[id]; } });
      else if (c.op === "restore") (c.ids || []).forEach((id) => { if (tr[id]) { delete tr[id].deletedAt; vs[id] = tr[id]; delete tr[id]; } });
      else if (c.op === "purge") (c.ids || []).forEach((id) => { delete tr[id]; delete vs[id]; });
      else if (c.op === "chan") { Object.keys(vs).forEach((k) => { if (vs[k].channel === c.ch) delete vs[k]; }); Object.keys(tr).forEach((k) => { if (tr[k].channel === c.ch) delete tr[k]; }); }
      else if (c.op === "all") { vs = {}; tr = {}; }
    }
    await chrome.storage.local.set({ videos: vs, videosTrash: tr });
    await khoPost(cfg, "/api/doithu", { ack: Math.max.apply(null, r.cmds.map((c) => c.n)) });
    await rivalPush(cfg);
  }
  // tự quét lại theo giờ do bảng điều khiển đặt (cùng cơ chế báo thức như ô "Tự quét lại mỗi" của tiện ích)
  if (r.cfg && typeof r.cfg.auto === "number") {
    const seen = (await chrome.storage.local.get("rivalAutoSeen")).rivalAutoSeen;
    if (seen !== r.cfg.auto) {
      await chrome.storage.local.set({ rivalAutoSeen: r.cfg.auto });
      if (r.cfg.auto > 0) chrome.alarms.create(AUTO_RESCAN_ALARM, { periodInMinutes: r.cfg.auto * 60 }); else chrome.alarms.clear(AUTO_RESCAN_ALARM);
    }
  }
  const j = r.job;
  if (!j) return;
  if (j.status === "run" && j.stop && SCAN_BUSY && !SCAN_SFX) { stopRequested = true; return; }
  if (j.status === "run" && !SCAN_BUSY) { await khoPost(cfg, "/api/doithu", { progress: { status: "error", msg: j.stop ? "Đã dừng" : "Phiên quét đã kết thúc giữa chừng (tiện ích khởi động lại). Bấm chạy lại nếu cần.", pct: 0 } }); return; }
  if (j.status !== "wait") return;
  const post = (status, msg) => khoPost(cfg, "/api/doithu", { progress: { status, msg, pct: 0 } });
  if (SCAN_BUSY) { await post("error", "Đang có một phiên quét khác chạy, đợi xong rồi bấm lại."); return; }
  const d = new Date(), pad = (n) => String(n).padStart(2, "0"), ymd = (x) => x.getFullYear() + "-" + pad(x.getMonth() + 1) + "-" + pad(x.getDate());
  const set = j.set || (r.cfg || null);  // cài đặt do bảng điều khiển gửi kèm lệnh
  let ls;
  if (set && set.profiles && set.profiles.length) {
    let from = set.from, to = set.to;
    if (set.days > 0) { const f = new Date(); f.setDate(f.getDate() - (set.days - 1)); from = ymd(f); to = ymd(d); }  // chọn nhanh "N ngày qua": tính theo hôm nay
    ls = { profiles: set.profiles, fromDate: from || "", toDate: to || ymd(d), threshold: Number(set.thr) || 0 };
    await chrome.storage.local.set({ lastSettings: ls });  // popup của tiện ích cũng thấy đúng cài đặt này
  } else {
    const got = await chrome.storage.local.get("lastSettings");
    ls = got.lastSettings;
    if (!ls || !ls.profiles || !ls.profiles.length) { await post("error", "Chưa có danh sách kênh: nhập danh sách kênh trong bảng điều khiển (hoặc trong tiện ích) rồi quét lại."); return; }
    ls = Object.assign({}, ls, { toDate: ymd(d) });
  }
  await post("run", "Đang bắt đầu quét " + ls.profiles.length + " kênh…");
  if (!(await qvRestoreWindow())) { try { await chrome.windows.create({ url: "about:blank", focused: true, state: "maximized" }); } catch (e) { /* bỏ qua */ } }   // Chrome đang thu nhỏ hoặc chỉ chạy nền: đưa cửa sổ ra trước rồi mới quét
  runScan(Object.assign({}, ls, { mode: "rival" })).catch((e) => updateScanState({ running: false, done: true, error: e.message }));
}
// ---- Kalo: bảng điều khiển gửi lệnh quét Kalodata -> mở tab -> kalodata.js tự bấm "đọc" -> gửi kết quả về ----
let kaloTab = 0;
// phóng cửa sổ Chrome đang thu nhỏ lên và đưa ra trước (không có cửa sổ nào thì trả null)
async function qvLog(msg) {
  try { const cfg = await khoCfg(); if (cfg.key) await khoPost(cfg, "/api/ext_log", { msg }); } catch (e) { /* bỏ qua */ }
}
async function qvRaiseWindow(win) {   // phóng cửa sổ lên (nếu đang thu nhỏ) và đưa ra trước; kiểm lại, vẫn thu nhỏ thì ép phóng to
  const before = win.state;
  try { await chrome.windows.update(win.id, before === "minimized" ? { state: "normal", focused: true } : { focused: true }); } catch (e) { qvLog("windows.update lỗi: " + e); }
  await new Promise((r) => setTimeout(r, 350));
  try {
    const w2 = await chrome.windows.get(win.id);
    if (w2.state === "minimized") { await chrome.windows.update(win.id, { state: "maximized", focused: true }); await new Promise((r) => setTimeout(r, 250)); }
    const w3 = await chrome.windows.get(win.id);
    qvLog("cửa sổ " + win.id + ": trước=" + before + ", sau=" + w3.state + ", focused=" + w3.focused);
    return w3;
  } catch (e) { qvLog("kiểm lại cửa sổ lỗi: " + e); return win; }
}
async function qvRestoreWindow() {
  let win = null;
  try { win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] }); } catch (e) { win = null; }
  if (!win) { try { win = (await chrome.windows.getAll({ windowTypes: ["normal"] }))[0] || null; } catch (e) { win = null; } }
  if (!win) { qvLog("không có cửa sổ Chrome nào của tiện ích (Chrome chạy nền)"); return null; }
  return await qvRaiseWindow(win);
}
// Bảng điều khiển nhờ: mở / đưa lên một trang (App Phối Đồ, bảng điều khiển). Đã có tab đó thì CHỈ đưa lên (kể cả cửa sổ thu nhỏ, bị che), chưa có mới mở đúng 1 tab.
function qvPageKey(u) {
  try { const x = new URL(u); return x.hostname.replace("127.0.0.1", "localhost") + ":" + x.port + x.pathname.replace(/\/+$/, ""); } catch (e) { return String(u || ""); }
}
async function appOpenPoll() {
  const cfg = await khoCfg();
  if (!cfg.key) return;
  const r = await khoFetch(cfg, "/api/app_open");
  const pages = (r && r.pages) || [];
  if (!pages.length) return;
  await khoPost(cfg, "/api/app_open", { done: pages.map((p) => p.name) });
  const tabs = await chrome.tabs.query({});
  qvLog("nhận lệnh mở/đưa lên: " + pages.map((p) => p.name + (p.focus ? "(đưa lên)" : "")).join(", ") + " | số tab đang có: " + tabs.length);
  for (const pg of pages) {
    const key = qvPageKey(pg.url);
    const hit = tabs.find((t) => t.url && qvPageKey(t.url).startsWith(key));
    qvLog("trang " + pg.name + ": " + (hit ? "ĐÃ CÓ tab " + hit.id + " (cửa sổ " + hit.windowId + ")" : "chưa có tab, sẽ mở 1 tab"));
    if (hit) {
      if (pg.focus) {
        try { const w = await chrome.windows.get(hit.windowId); await qvRaiseWindow(w); } catch (e) { qvLog("đưa cửa sổ lên lỗi: " + e); }
        try { await chrome.tabs.update(hit.id, { active: true }); } catch (e) { /* bỏ qua */ }
      }
      continue;
    }
    let win = null;
    if (pg.focus) win = await qvRestoreWindow();
    else { try { win = (await chrome.windows.getAll({ windowTypes: ["normal"] }))[0] || null; } catch (e) { win = null; } }
    if (!win) { try { await chrome.windows.create({ url: pg.url, focused: !!pg.focus, state: pg.focus ? "maximized" : "normal" }); } catch (e) { /* bỏ qua */ } continue; }
    try { await chrome.tabs.create({ windowId: win.id, url: pg.url, active: !!pg.focus }); } catch (e) { /* bỏ qua */ }
  }
}
// Link mở kênh Kalodata nhưng vào thẳng đúng khoảng ngày của khoảng ĐẦU TIÊN sẽ quét: trang tải xong là đúng ngày, khỏi đổi ngày trong trang (đổi ngày trong trang là lúc bảng Sản phẩm hay bị lỗi chỉ còn "1 trang")
function kaloLinkFor(job) {
  return job.link;   // Kalodata tính "Hôm qua" theo giờ của nó (lệch giờ máy, buổi sáng ở VN còn là ngày hôm trước bên đó) nên KHÔNG tự tính ngày vào link nữa: mở đúng link của sếp, rồi bấm nút ngày trong trang
  try {
    const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    const y = new Date(); y.setDate(y.getDate() - 1);
    const back = { "Hôm qua": 0, "7 ngày trước": 6, "30 ngày trước": 29 };
    const first = ["Hôm qua", "7 ngày trước", "30 ngày trước"].find((l) => (job.ranges || []).indexOf(l) >= 0);
    let a, b = iso(y);
    if (first) { const s0 = new Date(y); s0.setDate(s0.getDate() - back[first]); a = iso(s0); }
    else if (job.custom && job.custom.from && job.custom.to) { a = job.custom.from; b = job.custom.to; }
    else return job.link;
    const u = new URL(job.link);
    u.searchParams.set("dateRange", JSON.stringify([a, b]));
    return u.toString();
  } catch (e) { return job.link; }
}
async function kaloPoll() {
  const cfg = await khoCfg();
  if (!cfg.key) return;
  const r = await khoFetch(cfg, "/api/kalo");
  const j = r.job;
  if (!j || j.status !== "wait") return;
  if (j.nb && Date.now() / 1000 < j.nb) return;  // đang nghỉ giữa 2 kênh
  await khoPost(cfg, "/api/kalo", { progress: { status: "run", msg: "Đang mở Kalodata…", pct: 1 } });
  // Chrome đang thu nhỏ (nút _) thì phóng lại và đưa lên trước; không còn cửa sổ nào (Chrome chạy nền) thì mở cửa sổ mới
  const win = await qvRestoreWindow();
  // dùng lại đúng tab Kalodata đã mở cho đợt quét (đổi sang link kênh kế tiếp), không mở thêm mỗi kênh một tab
  try {
    const sv = (await chrome.storage.local.get("kaloTabId")).kaloTabId, id = kaloTab || sv;
    if (id) { const t0 = await chrome.tabs.get(id); if (t0 && /kalodata\.com/.test(t0.url || t0.pendingUrl || "")) { await chrome.tabs.update(id, { url: kaloLinkFor(j), active: true }); kaloTab = id; return; } }
  } catch (e) { /* tab cũ đã đóng: mở tab mới bên dưới */ }
  if (!win) {
    const nw = await chrome.windows.create({ url: kaloLinkFor(j), focused: true, state: "maximized" });
    kaloTab = nw.tabs && nw.tabs[0] ? nw.tabs[0].id : 0;
    try { await chrome.storage.local.set({ kaloTabId: kaloTab }); } catch (e) { /* bỏ qua */ }
    return;
  }
  const tab = await chrome.tabs.create({ windowId: win.id, url: kaloLinkFor(j), active: true });
  kaloTab = tab.id;
  try { await chrome.storage.local.set({ kaloTabId: tab.id }); } catch (e) { /* bỏ qua */ }
}
async function kaloMsg(msg, sender) {
  const cfg = await khoCfg();
  if (msg.type === "kalo_job_get") {  // kalodata.js hỏi: tab này có đang được giao việc không?
    if (!sender.tab) return { ok: true, job: null };
    const r = await khoFetch(cfg, "/api/kalo");
    const idOf = (u) => { try { return new URL(u).searchParams.get("id") || ""; } catch (e) { return ""; } };
    // nhận tab theo mã kênh trong link (không chỉ nhớ số tab: tiện ích tự tải lại hoặc ngủ thì số tab nhớ trong bộ nhớ mất, lượt quét sẽ không bao giờ dừng được)
    const mine = sender.tab.id === kaloTab || (r.job && r.job.link && idOf(r.job.link) && idOf(r.job.link) === idOf(sender.tab.url || ""));
    if (!mine) return { ok: true, job: null };
    if (sender.tab.id !== kaloTab) kaloTab = sender.tab.id;
    return { ok: true, job: r.job && r.job.status === "run" ? r.job : null };
  }
  if (msg.type === "kalo_stop_get") {  // bất kỳ tab Kalodata nào: bảng điều khiển đã bấm Dừng (hoặc lượt quét đã bị kết thúc) chưa?
    if (!sender.tab) return { ok: true, stop: false };
    const r = await khoFetch(cfg, "/api/kalo");
    const j = r.job;
    return { ok: true, stop: !!(j && (j.stop || (j.status !== "run" && j.status !== "wait"))) || !j };
  }
  if (msg.type === "kalo_dbg") { await khoPost(cfg, "/api/kalo", { jobdbg: msg.dbg }); return { ok: true }; }
  if (msg.type === "kalo_progress") { await khoPost(cfg, "/api/kalo", { progress: msg.p }); return { ok: true }; }
  if (msg.type === "kalo_put") { await khoPost(cfg, "/api/kalo", { put: msg.put }); return { ok: true }; }
  return { ok: false };
}
let khoLoopOn = false;
async function khoLoop() {
  if (khoLoopOn) return;
  khoLoopOn = true;
  try {
    for (;;) {
      const cfg = await khoCfg();
      if (!cfg.key) { await sleep(5000); continue; }
      if (khoBusy) { await sleep(1500); continue; }
      try {
        await khoLaunchCheck(cfg).catch(() => {});
        await appOpenPoll().catch(() => {});
        await kaloPoll().catch(() => {});
        await rivalPoll().catch(() => {});
        const r = await khoFetch(cfg, "/api/links?pending=1&wait=20");
        if (r.links.length) await khoPoll();
        else await khoState({ online: true, error: null, lastPoll: Date.now(), pending: 0 });
      } catch (e) {
        await khoState({ online: false, error: String(e.message || e), lastPoll: Date.now(), working: "" });
        await sleep(5000);
      }
    }
  } finally {
    khoLoopOn = false;
  }
}
chrome.alarms.create(KHO_ALARM, { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === KHO_ALARM) khoLoop(); });
// ---------------------------------------------------------------------------
// Chuột phải trên tiktoday.vn -> "Hiện QR TikTok Shop": hiện mã QR của link sản phẩm ở dòng đang bấm,
// quét bằng điện thoại là mở thẳng sản phẩm trong TikTok Shop. (tiktoday_qr.js ghi mã sản phẩm của dòng bấm.)
// ---------------------------------------------------------------------------
const QR_MENU_ID = "qv-shop-qr";
function ensureQrMenu() {
  try {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({ id: QR_MENU_ID, title: "📱 Hiện mã QR (quét bằng điện thoại)", contexts: ["all"], documentUrlPatterns: ["https://tiktoday.vn/*", "https://www.kalodata.com/*"] }, () => void chrome.runtime.lastError);
    });
  } catch (e) { /* đã có menu */ }
}
ensureQrMenu();

// Chạy TRONG trang TikToday (phải tự chứa): vẽ khung hiện QR, bấm ra ngoài / Esc để đóng.
function qrOverlayMain(items) {
  const old = document.getElementById("qv-qr-overlay");
  if (old) old.remove();
  const ov = document.createElement("div");
  ov.id = "qv-qr-overlay";
  ov.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;";
  const box = document.createElement("div");
  box.style.cssText = "background:#fff;color:#111;border-radius:14px;padding:16px 18px;max-width:92vw;max-height:90vh;overflow:auto;box-shadow:0 12px 40px rgba(0,0,0,.4);text-align:center;";
  const head = document.createElement("div");
  head.style.cssText = "font-weight:700;font-size:14px;margin-bottom:10px;";
  head.textContent = items.length ? "Quét QR bằng điện thoại để mở thẳng trên TikTok" : "Không tìm thấy sản phẩm / video ở chỗ vừa bấm";
  box.appendChild(head);
  if (!items.length) {
    const t = document.createElement("div");
    t.style.cssText = "font-size:12px;color:#555;max-width:280px;";
    t.textContent = "Bấm chuột phải thẳng vào một dòng sản phẩm hoặc video trong bảng rồi chọn lại.";
    box.appendChild(t);
  }
  const row = document.createElement("div");
  row.style.cssText = "display:flex;flex-wrap:wrap;gap:14px;justify-content:center;";
  items.forEach((it) => {
    const c = document.createElement("div");
    c.style.cssText = "width:220px;";
    if (it.img) {
      const im = document.createElement("img");
      im.src = it.img;
      im.style.cssText = "width:200px;height:200px;image-rendering:pixelated;";
      c.appendChild(im);
    } else {
      const n = document.createElement("div");
      n.style.cssText = "width:200px;height:200px;display:flex;align-items:center;justify-content:center;background:#eee;font-size:12px;margin:0 auto;";
      n.textContent = "Không tạo được QR (mất mạng?)";
      c.appendChild(n);
    }
    const tt = document.createElement("div");
    tt.style.cssText = "font-size:12px;margin-top:6px;line-height:1.35;";
    tt.textContent = it.title || it.id;
    c.appendChild(tt);
    const ln = document.createElement("a");
    ln.href = it.url;
    ln.target = "_blank";
    ln.rel = "noopener";
    ln.style.cssText = "font-size:10px;color:#2563eb;word-break:break-all;";
    ln.textContent = it.url;
    c.appendChild(ln);
    row.appendChild(c);
  });
  box.appendChild(row);
  const x = document.createElement("div");
  x.style.cssText = "font-size:11px;color:#777;margin-top:10px;";
  x.textContent = "Bấm ra ngoài hoặc Esc để đóng";
  box.appendChild(x);
  ov.appendChild(box);
  const close = () => { ov.remove(); document.removeEventListener("keydown", onKey, true); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
  document.addEventListener("keydown", onKey, true);
  document.body.appendChild(ov);
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== QR_MENU_ID || !tab || !tab.id) return;
  const r = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", func: () => window.__qvCtx || null }).catch(() => null);
  const ctx = r && r[0] ? r[0].result : null;
  const ids = ctx && Array.isArray(ctx.ids) ? ctx.ids.slice(0, 6) : [];
  const items = [];
  for (const p of ids) {
    const url = p.url || `https://www.tiktok.com/shop/vn/pdp/${p.id}`;
    let img = "";
    try {
      const res = await fetch(`https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=8&data=${encodeURIComponent(url)}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      img = "data:image/png;base64," + btoa(bin);
    } catch (e) { /* hiện khung không có ảnh */ }
    items.push({ id: p.id, title: p.title, url, img });
  }
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: qrOverlayMain, args: [items] }).catch(() => {});
});

chrome.runtime.onStartup.addListener(() => khoLoop());
chrome.runtime.onInstalled.addListener(() => { chrome.alarms.create(KHO_ALARM, { periodInMinutes: 0.5 }); khoLoop(); });
khoLoop();

// ---------------------------------------------------------------------------
// CẦU NỐI CANVAS (thêm 2026-10-16): canvas_bridge.js trong tab Canvas nhờ service worker này nói chuyện với bảng điều khiển.
// ---------------------------------------------------------------------------
function qvToB64(buf) {
  const u8 = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(bin);
}
async function qvHandle(msg, sender) {
  const cfg = await khoCfg();
  if (!cfg.key) throw new Error("chưa nhập mật khẩu bảng điều khiển trong tiện ích (trang Ảnh sản phẩm)");
  if (msg.type === "qv_next") {
    const tb = (sender && sender.tab) || {};
    return khoFetch(cfg, "/api/job_next?wait=" + (msg.quick ? 0 : 20) + "&fr=" + encodeURIComponent((sender && sender.frameId) || 0) + "&area=" + encodeURIComponent(msg.area || 0) + "&tab=" + encodeURIComponent(tb.id || "") + "&title=" + encodeURIComponent(tb.title || ""));
  }
  if (msg.type === "qv_job_done") return khoPost(cfg, "/api/job_done", { bid: msg.bid, ok: msg.ok, note: msg.note || "" });
  if (msg.type === "qv_notice") return khoPost(cfg, "/api/notice", { text: msg.text });
  if (msg.type === "qv_file") {
    const r = await fetch(cfg.url.replace(/\/+$/, "") + "/file?path=" + encodeURIComponent(msg.rel), { headers: { "X-Key": cfg.key } });
    if (!r.ok) throw new Error("bảng điều khiển trả mã " + r.status);
    return { ok: true, name: msg.rel.split("/").pop(), mime: r.headers.get("Content-Type") || "image/png", b64: qvToB64(await r.arrayBuffer()) };
  }
  if (msg.type === "qv_result") {
    const tbid = (sender && sender.tab && sender.tab.id) || "";
    const bin = atob(msg.b64), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return khoFetch(cfg, "/api/receive?pid=" + encodeURIComponent(msg.pid) + "&idx=" + encodeURIComponent(msg.idx) + "&ext=" + encodeURIComponent(msg.ext || ".png") + "&sha=" + encodeURIComponent(msg.sha || "") + "&people=" + (msg.people === 2 ? 2 : 1) + "&tab=" + encodeURIComponent(tbid), { method: "POST", body: u8 });
  }
  throw new Error("lệnh lạ");
}

// ---------------------------------------------------------------------------
// Nhận lệnh từ popup
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type && msg.type.indexOf("kalo_") === 0) {
    kaloMsg(msg, sender).then((r) => sendResponse(r)).catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
    return true;
  }
  if (msg.type && msg.type.indexOf("qv_") === 0) {
    qvHandle(msg, sender).then((r) => sendResponse(r)).catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
    return true;
  }
  if (msg.type === "scan_cart") {
    scanCart(msg.tabId, msg.fromMs).catch(() => {});
    sendResponse({ ok: true });
    return true;
  }
  if (msg.type === "kho_poll_now") {
    khoPoll().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === "fetch_images") {
    const ids = parseProductIds(msg.text);
    if (!ids.length) { sendResponse({ ok: false, error: "Không thấy mã sản phẩm trong các link." }); return true; }
    runImageJob(ids).catch(() => {});
    sendResponse({ ok: true, count: ids.length });
    return true;
  }
  if (msg.type === "resume_images") { imgResumeFlag = true; sendResponse({ ok: true }); return true; }
  if (msg.type === "stop_images") { imgStopRequested = true; imgResumeFlag = true; sendResponse({ ok: true }); return true; }
  if (msg.type === "track_products") {
    trackProducts(msg.ids).catch(() => {});
    sendResponse({ ok: true });
    return true;
  }
  if (msg.type === "stop_track") {
    trackStopRequested = true;
    sendResponse({ ok: true });
    return true;
  }
  if (msg.type === "import_product_list") {
    importProductList(msg.tabId).then(sendResponse).catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg.type === "stop_cart") {
    cartStopRequested = true;
    sendResponse({ ok: true });
    return true;
  }
  if (msg.type === "need_visible") {
    // Tab quet bi an (nguoi dung chuyen tab/cua so): keo len lai de TikTok tiep tuc tai video.
    if (sender.tab && sender.tab.id != null) {
      chrome.tabs.update(sender.tab.id, { active: true }).catch(() => {});
      if (sender.tab.windowId != null) chrome.windows.update(sender.tab.windowId, { focused: true }).catch(() => {});
    }
    return false;
  }
  if (msg.type === "scan_heartbeat") {
    // Tin nhan nay cung giu service worker khong bi tat giua luc cuon lau.
    updateScanState({ channelNote: `đã đọc ${msg.videos} video` + (msg.oldestMs ? `, tới ${fmtDate(msg.oldestMs)}` : "") + ` (cuộn ${msg.rounds} lần)` });
    return false;
  }
  if (msg.type === "start_scan") {
    chrome.storage.local.set({
      ["lastSettings" + sfxOf(msg.mode)]: {
        profiles: msg.profiles,
        fromDate: msg.fromDate,
        toDate: msg.toDate,
        threshold: msg.threshold,
      },
    });
    if (SCAN_BUSY) {
      chrome.storage.local.set({ ["scanState" + sfxOf(msg.mode)]: { running: false, done: false, error: "Đang có một phiên quét khác chạy (ở tab kia). Đợi xong hoặc bấm Dừng bên đó rồi quét lại." } });
      chrome.runtime.sendMessage({ type: "scan_progress", mode: msg.mode === "dance" ? "dance" : "rival", state: { running: false, error: "Đang có một phiên quét khác chạy (ở tab kia). Đợi xong hoặc bấm Dừng bên đó rồi quét lại." } }).catch(() => {});
    } else {
      runScan(msg).catch((err) => {
        updateScanState({ running: false, done: true, error: err.message });
      });
    }
    sendResponse({ ok: true });
  } else if (msg.type === "stop_scan") {
    stopRequested = true;
    sendResponse({ ok: true });
  } else if (msg.type === "set_auto_rescan") {
    const alarmName = AUTO_RESCAN_ALARM + (msg.mode === "dance" ? "_dance" : "");
    if (msg.hours && msg.hours > 0) {
      chrome.alarms.create(alarmName, { periodInMinutes: msg.hours * 60 });
    } else {
      chrome.alarms.clear(alarmName);
    }
    sendResponse({ ok: true });
  } else if (msg.type === "backup_now") {
    backupData()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // bat dong bo, giu channel mo cho sendResponse
  }
  return true;
});
