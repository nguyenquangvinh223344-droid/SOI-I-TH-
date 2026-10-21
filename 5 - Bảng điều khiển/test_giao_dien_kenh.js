// Kiểm thử giao diện Giai đoạn A (cần: npm i playwright; Chrome). Chạy: node test_giao_dien_kenh.js <cổng> <mật khẩu> <thư mục kho TẠM> <thư mục lưu ảnh chụp>
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const [, , PORT, KEY, KHO, OUT] = process.argv;
const ok = (c, m) => { console.log((c ? 'ĐẠT  ' : 'HỎNG ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', (e) => errs.push(String(e))); pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.goto(`http://localhost:${PORT}/?key=${KEY}`);
  await pg.waitForFunction(() => typeof KENH !== 'undefined' && KENH.length === 3, null, { timeout: 15000 });
  ok(true, 'trang lấy được danh sách kênh từ server: ' + await pg.evaluate(() => KENH.join(', ')));
  // 1) khóa bảo vệ
  const lk = await pg.evaluate(() => { const O = '2 - ĐÃ PHỐI ĐỒ XONG', P = '3 - KHO MODEL/1 - LẤY MODEL NÀY', V = '4 - KHO VIDEO MẪU'; const l = []; KENH.forEach((k) => { l.push(O + '/' + k, O + '/' + k + '/1 MODEL', O + '/' + k + '/2 MODEL/1 - MỚI PHỐI LUÔN SẾP!!', P + '/' + k, P + '/' + k + '/1 MODEL', P + '/' + k + '/2 MODEL', V + '/2 - VIDEO MOTION CONTROL ĐÃ XONG/' + k, V + '/3 - ĐÃ ĐĂNG/' + k); }); return l.filter((x) => !LOCKED.has(x)); });
  ok(lk.length === 0, 'mọi thư mục KENH_x đều bị khóa bảo vệ' + (lk.length ? ' — thiếu: ' + lk.join(' | ') : ''));
  // 2) thư mục kênh hiện đúng
  await pg.evaluate(() => go('2 - ĐÃ PHỐI ĐỒ XONG'));
  await pg.waitForFunction(() => /KENH_3/.test(document.querySelector('#main').textContent), null, { timeout: 8000 });
  const names = await pg.evaluate(() => document.querySelector('#main').textContent);
  ok(/KENH_1/.test(names) && /KENH_2/.test(names) && /KENH_3/.test(names), 'trong "2 - ĐÃ PHỐI ĐỒ XONG" thấy 3 thư mục kênh');
  await pg.waitForTimeout(900); await pg.screenshot({ path: path.join(OUT, 'a1_thu_muc_kenh.png') });
  // 3) chọn model vào kênh 2
  await pg.evaluate(() => go('3 - KHO MODEL/1 - LẤY MODEL NÀY/KENH_2'));
  await pg.waitForTimeout(600);
  ok(await pg.evaluate(() => !isPickFolder()), 'thư mục "KENH_2" (cha) KHÔNG phải ô chọn model');
  await pg.evaluate(() => go('3 - KHO MODEL/1 - LẤY MODEL NÀY/KENH_2/1 MODEL'));
  await pg.waitForSelector('#bImg', { timeout: 8000 });
  ok(await pg.evaluate(() => isPickFolder() && pickInfo(cur).kenh === 'KENH_2' && pickInfo(cur).lane === '1'), 'hiểu "LẤY MODEL NÀY/KENH_2/1 MODEL" là ô chọn model của KENH_2');
  await pg.click('#bImg');
  await pg.waitForSelector('#mdMenu', { timeout: 4000 });
  ok(true, 'bấm nút thêm ảnh -> hiện menu "Tải từ kho model / Tải từ máy"');
  await pg.click('#mdMenu button[data-o="store"]');
  await pg.waitForSelector('#mdPick .mt', { timeout: 8000 });
  const head = await pg.textContent('#mdPick .mph');
  ok(/KENH_2 › 1 MODEL/.test(head), 'hộp chọn model ghi đích: ' + head.replace(/\s+/g, ' ').trim());
  await pg.screenshot({ path: path.join(OUT, 'a2_chon_model_kenh2.png') });
  await pg.click('#mdPick .mt:not(.dis)');
  await pg.click('#mpOk');
  await pg.waitForSelector('#mdPick', { state: 'detached', timeout: 8000 }).catch(() => {});
  await pg.waitForTimeout(800);
  const dir = path.join(KHO, '3 - KHO MODEL', '1 - LẤY MODEL NÀY', 'KENH_2', '1 MODEL');
  const got = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => !f.startsWith('.')) : [];
  ok(got.length === 1, 'ảnh model được sao chép đúng vào KENH_2/1 MODEL trên đĩa: ' + got.join(', '));
  const k1 = path.join(KHO, '3 - KHO MODEL', '1 - LẤY MODEL NÀY', 'KENH_1', '1 MODEL');
  ok(fs.readdirSync(k1).filter((f) => !f.startsWith('.')).length === 1, 'KENH_1/1 MODEL vẫn chỉ có ảnh cũ (không bị lẫn)');
  await pg.screenshot({ path: path.join(OUT, 'a3_sau_khi_chon.png') });
  // 4) kho thật không lỗi trang
  await pg.evaluate(() => go(''));
  await pg.waitForTimeout(600);
  ok(errs.length === 0, 'không có lỗi JavaScript trên trang' + (errs.length ? ': ' + errs.slice(0, 3).join(' || ') : ''));
  await b.close();
})().catch((e) => { console.log('HỎNG  ' + e.message); process.exit(1); });
