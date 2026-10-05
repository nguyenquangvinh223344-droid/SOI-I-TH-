# Nghiên Cứu Đối Thủ (Quangg Ving Scanner Pro)

Chrome Extension soi kênh đối thủ TikTok: quét danh sách video public của
các kênh bạn chọn, lọc theo ngày + ngưỡng view, theo dõi tốc độ tăng view
qua nhiều lần quét, tự gắn nhãn xu hướng (bùng nổ/chững), xem clip + xuất
Excel.

## Bộ lọc nâng cao + nút giải thích 📖 (thêm 2026-10-04)
- Ô Sắp xếp giờ có 5 lựa chọn, xếp theo mức hữu ích giảm dần: **Tốc độ
  tăng/ngày** (chuẩn nhất, quy đổi công bằng theo thời gian) → **Đột biến
  so với follower** (tìm kênh nhỏ đang nổ bất thường) → Tăng view cao nhất
  → Lượt view cao nhất → Ngày đăng mới nhất.
- Thêm ô lọc **XU HƯỚNG** (Tất cả / 🔥 / 📈 / 📉 / 🆕) cạnh ô Sắp xếp.
- Cột LINK CLIP thu gọn lại ("🔗 Mở") để nhường chỗ cho các cột LẦN 1-4 đỡ
  san sát.
- Nút **📖** cạnh "Sao lưu ngay" mở bảng giải thích ý nghĩa đầy đủ của cả
  5 cách sắp xếp lẫn 4 nhãn xu hướng — dành cho khách đọc nhanh hiểu ngay.

## Sáng/tối, chọn nhiều dòng, kéo chuột chọn (thêm 2026-10-04)
- Nút 🌙/☀️ góc phải (popup, dashboard, trang xem video) đổi theme — lưu
  chung 1 nơi nên đổi ở trang nào cũng áp dụng cho cả 3 trang.
- Dashboard: **Ctrl/Cmd+click** thêm/bớt 1 dòng vào danh sách đang chọn,
  **Shift+click** chọn cả khoảng giữa 2 lần click, **click thường** chỉ
  chọn đúng 1 dòng, **kéo chuột quét 1 vùng** chọn hết các dòng trong vùng
  đó (giống hệt Explorer). Khi có dòng được chọn, thanh "Đã chọn N dòng"
  hiện ra với nút xoá hết 1 lần vào thùng rác.

## Biểu đồ nhỏ, sao lưu, cảnh báo gãy (thêm 2026-10-04)
- **Biểu đồ nhỏ trong ô XU HƯỚNG**: tự vẽ theo đúng số liệu thật của từng
  video (Lần đầu → Lần 1-4), không phải hình trang trí cố định.
- **Sao lưu**: tự động sau mỗi lần quét thật (không đặt giờ cố định, vì máy
  tắt đúng giờ đó sẽ bị bỏ lỡ) + nút **"Sao lưu ngay"** bấm tay bất cứ lúc
  nào, cùng ghi đè vào đúng 1 file `Downloads\Nghiên Cứu Đối Thủ - Sao
  Lưu\Du Lieu Nghien Cuu Doi Thu.json` (không tích tụ nhiều file giống
  nhau). Nút **"Nhập file sao lưu"** đọc lại file đó, **gộp** vào dữ liệu
  hiện có (không xoá/ghi đè gì cả, giống tinh thần thùng rác).
- **Cảnh báo "TikTok có thể đã đổi giao diện"**: tự bật khi 1 lần quét thật
  có **quá nửa số kênh cùng lúc** ra 0 kết quả (không phải do 1-2 kênh lẻ
  sai tên/riêng tư) — hiện to rõ trong popup. Cách xử lý xem
  [[nghien-cuu-doi-thu-tool-maintenance]] (bộ nhớ của Claude, tự biết
  không cần giải thích lại).

## Cột LẦN ĐẦU + XU HƯỚNG (thêm 2026-10-04)
- **LẦN ĐẦU**: mốc view lúc tool **lần đầu tiên** phát hiện ra video này —
  cố định mãi mãi, không bao giờ bị thay đổi/xoá dù quét bao nhiêu lần đi
  nữa (khác với LẦN 1-4, là 4 lần quét **gần nhất**, bị đẩy dần khi quét
  tiếp). Tool lưu lại **toàn bộ** lịch sử quét (không giới hạn 4 lần như
  bản cũ) để LẦN ĐẦU luôn đúng là mốc thật đầu tiên, dù bạn quét nhiều lần
  trong 1 ngày.
- **XU HƯỚNG**: tự so tốc độ tăng của khoảng quét gần nhất với khoảng
  trước đó — tăng tốc rõ → 🔥 Đang bùng nổ; chậm lại/đứng yên → 📉 Đang
  chững; còn lại → 📈 Đang tăng đều; chưa đủ 2 lần quét → 🆕 Mới. Kèm theo
  % tăng tổng cộng so với LẦN ĐẦU. Nếu view hiện tại đã vượt **5 lần số
  follower của kênh đó**, tool ưu tiên gắn 🔥 luôn (dấu hiệu đột biến thật
  theo tiêu chí ngành TikTok affiliate — xem nguồn bên dưới).
- Nguồn tham khảo khi xây tiêu chí này: "velocity over total views" –
  nexscope.ai/blog/tiktok-shop-product-research-workflow;
  "view relative to follower count" – learningrevolution.net/how-many-views-is-viral.

