// Mở lần lượt từng trang sản phẩm (tab nền), chờ trang đọc xong rồi đóng, nghỉ vài giây.
let stopFlag = false, running = false;
const waiters = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitDone(tabId, ms) {
  return new Promise((resolve) => {
    const t = setTimeout(() => { delete waiters[tabId]; resolve(false); }, ms);
    waiters[tabId] = () => { clearTimeout(t); delete waiters[tabId]; resolve(true); };
  });
}

async function runQueue(urls, originTabId) {
  if (running) return;
  running = true; stopFlag = false;
  let ok = 0, fail = 0;
  for (let i = 0; i < urls.length; i++) {
    if (stopFlag) break;
    let tab = null;
    try {
      tab = await chrome.tabs.create({ url: urls[i] + "#dgauto", active: false });
      const done = await waitDone(tab.id, 30000);
      done ? ok++ : fail++;
    } catch (e) { fail++; }
    if (tab) { try { await chrome.tabs.remove(tab.id); } catch (e) {} }
    try { await chrome.tabs.sendMessage(originTabId, { type: "detail_progress", i: i + 1, n: urls.length, ok, fail }); } catch (e) {}
    if (i < urls.length - 1 && !stopFlag) await sleep(2500 + Math.random() * 3500);
  }
  running = false;
  try { await chrome.tabs.sendMessage(originTabId, { type: "detail_finished", ok, fail, stopped: stopFlag }); } catch (e) {}
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "scan_details") { runQueue(msg.urls, sender.tab.id); sendResponse({ ok: true }); }
  else if (msg.type === "stop_details") { stopFlag = true; sendResponse({ ok: true }); }
  else if (msg.type === "detail_done" && sender.tab && waiters[sender.tab.id]) { waiters[sender.tab.id](); sendResponse({ ok: true }); }
  return true;
});
