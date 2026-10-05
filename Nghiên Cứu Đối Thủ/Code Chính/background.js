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
const MAX_SCROLL_ROUNDS = 6;

let stopRequested = false;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const { scanState } = await chrome.storage.local.get("scanState");
  const next = Object.assign({}, scanState || {}, patch);
  await chrome.storage.local.set({ scanState: next });
  chrome.runtime.sendMessage({ type: "scan_progress", state: next }).catch(() => {
    // Khong co popup nao dang mo de nhan - khong sao.
  });
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

async function sendScrapeMessage(tabId, maxAttempts) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, {
        type: "scrape_page",
        maxScrollRounds: MAX_SCROLL_ROUNDS,
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
}

// TikTok thỉnh thoảng tự lỗi "Something went wrong" ngay trên trang (lỗi
// phía TikTok) - F5 lại là hết, nên thử reload tối đa 2 lần nếu gặp.
async function scrapeChannelWithRetry(tabId) {
  let res = await sendScrapeMessage(tabId, 20); // cho content script san sang, toi da 10s
  let retry = 0;
  while (res.items.length === 0 && res.hadErrorText && !res.hasCaptcha && retry < 2) {
    await chrome.tabs.reload(tabId);
    await waitForTabComplete(tabId);
    res = await sendScrapeMessage(tabId, 20);
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
  const { videos } = await chrome.storage.local.get("videos");
  const store = videos || {};
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

  await chrome.storage.local.set({ videos: store });
}

// ---------------------------------------------------------------------------
// Vòng lặp quét chính
// ---------------------------------------------------------------------------
async function runScan({ profiles, fromDate, toDate, threshold }) {
  stopRequested = false;
  const fromMs = fromDate ? new Date(fromDate + "T00:00:00").getTime() : 0;
  const toMs = toDate ? new Date(toDate + "T23:59:59").getTime() : Date.now();

  let videosRead = 0;
  let clipsMatched = 0;
  let errorCount = 0;
  let zeroResultCount = 0;
  let captchaHit = false;

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
  });

  const tabId = await openScanTab();

  try {
    for (let i = 0; i < profiles.length; i++) {
      if (stopRequested) break;
      const username = profiles[i];

      await updateScanState({ currentIndex: i + 1, currentChannel: username });

      try {
        await gotoChannel(tabId, username);
        const res = await scrapeChannelWithRetry(tabId);

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

        if (res.items.length === 0) {
          errorCount += 1;
          zeroResultCount += 1;
          await updateScanState({
            errorCount,
            error: `Kênh @${username}: không đọc được video (riêng tư, không có video, hoặc sai tên).`,
          });
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

  const patch = { running: false, done: true, healthWarning };
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
  const data = await chrome.storage.local.get(["videos", "videosTrash", "channelAvatars", "channelFollowers"]);
  const payload = {
    exportedAt: new Date().toISOString(),
    videos: data.videos || {},
    videosTrash: data.videosTrash || {},
    channelAvatars: data.channelAvatars || {},
    channelFollowers: data.channelFollowers || {},
  };
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
  if (alarm.name === AUTO_RESCAN_ALARM) {
    chrome.storage.local.get("lastSettings").then(({ lastSettings }) => {
      if (lastSettings && lastSettings.profiles && lastSettings.profiles.length) {
        runScan(lastSettings).catch(() => {});
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Nhận lệnh từ popup
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "start_scan") {
    chrome.storage.local.set({
      lastSettings: {
        profiles: msg.profiles,
        fromDate: msg.fromDate,
        toDate: msg.toDate,
        threshold: msg.threshold,
      },
    });
    runScan(msg).catch((err) => {
      updateScanState({ running: false, done: true, error: err.message });
    });
    sendResponse({ ok: true });
  } else if (msg.type === "stop_scan") {
    stopRequested = true;
    sendResponse({ ok: true });
  } else if (msg.type === "set_auto_rescan") {
    if (msg.hours && msg.hours > 0) {
      chrome.alarms.create(AUTO_RESCAN_ALARM, { periodInMinutes: msg.hours * 60 });
    } else {
      chrome.alarms.clear(AUTO_RESCAN_ALARM);
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
