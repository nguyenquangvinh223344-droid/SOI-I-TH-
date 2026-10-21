// CẦU NỐI giữa app Phối Đồ (đang chạy trong Canvas của Gemini) và bảng điều khiển trên laptop.
// Chạy trong khung Canvas, nhưng CHỈ hoạt động khi khung đó có app Phối Đồ (app tự đặt dấu #qv-app-marker).
// - Cứ 1,5 giây hỏi bảng điều khiển "có việc phối đồ mới không". Có thì lấy ảnh sản phẩm/model NGUYÊN BẢN,
//   thả vào app (không qua mạng ngoài, không nén).
// - Ảnh phối xong app đưa ra, cầu nối chuyển thẳng về thư mục MỚI PHỐI LUÔN SẾP!! trên laptop.
(function () {
  if (window.__qvBridge) return;
  window.__qvBridge = true;
  const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
  const bg = (msg) => new Promise((ok) => {
    try {
      chrome.runtime.sendMessage(msg, (r) => ok(r || { ok: false, error: (chrome.runtime.lastError && chrome.runtime.lastError.message) || "không phản hồi" }));
    } catch (e) { ok({ ok: false, error: String(e && e.message || e) }); }
  });
  const toApp = (o, transfer) => window.postMessage(Object.assign({ qvExt: true }, o), "*");

  // ----- app -> laptop -----
  window.addEventListener("message", async (ev) => {
    const d = ev.data;
    if (ev.source !== window || !d || !d.qvApp) return;
    if (d.type === "notice") { bg({ type: "qv_notice", text: d.text }); return; }
    if (d.type === "result") {
      try {
        const buf = await d.blob.arrayBuffer();
        const sha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buf))).slice(0, 4).map((x) => x.toString(16).padStart(2, "0")).join("");
        const b64 = await new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(",")[1]); fr.onerror = no; fr.readAsDataURL(new Blob([buf])); });
        const r = await bg({ type: "qv_result", pid: d.pid, idx: d.idx, ext: d.ext, sha, b64, people: d.people === 2 ? 2 : 1 });
        toApp({ type: "result_ack", pid: d.pid, idx: d.idx, ok: !!r.ok, error: r.error || "", size: buf.byteLength });
      } catch (e) {
        toApp({ type: "result_ack", pid: d.pid, idx: d.idx, ok: false, error: String(e && e.message || e) });
      }
    }
  });

  // ----- laptop -> app -----
  async function getFile(rel, name) {
    const r = await bg({ type: "qv_file", rel });
    if (!r.ok) throw new Error("không lấy được " + rel + ": " + r.error);
    const bin = atob(r.b64), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new File([u8], name || r.name, { type: r.mime });
  }
  async function deliver(batch) {
    try {
      const jobs = [];
      for (const j of batch.jobs) {
        const files = [];
        for (let i = 0; i < j.files.length; i++) {
          const rel = j.files[i], ext = (rel.match(/\.\w+$/) || [".jpg"])[0].toLowerCase();
          files.push(await getFile(rel, j.pid + "__" + j.kind + "__" + (i + 1) + ext));
        }
        jobs.push({ pid: j.pid, kind: j.kind, name: j.name, files, redo: j.redo || null });
      }
      let models = null;
      if (batch.models && batch.models.length) {
        models = [];
        // m = {rel, people} (bản mới) hoặc chuỗi (bản cũ). Số người đi kèm trong TÊN file ("1P__" / "2P__") để app gắn nhãn 1 người / 2 người cho ảnh.
        for (const m of batch.models) {
          const rel = typeof m === "string" ? m : m.rel, tag = (typeof m === "object" && m && m.people === 2) ? "2P__" : "1P__";
          models.push(await getFile(rel, tag + rel.split("/").pop()));
        }
      }
      toApp({ type: "job", bid: batch.bid, jobs, models, settings: batch.settings, once: !!batch.once, session: batch.session || "" });
      await bg({ type: "qv_job_done", bid: batch.bid, ok: true });
    } catch (e) {
      await bg({ type: "qv_notice", text: "❌ Không đưa được ảnh vào app Phối Đồ: " + (e && e.message || e) });
      await bg({ type: "qv_job_done", bid: batch.bid, ok: false, note: String(e && e.message || e) });
    }
  }
  async function loop() {
    toApp({ type: "hello" });
    let tick = 0, linked = false, lastErr = "", first = true;
    for (;;) {
      if (!document.getElementById("qv-app-marker")) return; // app đã biến mất (đổi trang)
      if (++tick % 20 === 0) toApp({ type: "hello" });
      const t1 = Date.now();
      try {
        const r = await bg({ type: "qv_next", quick: first, area: Math.round(window.innerWidth * window.innerHeight) });
        first = false;
        if (r && r.ok) {
          if (!linked || lastErr) { linked = true; lastErr = ""; toApp({ type: "link", ok: true }); }
          if (r.batch) await deliver(r.batch);
        } else {
          let msg = (r && r.error) || "không rõ";
          if (/context invalidated|receiving end|disconnected/i.test(msg)) msg = "tiện ích vừa được tải lại nên trang này mất kết nối với nó. Hãy F5 tab này (mở lại bản App Phối Đồ mới nhất)";
          if (msg !== lastErr) { lastErr = msg; linked = false; toApp({ type: "link", ok: false, error: msg }); }
        }
      } catch (e) { /* hỏi lại lần sau */ }
      // Bảng điều khiển giữ máy tới 20 giây rồi mới trả lời, nên bình thường không cần chờ thêm.
      // Chỉ nghỉ khi trả lời quá nhanh (lỗi / máy chủ bản cũ) để không hỏi dồn dập.
      const used = Date.now() - t1;
      if (used < 1500) await sleep(1500 - used);
    }
  }
  const t0 = Date.now();
  const look = setInterval(() => {
    if (document.getElementById("qv-app-marker")) { clearInterval(look); loop(); }
    else if (Date.now() - t0 > 20 * 60 * 1000) clearInterval(look);
  }, 800);
})();
