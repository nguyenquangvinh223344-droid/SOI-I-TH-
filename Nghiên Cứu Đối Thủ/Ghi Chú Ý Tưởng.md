# Ghi chú ý tưởng (lưu tạm, bàn sau)

Ngày: 05/10/2026. Chưa sửa gì trong `Code Chính/`.

## A. Ý tưởng nâng cấp công cụ bằng Tiktoday.vn

Mục đích thật: tìm sản phẩm đáng gắn vào hệ thống AI để làm video affiliate. Soi video chỉ là phương tiện.

Luồng mới:
1. Tìm kênh vàng từ danh sách nhà sáng tạo của Tiktoday theo bộ lọc đã lưu, giữ khoảng 20 kênh.
2. Quét video mới của từng kênh (1-2 trang mới nhất): sản phẩm gắn kèm, view, thích, bình luận, chia sẻ.
3. Theo dõi tăng trưởng view qua các lần quét (giữ phần công cụ cũ).
4. Gom theo sản phẩm, chấm điểm.
5. Một màn hình "Sản phẩm win hôm nay", mỗi sản phẩm có lý do và nhãn "nổ nhờ đâu".

Tiêu chí gợi ý (chỉnh được sau):
- Kênh vàng: doanh số / người theo dõi; doanh số mỗi video; bán qua video >= 80%; người theo dõi mới đang tăng; hoa hồng trung bình >= 5%.
- Video: có gắn sản phẩm; view >= 10 nghìn; tăng view giữa các lần quét; view >= 5 lần người theo dõi; bình luận và chia sẻ trên mỗi view; đăng dưới 3 ngày mà đã nổ thì nóng nhất.
- Sản phẩm: số video nổ cùng gắn; số kênh khác nhau cùng bán (>= 2); lượt bán thật; giá và hoa hồng; còn mới hay đã cũ.

Nhãn "nổ nhờ đâu" (chỉ là đoán từ số liệu, công cụ không xem được nội dung video): nổ nhờ sản phẩm / nội dung hoặc thời điểm / kênh lớn / gây tò mò (chia sẻ cao) / đáng mua (bình luận cao) / khán giả hợp (tab Khán giả).

Thứ tự làm: bản 1 (tìm kênh, quét, gom, chấm điểm) -> bản 2 (nhãn nổ nhờ đâu, tab Sản phẩm) -> bản 3 (xuất đúng dạng hệ thống AI cần).

Cần chốt: ngưỡng 10 nghìn view và 5% hoa hồng; hệ thống AI nhận sản phẩm bằng link, tên hay ảnh; quét chỉ từ danh sách hay mở từng kênh.

Quan sát từ Tiktoday: kênh vàng có thể view video rất thấp (vài chục đến vài trăm) mà vẫn bán hàng trăm triệu, nên không chỉ lọc theo view.

Lưu ý: Tiktoday có thể không thích việc tự đọc hàng loạt, nên đọc ít trang, có nghỉ.

## B. Datangon (datangon.com), tóm tắt người dùng gửi

Web tiếng Việt cho người làm affiliate TikTok Shop: liệt kê sản phẩm theo ngành, mỗi sản phẩm gắn nhãn hành động.

Năm nhãn: Vào ngay (xanh lá), Đang hot (cạnh tranh cao), Né ra (đỏ), Theo dõi, Đang giảm.

Cột mỗi sản phẩm: đơn 30 ngày (kèm mũi tên), đã bán, xu hướng đơn, % video mới 30 ngày, xu hướng video 90 ngày, GMV 30 ngày, hoa hồng, view 30 ngày. Cập nhật hàng ngày.

"Hệ thống đề xuất": tải file Excel đơn hàng của kênh (Affiliate Center) lên, app phân nhóm sản phẩm chủ lực, dựng chân dung khách, gợi ý sản phẩm mới kèm điểm và lý do, đối chiếu sản phẩm đang bán xem cái nào sắp chết.

Chưa biết: công thức gắn nhãn, nguồn dữ liệu, cách thu thập, giá gói. Các ngưỡng nhãn do công cụ AI khác đưa ra không khớp ảnh thật, không dùng làm sự thật. Ngưỡng nhãn nên đặt trong file cấu hình để chỉnh được.

Đối sánh: Datangon mạnh ở cấp sản phẩm; công cụ của mình mạnh ở cấp kênh và video, theo dõi tăng trưởng.

## C. Định nghĩa chính thức Datangon tự ghi (tooltip, ảnh người dùng chụp 05/10/2026)

- Xu hướng: "Nhãn đánh giá cơ hội của sản phẩm dựa trên dữ liệu bán thật:
  Vào ngay (cơ hội mới mở, ít người bán) · Đang hot (bán chạy nhưng cạnh tranh cao) ·
  Né ra (quá nhiều người bán, lãi/creator đã mỏng) · Theo dõi (ổn định, chưa rõ tăng/giảm) ·
  Đang giảm (đang ế)."
- Đã bán: tổng cộng dồn từ khi lên sàn (trọn đời), KHÁC "đơn 30n" (chỉ 30 ngày gần đây).
- Trend đơn: biểu đồ tốc độ bán theo thời gian, từ ~90 ngày trước. (Trend video cũng 90 ngày.)
- Video mới: % video gắn sản phẩm đăng trong 30 ngày qua trên tổng số video từ trước tới nay.
  Cao = creator đang tích cực làm nội dung mới.

Hệ quả cho việc tìm công thức: nhãn dựa vào MỨC CẠNH TRANH (số người bán / số creator) và
LÃI TRÊN MỖI CREATOR, nhưng Datangon KHÔNG hiện hai số đó. Cần lấy số nhà sáng tạo từ
nguồn khác (điện thoại TikTok Shop, Tiktoday, Kalodata) cho cùng sản phẩm để thử.
Dữ liệu điện thoại đã thấy: Vào ngay có 111-184 creator/7 ngày, Đang hot có 23,9K.

Kế hoạch thu thập (người dùng chốt): không bấm 5 nhãn; đi từng ngành lớn -> từng ngách con,
mỗi ngách chép 3 dòng mở (Vào ngay, Đang hot, Né ra). Quét hết một vòng trong ~30 phút.

Bổ sung tooltip (ảnh gửi thêm):
- Trend video: biểu đồ SỐ LƯỢNG video mới gắn sản phẩm theo thời gian, trong 90 ngày.
- GMV 30N: tổng doanh thu bán ra 30 ngày gần nhất, đo trên các video viral, KHÔNG có live
  và mua trực tiếp qua product showcase. (Khác "doanh thu tổng" của Kalodata.)
- %HH: % hoa hồng affiliate creator nhận cho mỗi đơn qua link gắn sản phẩm. Càng cao càng đáng làm nội dung.
- Chưa có tooltip của cột "Đơn 30N" (cần chụp thêm).

Ý nghĩa: các cột Datangon hiện (video mới %, trend video) đo mức tham gia làm video, tức là
một cách đo cạnh tranh nhìn thấy được; có thể nhãn tính từ chúng, không cần số creator.
Vẫn còn chưa giải thích: con dép Vào ngay, Datangon GMV 1,2 tỷ nhưng Kalodata doanh thu
từ video chỉ 590K (30 ngày).