## Cách cài (Load unpacked)
1. Mở Chrome, vào `chrome://extensions`.
2. Bật "Developer mode" (góc trên phải).
3. Bấm "Load unpacked", chọn thẳng folder `Code Chính\` (không phải folder
   mẹ "Nghiên Cứu Đối Thủ").
4. Nếu extension đã cài từ trước, chỉ cần bấm nút **reload** (vòng tròn mũi
   tên) trên thẻ extension sau mỗi lần code được cập nhật.

## Cách dùng
1. Bấm icon extension → dán link các kênh cần soi (mỗi dòng 1 link) — tool
   tự đếm số kênh và tự loại dòng trùng/sai ngay khi gõ.
2. Chọn khoảng ngày (mặc định: đầu tháng → hôm nay) + ngưỡng view →
   "Bắt đầu quét".
3. Quét chạy ở background, đóng popup vẫn chạy tiếp — mở lại popup để xem
   tiến độ bất cứ lúc nào (3 ô VIDEO ĐÃ ĐỌC / CLIP ĐẠT / LỖI).
4. "Dashboard" để xem bảng thống kê đầy đủ, lọc theo kênh, sắp xếp, xuất
   Excel. Bấm "Xem video" trên 1 clip để mở trang xem riêng (có clip
   trước/tiếp bằng phím ↑ ↓).
5. Quét lại cùng kênh nhiều lần (cách nhau vài giờ) để tool tự ghi nhận
   "Lần 1, Lần 2, Lần 3, Lần 4" và tính tốc độ tăng view — hoặc bật
   "Tự quét lại mỗi N giờ" trong popup để tool tự làm việc này.

## Cách lấy dữ liệu (đã test thật trên TikTok, 2026-10-04)
TikTok có 1 API nội bộ liệt kê video, nhưng **API đó yêu cầu "chữ ký" ẩn do
chính JS của TikTok tự sinh** — gọi từ ngoài (kể cả từ tab thật, có đăng
nhập) đều bị chặn, trả về rỗng (đã test thật, không phải đoán). Nên tool
không gọi API đó: `content.js` chạy sẵn trên mọi trang tiktok.com, khi
background.js mở 1 tab ẩn tới trang profile, nó nhờ `content.js` **đọc
thẳng dữ liệu đang hiển thị trên trang** (ảnh đại diện, link video, số view
hiển thị) và tự giải mã ngày đăng từ chính ID video (ID video TikTok có mã
hoá sẵn thời điểm đăng — đã test đối chiếu, khớp chính xác).

Lúc quét bạn sẽ thấy tab mới xuất hiện/biến mất liên tục, cuộn trang nhảy
nhanh — đó là bình thường (code cuộn kiểu nhảy thẳng xuống đáy để tải thêm
video, không phải cuộn mượt). TikTok thỉnh thoảng tự hiện lỗi "Something
went wrong" (lỗi của chính TikTok) — tool tự phát hiện và tự tải lại trang
khi gặp. Nếu TikTok hiện captcha, tool sẽ dừng hẳn phiên quét và báo trong
popup "Cần xử lý captcha rồi bấm Bắt đầu quét lại" — bạn tự vào tab đó giải
captcha rồi quét lại.

## Giới hạn thật cần biết
- **Số view là số rút gọn hiển thị trên trang** (vd "5M" có thể là
  4.5-5.49 triệu thật) — đủ để lọc/so sánh, không phải số tuyệt đối.
- **Không có số Tim/Bình luận/Chia sẻ ở bảng Dashboard** (TikTok chỉ hiện
  khi mở hẳn video) — nhưng trang **Xem video riêng** có đủ 3 số này, lấy
  qua dịch vụ ngoài TikWM lúc mở clip.
- **Mục "Sản phẩm trong clip"** luôn hiện "chưa lấy được" — đã kiểm tra
  trực tiếp dữ liệu TikWM trả về, họ không cung cấp thông tin giỏ
  hàng/sản phẩm qua API công khai này, không phải tool làm thiếu.
- **TikTok hay đổi cấu trúc trang** — tool dựa vào thuộc tính
  `data-e2e="user-post-item"`. Nếu TikTok đổi, tool đọc được 0 video — cần
  sửa lại code, không phải lỗi do dùng sai.
- Cào dữ liệu kiểu này **không phải tính năng chính thức TikTok cho phép
  dùng tự động** — rủi ro tài khoản/IP bị hạn chế nếu quét quá nhiều/nhanh.
  Tool tự giãn 2-5s giữa mỗi kênh để giảm rủi ro, không đảm bảo an toàn
  100%.
- Card "License/Device ID" trong popup là **demo cố định**, lưu trên máy,
  không nối server thật nào — chỉ để giữ đúng giao diện tham khảo.
- Dữ liệu lưu trong `chrome.storage.local` — gắn với **máy này + Chrome
  profile này**, gỡ extension hoặc xoá dữ liệu trình duyệt sẽ mất hết lịch
  sử theo dõi view.

## Cấu trúc
- `Code Chính\` — toàn bộ code extension:
  - `manifest.json`, `background.js` (điều phối quét, lịch tự quét lại)
  - `content.js` (chạy sẵn trên tiktok.com, đọc dữ liệu trang)
  - `popup.html/css/js`, `dashboard.html/css/js`, `viewer.html/css/js`
  - `libs\xlsx.full.min.js` (thư viện xuất Excel, để local vì Manifest V3
    không cho tải script từ CDN lúc chạy)
