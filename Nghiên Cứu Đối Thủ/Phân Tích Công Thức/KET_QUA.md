# Kết quả phân tích 326 dòng (109 ngách, 8 ngành lớn) - ngày 05/10/2026

## Dữ liệu
- 326 dòng, 109 ngách con, 8 ngành lớn, không trùng mã sản phẩm. Mọi dòng cùng đợt cập nhật của Datangon (02:34 05/10/2026).
- Nhãn trong mẫu: Vào ngay 104, Đang hot 104, Né ra 77, Đang giảm 33, Theo dõi 8. (Ngách nào không có Né ra thì Datangon mở thay bằng Đang giảm hoặc Theo dõi.)
- Mỗi đường biểu đồ có đúng 5 điểm (cách đều nhau), trục y cao 24, chừa 2 ở trên và dưới (giá trị trong khoảng 2 đến 22).

## Phát hiện chính
1. **Mũi tên đơn quyết định rất mạnh.** Vào ngay: 104/104 là mũi tên tăng. Né ra, Đang giảm, Theo dõi: không dòng nào tăng. Đang hot: lẫn cả tăng (69) và giảm (35).
2. **Mức video trung bình** (trung bình 5 điểm của đường "Trend video", đảo trục để số lớn = nhiều video) tách rất rõ:
   - Vào ngay: trung vị 3,2 (ít video). Cao nhất 7,7.
   - Đang hot: trung vị 11,9 (nhiều video).
   - Né ra: trung vị 12,1 (nhiều video). Thấp nhất 6,7.
   - Đang giảm: trung vị 3,2 (ít video).
   Khớp với lời Datangon: Vào ngay = ít người làm; Đang hot, Né ra = cạnh tranh cao.
3. **Số đơn 30 ngày** tách Đang hot khỏi Né ra khi cả hai đều đơn giảm và nhiều video: Né ra thường dưới khoảng 3.000 đơn (tối đa 7.300), Đang hot thường từ 3.000 trở lên.
4. **14 dòng Đang giảm không có đơn nào** (Đơn 30N ghi "—").
5. Không phân biệt được nhãn: hoa hồng, điểm sao, % video mới, giá.

## Công thức nháp v1 (3 thứ: mũi tên đơn, mức video trung bình, số đơn)
- Nếu đơn 30N là "—" (không có đơn): **Đang giảm**
- Nếu mũi tên đơn **tăng**:
  - video ít (mức video TB < 7,25): **Vào ngay**
  - video nhiều: **Đang hot**
- Nếu mũi tên đơn **giảm**:
  - video nhiều: đơn >= 3.000 thì **Đang hot**, ngược lại **Né ra**
  - video ít: **Đang giảm**
- **Theo dõi** chưa có luật riêng (chỉ 8 mẫu).

## Độ đúng
- Trên cả 326 dòng: **91,4%** (3 nhãn chính: 94,0%).
- Thử chặt: chọn ngưỡng trên 4/5 số ngách rồi đoán 1/5 ngách còn lại: trung bình **89,9%**.
- Thử rất chặt: bỏ nguyên 1 ngành lớn ra ngoài (chọn ngưỡng trên 7 ngành còn lại, đoán ngành bị bỏ ra): **81% đến 100%**, đa số 85 đến 93%.
- Mô hình phức tạp hơn (rừng cây) đạt khoảng 96% cho 3 nhãn chính, cho thấy còn một chút thông tin ngoài 3 thứ trên (hình dáng đường đơn).

## Còn chưa chắc
- Mẫu bản dùng thử là 1 dòng cho mỗi nhãn mỗi ngách, nhiều khả năng là dòng đứng đầu: ta thấy mẫu điển hình, chưa thấy ranh giới thật.
- Hầu như không có mẫu Theo dõi, nên luật tách Theo dõi chưa có.
- Các ngưỡng 7,25 và 3.000 chỉ là gần đúng. Ngưỡng thật có thể tính theo từng ngách (so với các sản phẩm khác trong ngách) mà ta không thấy.
- Mũi tên có thể là so sánh số đơn 30 ngày gần nhất với 30 ngày trước đó, chưa được Datangon giải thích.

## Chạy lại
`python3 cong_thuc_v1.py` (cần pandas, numpy, openpyxl). Ra file `so-sanh-nhan-that-va-doan.xlsx`.
