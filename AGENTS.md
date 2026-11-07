# Quy tắc Dự án Phim Ngắn Hồng Quả

## Tư liệu kiểm thử video và âm thanh

- Người dùng đã yêu cầu rõ ràng vào ngày 29-10-2026: Video kiểm thử phải được chọn ngẫu nhiên và tải về thực tế từ Phim Ngắn Hồng Quả; nghiêm cấm sử dụng video dải màu (color bars) để kiểm thử.
- Việc nghiệm thu phát video, hình trong hình (PiP), phát liên tục và tự động xóa phải sử dụng các tư liệu tải về thực tế nêu trên, không được thay thế bằng dải màu hay hình ảnh thử nghiệm.
- Quá trình kiểm thử phải tắt tiếng hoàn toàn, không được để video thử nghiệm phát ra âm thanh; trước khi bắt đầu phát phải xác nhận trạng thái tắt tiếng.
- Sử dụng dữ liệu kiểm thử và thư mục tải xuống độc lập. Tính năng tự động xóa chỉ áp dụng cho lượt tải kiểm thử hiện tại, không ảnh hưởng đến video, tài khoản hoặc lịch sử của ứng dụng chính thức.
- Ghi lại nguồn gốc tư liệu kiểm thử, các bước thực hiện, kết quả và hạn chế trong dự án; không được ghi lại thông tin đăng nhập hoặc địa chỉ media có chữ ký bảo mật.

## Phát hành 4.5

- Tính năng "Đổi lượt khác" trên trang Khám phá tuân theo phân trang thực tế của nguồn và phân loại hiện tại; không làm xáo trộn bảng xếp hạng của nguồn.
- Nhấp lặp lại vào các nút Phim người đóng, Hoạt hình, Phim AI và Thể loại cũng phải đổi lượt; chỉ 4 bảng xếp hạng phát sóng thịnh hành giữ nguyên thứ tự độ hot.
- Phát hành, xác minh và hạn chế của đợt này xem tại `docs/release-4.5.md`.

## 4.6 Phát hành

- Tự điều chỉnh bố cục cho 4K và cửa sổ rộng, không tự động phóng to giao diện theo độ phân giải.
- Tỷ lệ thu phóng mặc định 100%; chỉ lưu tùy chọn khi người dùng tự tay điều chỉnh. Kích thước áp phích được lưu riêng biệt.
- Phát hành, xác minh và hạn chế của đợt này xem tại `docs/release-4.6.md`.

## 4.7 Phát hành

- Khôi phục tải xuống dựa trên trạng thái tác vụ thực tế; thử lại thủ công cho phép gửi lại, khôi phục tự động duy trì cơ chế chống lặp vô hạn.
- Cửa sổ hình trong hình tích hợp hiển thị và tập trung tiêu điểm ở góc dưới bên phải màn hình chứa cửa sổ chính; luồng media cục bộ hỗ trợ hủy và kéo tua.
- Phát hành, xác minh và hạn chế của đợt này xem tại `docs/release-4.7.md`.

## 4.8 Phát hành

- Tự động phát trực tuyến thử lần lượt theo giới hạn: 1080P, 720P, nguồn tương thích; giữ nguyên tiến độ phát và trạng thái tạm dừng; cố định chất lượng thủ công không tự động hạ cấp.
- Vấn đề giải mã giữ nguyên chuyển mã tương thích của chất lượng hiện tại và một lần tái tạo bộ nhớ đệm, sau đó mới thử mức chất lượng thấp hơn; chuyển tập và thử lại thủ công ưu tiên lại 1080P.
- Phát hành, xác minh và hạn chế của đợt này xem tại `docs/release-4.8.md`.

## Mục tiêu phát hành 4.9

- Tích hợp ưu tiên phát H.264 cho máy tính đời cũ và sửa lỗi giữ biểu tượng Dock trên Mac; không thay đổi loại tiến trình của toàn bộ ứng dụng để cửa sổ nhỏ hiển thị xuyên màn hình nền.
- Bản 4.9 đã chính thức phát hành; tải về chính thức, kiểm thử và hạn chế xem tại tài liệu phát hành bên dưới.
- Phát triển, xác minh và hạn chế xem tại `docs/release-4.9.md`.

## Phát hành 5.0

- Phạm vi phát hiện lịch sử xem và tùy chọn ẩn các phần thấp hơn cùng bộ phim được lưu vĩnh viễn.
- Phân nhóm rõ ràng theo số phần; các mối quan hệ mơ hồ chỉ đưa ra gợi ý, không đưa vào danh sách ẩn, gom nhóm hàng loạt, chấm đỏ hay thông báo hệ thống.
- Bản 5.0 đã chính thức phát hành; tải về chính thức, xác minh và hạn chế xem tại `docs/release-5.0.md`.

## Phát hành 5.1

- Chuyển "Tài khoản Hồng Quả" xuống dưới "Quản lý tải xuống"; "Cài đặt" giữ lại ở dưới cùng.
- Mô tả cập nhật bên ngoài: Đã sửa các sự cố đã biết.
- Bản 5.1 đã chính thức phát hành; tải về chính thức, xác minh và hạn chế xem tại `docs/release-5.1.md`.

## Phát hành 5.2

- macOS chỉ khôi phục vị trí, kích thước và màn hình hiển thị của cửa sổ chính thông thường; các trạng thái đặc biệt không ghi đè bản ghi cửa sổ thông thường, khởi động luôn là cửa sổ thông thường.
- Khi thiếu màn hình ban đầu sẽ sử dụng vị trí và kích thước mặc định; khi vùng khả dụng của màn hình bị thu nhỏ sẽ ràng buộc cửa sổ nằm trong màn hình.
- Bản 5.2 đã chính thức phát hành; tải về chính thức, xác minh và hạn chế xem tại `docs/release-5.2.md`.

## Phát hành 5.3

- Tải xuống NAS sử dụng trực tiếp thư mục chia sẻ đã mount do người dùng chọn, video, ảnh bìa, tóm tắt và tệp NFO được lưu cùng cấp.
- Chuẩn hóa quy tắc đặt tên tập phim, tái sử dụng an toàn video đã có, bổ sung dữ liệu còn thiếu, không ghi đè tệp xung đột. Video trực tiếp trên NAS bỏ qua tính năng tự động xóa sau khi xem xong.
- Bản 5.3 đã chính thức phát hành; chưa thay thế bản cài đặt chính thức trên máy.
- Phát hành, xác minh và hạn chế xem tại `docs/release-5.3.md`.

## Phát hành 5.4

- Yêu cầu mô hình phát được ký theo host cuối cùng, query, body POST và dấu thời gian; tính lại chữ ký sau khi thử lại hoặc cập nhật thiết bị.
- Bản 5.4 đã chính thức phát hành; xác minh tải về/giải mã thực tế, xử lý lỗi gián đoạn và phát hành đa nền tảng xem tại `docs/release-5.4.md`.

## Quy tắc không tự tải

- Người dùng yêu cầu rõ ràng (3-11-2026): cấm tải về nếu không được sự cho phép của người dùng. Mọi lượt tải, tiếp tục hoặc thử lại chỉ bắt đầu khi người dùng bấm.
- Không tự thử lại sau lỗi, không tự tiếp tục khi khởi động lại ứng dụng, không tự đưa tập vào hàng đợi khi phát trực tuyến lỗi. Tác vụ lỗi hoặc dở dang giữ trạng thái dừng/lỗi chờ người dùng.
- Kiểm tra bằng scripts/check-source-retry.cjs, check-player-fallback.cjs và check-player-online-quality.cjs.
