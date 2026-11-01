# Hệ thống Thiết kế Phim Ngắn Hồng Quả (Design System)

Phiên bản mã nguồn áp dụng: 5.3. Các quy chuẩn thị giác và tương tác sản phẩm tuân theo các quy định dưới đây; khi tìm kiếm trên trang web chính thức không có kết quả trùng tên, hệ thống sẽ tự động tìm kiếm bổ sung từ danh mục phim mới trên App, kết quả được gắn nhãn "Hôm nay mới lên" / "Phim mới trên App". Tuyến danh mục Khám phá và Thịnh hành tái sử dụng bộ chọn hiện có, ghi nhớ độc lập trên cả hai trang, tự động xuống dòng trên cửa sổ hẹp. Khi lỗi vẫn giữ lại danh sách phim cũ, trạng thái phân trang nhất quán với nội dung thực tế; hộp thoại chọn tập ưu tiên hiển thị nhanh, các yêu cầu chậm được thử lại song song. Thanh điều khiển phát cung cấp lối vào hình trong hình (PiP) gốc của hệ thống, phát nổi dùng chung phần tử video duy nhất, không tải lại lặp lại. Quản lý đăng nhập tách thành trang độc lập, lịch sử xem trên APP không trộn lẫn vào trang lịch sử xem cục bộ gốc; chỉ các bản ghi trong Quản lý đăng nhập mới có thể tiếp tục phát trực tiếp. Trạng thái phát hành và nghiệm thu thực tế xem tại `docs/release-5.3.md`.

## Direction
Lấy thư viện đa phương tiện macOS làm chuẩn mực. Nội dung là chính, thao tác là phụ; thanh bên màu xám ấm nhạt và vùng nội dung màu trắng tạo nên một cửa sổ liền mạch, màu đỏ san hô chỉ dùng cho trạng thái lựa chọn và hành động chính. Đây là định hướng thiết kế đã được xác định, thay thế cho thanh bên tối màu và các khối quảng cáo chuyển màu trước đây.

## Tokens
- Canvas `#faf9f7`, sidebar `#f0eeeb`, surface `#ffffff`.
- Chữ chính `#252523`, chữ phụ `#686661`, chữ mờ `#77736c`.
- Màu nhấn (Accent) `#c8383d`, hover `#ae2b31`, vùng chọn `#fae9e7`.
- Thành công `#33745c`, cảnh báo/nguy hiểm `#ba3438`, đường viền `#e4e1dc`.
- Phông chữ: macOS system UI / SF Pro / PingFang SC, Windows dự phòng Segoe UI / Microsoft YaHei. Kiểu chữ nguyên bản là lựa chọn rõ ràng của từng nền tảng. Tiêu đề 28px/700, nội dung 13px/400, nhãn 12px/500, chú thích 11px.
- Khoảng cách: 4/8/12/16/20/24/32px; nội dung chính đệm ngang 36px.
- Thanh bên 214px, thanh công cụ 48px; góc trên bên trái macOS chừa 58px cho các nút đèn giao thông (traffic lights).
- Bo góc bộ điều khiển 7–9px; áp phích (poster) 12px; bảng trượt 16px. Dùng đường viền hoặc đổ bóng nổi, không dùng cả hai.

## Surfaces
- **Khám phá phim ngắn**: Phân loại và thể loại nằm phía trên áp phích; áp phích tỷ lệ 3:4 thể hiện trực tiếp nội dung thực tế. Khi không có kết quả cung cấp nút tải lại và tìm kiếm; khi đang tải sử dụng khung giữ chỗ đúng tỷ lệ, không tạo danh sách phim giả lập.
- **Tìm kiếm và tải về**: Bộ chọn phân đoạn giữa tìm kiếm từ khóa / liên kết; kết quả, chọn tập và gửi tải tạo thành một luồng tác vụ liền mạch.
- **Quản lý tải xuống**: Các thao tác chính luôn hiển thị, bảo trì hàng loạt thu gọn vào menu mở rộng gốc; danh sách hiển thị dưới dạng các hàng nhỏ gọn chứ không xếp chồng thẻ.
- **Kho phim của tôi**: Sân khấu video màu than đậm giữ lại các nút điều khiển media, giao diện xung quanh dùng cùng hệ thống màu sáng.
- **Cài đặt**: Gom nhóm theo chiều dọc, lưu cấu hình thực tế và kiểm tra proxy, tránh xếp chồng các thuật ngữ kỹ thuật phức tạp.

## Interaction
Tất cả các mục điều hướng và áp phích đều là nút bấm; trạng thái lựa chọn có hiệu ứng pressed; ô nhập liệu có nhãn rõ ràng; tiêu điểm (focus) hiển thị trực quan. Hộp thoại hỗ trợ phím Escape, lặp Tab và khôi phục tiêu điểm. Tôn trọng chế độ giảm chuyển động (reduced motion). Các tính năng phát thực tế, tải xuống, gộp phim và lưu trữ dữ liệu tuân theo API nguyên bản.

## Verification boundary
Sau khi triển khai mã nguồn hoàn tất, ứng dụng được build thống nhất và kiểm tra trên cửa sổ thực tế; tài liệu này không đại diện cho việc nghiệm thu dịch vụ từ xa, tải xuống hoặc phát video.
