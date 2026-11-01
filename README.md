<p align="center">
  <img src="build/icon.png" alt="Biểu tượng Phim Ngắn Hồng Quả cho máy tính để bàn" width="112" height="112">
</p>

<h1 align="center">Phim Ngắn Hồng Quả · Bản Máy Tính Để Bàn</h1>

<p align="center">Khám phá phim hay, tiếp tục xem từ lần trước. Tìm kiếm, phát trực tuyến, tải xuống, theo dõi và gộp xuất phim trong cùng một ứng dụng máy tính tiện lợi.</p>

<p align="center">
  <a href="https://github.com/jackotom/hongguo-drama/releases/latest"><img alt="Phiên bản công khai mới nhất" src="https://img.shields.io/github/v/release/jackotom/hongguo-drama?style=flat-square"></a>
  <img alt="macOS 13 trở lên" src="https://img.shields.io/badge/macOS-13%2B-555555?style=flat-square">
  <img alt="Mac chip M, Intel Mac và Windows x64" src="https://img.shields.io/badge/platforms-Mac_arm64_%2F_x64_%C2%B7_Windows_x64-55746b?style=flat-square">
  <a href="LICENSE"><img alt="Giấy phép GPL-3.0" src="https://img.shields.io/badge/license-GPL--3.0-555555?style=flat-square"></a>
</p>

<p align="center">
  <a href="#tải-về-và-cài-đặt"><strong>Tải về và cài đặt</strong></a> ·
  <a href="#tính-năng-đầy-đủ">Tính năng đầy đủ</a> ·
  <a href="#giao-diện-và-minh-họa">Giao diện và minh họa</a> ·
  <a href="#câu-hỏi-thường-gặp">Câu hỏi thường gặp</a> ·
  <a href="https://github.com/jackotom/hongguo-drama/issues">Phản hồi sự cố</a>
</p>

## Tải về và cài đặt

**Phiên bản chính thức hiện tại: 5.3** (nội bộ `5.3.0`). Bổ sung tải xuống NAS, lưu ảnh bìa, tóm tắt và NFO cùng cấp, quy chuẩn đặt tên tập phim và tự động tái sử dụng bổ sung. Bản Mac kép đã ký, chứng thực (Notarized) và staple; tệp EXE Windows chưa ký số. Chi tiết xem [Thuyết minh 5.3](docs/release-5.3.md).

| Thiết bị | Tải về 5.3 | Cách cài đặt |
|---|---|---|
| Apple Silicon Mac (M series), macOS 13+ | [Tải DMG](https://github.com/jackotom/hongguo-drama/releases/download/v5.3/Hongguo-5.3-mac-arm64.dmg) | Mở DMG, kéo vào "Applications" rồi khởi chạy; hỗ trợ cập nhật trong ứng dụng sau này |
| Intel Mac, macOS 13+ | [Tải DMG](https://github.com/jackotom/hongguo-drama/releases/download/v5.3/Hongguo-5.3-mac-x64.dmg) | Mở DMG, kéo vào "Applications" rồi khởi chạy; hỗ trợ cập nhật trong ứng dụng sau này |
| Windows x64 (Khuyên dùng bản cài đặt) | [Tải bản cài đặt EXE](https://github.com/jackotom/hongguo-drama/releases/download/v5.3/hongguo-downloader-5.3-win-x64-setup.exe) | Cài đặt theo hướng dẫn, hỗ trợ cập nhật trong ứng dụng sau này |
| Windows x64 (Bản di động Portable) | [Tải EXE Portable](https://github.com/jackotom/hongguo-drama/releases/download/v5.3/hongguo-downloader-5.3-win-x64.exe) · [Tải ZIP Portable](https://github.com/jackotom/hongguo-drama/releases/download/v5.3/hongguo-downloader-5.3-win-x64.zip) | Chạy trực tiếp tệp EXE; bản ZIP giải nén rồi chạy chương trình, cập nhật sau này cần thay thế thủ công |

[Xem bản phát hành chính thức mới nhất](https://github.com/jackotom/hongguo-drama/releases/latest) · [Thuyết minh cập nhật 5.3 và mã nguồn](https://github.com/jackotom/hongguo-drama/releases/tag/v5.3) · [Tệp kiểm tra SHA256](https://github.com/jackotom/hongguo-drama/releases/download/v5.3/SHA256SUMS.txt)

- **Nâng cấp lên 5.3**: Bản cài đặt 5.2 có thể dùng cập nhật trong ứng dụng; hoặc thoát ứng dụng cũ rồi ghi đè ứng dụng Mac hoặc chạy gói cài đặt Windows. Bản di động giữ nguyên thư mục `data` cùng cấp rồi thay thế thủ công; phiên bản 1.75 trở về trước cần cài đặt thủ công một lần.
- **Cập nhật sau này**: Bản cài đặt Mac và Windows có thể tải bản mới trực tiếp trong ứng dụng, sau khi tải xong bạn chủ động nhấp khởi động lại để cài, không ép buộc nâng cấp. Bản di động Windows tiếp tục tải qua trang phát hành và thay thế thủ công.
- **Mac**: Gói chính thức đã hoàn thành ký Developer ID, chứng thực Apple Notarization Accepted và đóng dấu staple vé. Không cần tắt Gatekeeper toàn cục; việc chứng thực của Apple không tương đương với kiểm duyệt App Store hoặc cấp phép bản quyền nội dung.
- **Windows**: Bản cài đặt và bản di động EXE chưa được ký số thương mại nên có thể xuất hiện cảnh báo bảo mật của hệ thống. Vui lòng đối chiếu nguồn tải chính thức; bản di động sẽ giải nén tệp chạy tạm trong lần khởi động đầu tiên. Bản cài đặt tiếp tục dùng thư mục dữ liệu người dùng ban đầu; từ bản 3.4 trở đi, bản di động đặt cài đặt và lịch sử tải xuống trong thư mục `data` của chương trình, khi di chuyển chương trình vui lòng mang theo cả thư mục này. Bản cài đặt và bản di động không thể chạy cùng lúc (chỉ cho phép một phiên bản của ứng dụng chạy); trước khi đổi phiên bản vui lòng thoát cửa sổ đang chạy.
- **Sử dụng thông thường chỉ cần tệp cài đặt ở bảng trên**: Các tệp ZIP cập nhật Mac, `latest*.yml` và `.blockmap` trên trang phát hành dành riêng cho trình cập nhật tự động; tệp `source` và Source code do GitHub tự tạo là mã nguồn, không thể chạy trực tiếp.

Dự án này là bản sửa đổi mã nguồn mở do cộng đồng duy trì, **không phải ứng dụng chính thức của Hồng Quả, XiFan hay Hà Mã, và cũng không được các nền tảng chính thức chứng nhận**. Ứng dụng không cung cấp tính năng mở khóa các tập trả phí; danh sách tập phim, độ nét và phạm vi khả dụng phụ thuộc hoàn toàn vào nền tảng nguồn.

<details>
<summary>Thuyết minh tải về và nâng cấp lịch sử bản 3.9</summary>

**Bản chính thức trước đây: 3.9** (nội bộ `3.9.0`). Khôi phục lấy luồng App, phát và tải xuống, cải tiến tìm kiếm bù phim mới hôm nay, tải trước 2 tập tiếp theo, hình trong hình (PiP) hệ thống và chế độ cửa sổ thu nhỏ. Mac đã ký và chứng thực; EXE Windows chưa ký.

| Thiết bị | Tải về 3.9 | Cách cài đặt |
|---|---|---|
| Apple Silicon Mac (M series), macOS 13+ | [Tải DMG](https://github.com/jackotom/hongguo-drama/releases/download/v3.9/Hongguo-3.9-mac-arm64.dmg) | Mở DMG, kéo vào "Applications" rồi khởi chạy |
| Intel Mac, macOS 13+ | [Tải DMG](https://github.com/jackotom/hongguo-drama/releases/download/v3.9/Hongguo-3.9-mac-x64.dmg) | Mở DMG, kéo vào "Applications" rồi khởi chạy |
| Windows x64 (Cài đặt) | [Tải EXE cài đặt](https://github.com/jackotom/hongguo-drama/releases/download/v3.9/hongguo-downloader-3.9-win-x64-setup.exe) | Cài đặt theo hướng dẫn |
| Windows x64 (Di động) | [Tải EXE di động](https://github.com/jackotom/hongguo-drama/releases/download/v3.9/hongguo-downloader-3.9-win-x64.exe) · [Tải ZIP di động](https://github.com/jackotom/hongguo-drama/releases/download/v3.9/hongguo-downloader-3.9-win-x64.zip) | Chạy trực tiếp EXE; hoặc giải nén ZIP rồi chạy |

</details>

## Bắt đầu sử dụng

1. Mở phần "Cài đặt", chọn thư mục tải xuống và lưu lại.
2. Duyệt xem trong "Khám phá phim ngắn", hoặc nhập tên phim, liên kết chia sẻ Hồng Quả hoặc ID phim tại mục "Tìm kiếm và tải về".
3. Mở chi tiết và nhấp "Phát ngay", hoặc chọn các tập cùng độ nét mong muốn để thêm vào hàng đợi tải xuống.
4. Lần tiếp theo, tiếp tục xem từ "Kho phim của tôi" hoặc "Lịch sử xem"; tiến độ tải, thử lại khi lỗi và gộp toàn bộ phim nằm trong mục "Quản lý tải xuống".

## 5.3 Tải xuống NAS

- Phía dưới "Kho phim của tôi" bổ sung "Tải xuống NAS": trước tiên hãy gắn kết (mount) thư mục chia sẻ, sau đó chọn thư mục độc lập cho từng bộ phim.
- Tải mới ghi trực tiếp vào thư mục đã chọn; video, ảnh bìa, tóm tắt, tệp NFO của phim và từng tập được lưu cùng cấp, không tạo thêm thư mục phụ.
- Tên tập phim được đặt theo chuẩn "Tên Phim S01E001.mp4"; video cục bộ đã có được giữ nguyên tệp gốc và sao chép an toàn; video đã có trên NAS được tái sử dụng, thông tin còn thiếu được bổ sung.
- Quản lý tải xuống mở đúng thư mục lưu trữ; đưa ra cảnh báo khi ngắt kết nối thư mục, trùng tên xung đột hoặc đổi đường dẫn khi đang tải; video tải trực tiếp lên NAS không bị xóa tự động sau khi xem xong.
- Dữ liệu phim căn cứ theo nguồn thực tế cung cấp, lưu độc lập chứ không nhúng vào tệp MP4; chưa kiểm thử thực tế trên NAS phần cứng và thư viện nhận diện media.
- Bản 5.3 đã phát hành chính thức; xem chi tiết tại [Thuyết minh 5.3](docs/release-5.3.md).

## 5.2 Khôi phục cửa sổ macOS

- Khi khởi động lại ứng dụng hoặc mở lại từ Dock sau khi đóng cửa sổ chính, hệ thống sẽ khôi phục lại vị trí và kích thước của cửa sổ chính thông thường.
- Phóng to tối đa, toàn màn hình, thu nhỏ, cửa sổ tàng hình và bố cục dọc không ghi đè bản ghi cửa sổ thông thường; khởi động luôn là cửa sổ thông thường.
- Khi màn hình ban đầu không còn sẽ tự động trở về vị trí và kích thước mặc định; khi vùng khả dụng của màn hình bị thu nhỏ, cửa sổ luôn được giữ nằm trong màn hình.
- Bản 5.2 đã phát hành chính thức; xem chi tiết tại [Thuyết minh 5.2](docs/release-5.2.md).

## 5.1 Cập nhật sửa lỗi

Đã sửa các sự cố đã biết. Chi tiết xem [Thuyết minh 5.1](docs/release-5.1.md).

## 5.0 Ghi nhớ lịch sử xem và gợi ý các phần phim liên quan

- Phạm vi phát hiện bên cạnh "Kiểm tra cập nhật", tùy chọn "Ẩn các phần thấp hơn cùng bộ phim" sẽ ghi nhớ lựa chọn trên máy và khôi phục khi mở lại trang hoặc ứng dụng.
- Hỗ trợ cách viết phần rõ ràng như Phần 9, Phần 10, chữ số Hán và số phần trong ngoặc đơn; các phần phim rõ ràng cùng nguồn, cùng tên tiếp tục được phân nhóm bình thường.
- Các hậu tố chỉ có số trần, đổi số ở giữa tiêu đề hoặc đổi tên nhẹ chỉ hiển thị "Nghi vấn cùng bộ phim (chỉ gợi ý)".
- Các mục nghi vấn không vào danh sách ẩn, không gom nhóm hàng loạt, không hiện chấm đỏ cập nhật hoặc thông báo hệ thống.
- Chi tiết xem [Thuyết minh 5.0](docs/release-5.0.md).

## 4.9 Tương thích máy tính cũ, phím Boss và sửa lỗi thu nhỏ cửa sổ

- Bổ sung tùy chọn "Máy tính đời cũ (Ưu tiên H.264)": ưu tiên nguồn tương thích, khi bật chế độ tương thích sẽ chủ động chuyển mã trước đối với nguồn H.265 đã biết, giảm hiện tượng màn hình đen rồi báo lỗi.
- Sửa lỗi hình trong hình (PiP) và cửa sổ tàng hình trên Mac làm biến mất biểu tượng ứng dụng trên Dock.
- Cài đặt thêm phím Boss cho phép nhập tổ hợp phím tùy chỉnh: tạm dừng toàn cục và ẩn toàn bộ cửa sổ phát, trên Mac đồng thời ẩn Dock; nhấn lại lần nữa để khôi phục cửa sổ và biểu tượng, tiếp tục giữ trạng thái tạm dừng.
- Chi tiết xem [Thuyết minh 4.9](docs/release-4.9.md).

## 4.8 Tự động ưu tiên 1080P và tự hạ cấp khi lỗi

- Khi phát trực tuyến chọn "Tự động (Ưu tiên 1080P)", hệ thống sẽ thử 1080P trước, nếu thất bại sẽ lần lượt thử 720P và nguồn tương thích; khi chuyển đổi vẫn giữ nguyên tiến độ phát và trạng thái tạm dừng.
- Khi gặp lỗi không tương thích giải mã, hệ thống trước tiên thử phát tương thích ở độ phân giải hiện tại và một lần tái tạo bộ nhớ đệm, nếu vẫn thất bại mới chuyển mức độ nét; khi tắt chế độ tương thích sẽ chuyển mức độ nét ngay.
- Chuyển tập, thử lại thủ công và tải trước tập tiếp theo sẽ ưu tiên lại mức 1080P; số lần thử mỗi lượt có giới hạn để tránh chuyển đổi liên tục.
- Chọn thủ công 720P hoặc 1080P vẫn giữ nguyên mức cố định, tệp cục bộ đã có không bị ép tải lại; chất lượng khả dụng thực tế tùy thuộc vào nguồn cung cấp. Chi tiết xem [Thuyết minh 4.8](docs/release-4.8.md).

## 4.7 Thử lại khi tải lỗi và sửa lỗi hình trong hình

- Sau khi gửi yêu cầu tải thất bại, "Thử lại tập này" có thể gửi lại yêu cầu; thông báo hiển thị đúng trạng thái tác vụ thực tế.
- Hình trong hình tích hợp hiển thị ở góc dưới bên phải màn hình chứa cửa sổ chính, tự động lấy tiêu điểm, giữ ghim trên cùng và nhớ kích thước.
- Sửa ngoại lệ xảy ra do hủy lần đọc cũ khi kéo thanh tiến độ video cục bộ; đăng ký thiết bị ẩn danh thất bại lần đầu có thể thử lại sau một khoảng thời gian làm mát ngắn. Chi tiết xem [Thuyết minh 4.7](docs/release-4.7.md).

## 4.6 Thích ứng 4K và cửa sổ rộng

- Trang Khám phá và Tìm kiếm tận dụng tối đa chiều rộng cửa sổ, áp phích sắp xếp linh hoạt theo không gian khả dụng; trong Cài đặt có thể chọn kích thước áp phích: Nhỏ, Chuẩn, Lớn, Cực lớn.
- Giao diện mặc định thu phóng 100%, không tự động phóng to vì màn hình 4K hay toàn màn hình; thu phóng thủ công hỗ trợ từ 50% đến 200% và lưu lại tùy chọn.
- Tiêu đề tự động xuống dòng trên cửa sổ hẹp, thanh bên có thể cuộn trên cửa sổ thấp. Chi tiết xem [Thuyết minh 4.6](docs/release-4.6.md).

## 4.5 Đổi lượt khác trên trang Khám phá

- Nút "Đổi lượt khác" đọc trang tiếp theo thực tế của nguồn, danh mục và thể loại hiện tại, giữ nguyên thứ tự sắp xếp của nguồn.
- Nhấp lặp lại vào các nút Phim người đóng, Hoạt hình, Phim AI hoặc Thể loại cũng sẽ đổi lượt; khi chuyển lại phân loại sẽ tiếp tục vị trí trước đó, đến trang cuối cùng sẽ quay lại từ đầu.
- Bốn bảng xếp hạng Tổng hợp, Người đóng, Hoạt hình, AI giữ nguyên thứ tự độ hot, nhấp lặp lại vào bảng hiện tại không đổi lượt. Chi tiết xem [Thuyết minh 4.5](docs/release-4.5.md).

## 4.4 Hình trong hình tích hợp, lọc lịch sử và khôi phục lấy nguồn

- Cài đặt có thể chọn "Hệ thống nguyên bản / Ứng dụng tích hợp" cho hình trong hình, mặc định dùng cửa sổ nổi tích hợp; cửa sổ hiển thị tên phim, nhớ kích thước, quay lại cửa sổ chính giữ nguyên tiến độ và trạng thái phát.
- Lịch sử xem thêm tùy chọn "Ẩn các phần thấp hơn cùng bộ phim", chỉ ảnh hưởng đến hiển thị và bộ đếm, giữ nguyên bản ghi và tệp video của các phần khác.
- Khi lấy nguồn từ App trả về phản hồi rỗng, hệ thống sẽ làm mới thiết bị ẩn danh một lần và thử lại trong giới hạn thời gian và hạn mức làm mát, không làm đổi tài khoản đăng nhập.
- Lối vào tài khoản độc lập thống nhất thành "Tài khoản Hồng Quả", giữ nguyên tính năng quét mã đăng nhập và đọc lịch sử xem trên App. Chi tiết xem [Thuyết minh 4.4](docs/release-4.4.md).

## 4.3 Quản lý đăng nhập và lịch sử xem trên APP

Thêm trang "Quản lý đăng nhập" độc lập phía trên "Cài đặt". Sử dụng App Hồng Quả trên điện thoại quét mã QR trang web để đăng nhập, sau khi đăng nhập có thể đọc 50 lịch sử xem gần nhất trên APP của tài khoản và tìm kiếm theo tên phim. Chỉ khi nhấp vào bản ghi từ trang Quản lý đăng nhập mới chuyển sang trình phát; mục "Lịch sử xem" gốc vẫn chỉ hiển thị lịch sử của máy tính này.

Trạng thái đăng nhập được mã hóa bằng lưu trữ an toàn của hệ thống, tách biệt với cài đặt thông thường, lịch sử xem và bản sao lưu. Phiên bản này không tải lên lịch sử của máy và không nhập hàng loạt bản ghi APP vào máy. Chi tiết xem [Thuyết minh 4.3](docs/release-4.3.md).

## 4.2 Độ phân giải合tập và phương thức gộp

Khắc phục vấn đề tập đầu có độ phân giải thấp làm nén toàn bộ các tập HD phía sau xuống 480P. Gộp nhanh và Gộp tương thích ghép nối theo độ phân giải gốc của từng đoạn video; đoạn độ nét thấp không làm giảm chất lượng đoạn HD. Gộp chất lượng cao kiểm tra tệp thực tế đã tải trước khi bắt đầu, chỉ khởi chạy khi tất cả các tập đều đạt 1080P.

Cả 3 phương thức đều giữ nguyên tệp gốc, chỉ gộp các tập đã tải và không phóng đại video nét thấp thành nét cao giả mạo. Chi tiết xem [Thuyết minh 4.2](docs/release-4.2.md).

## 4.1 Xuất dữ liệu văn bản kèm theo khi tải xuống

- Trong "Tìm kiếm và tải về" chọn phim ngắn Hồng Quả, tích chọn theo nhu cầu: "Danmaku", "Bình luận", "Đánh giá phim", sau đó nhấn tải các tập đã chọn.
- Danmaku và bình luận của từng tập được lưu thành tệp JSON riêng biệt, sử dụng thư mục và tiền tố tên tệp của tác vụ video thực tế; đánh giá phim lưu 1 bản duy nhất cho cả bộ.
- Dữ liệu văn bản xuất ngầm trong nền, một mục lỗi không làm chặn tải video. Kết quả hiển thị số lượng thành công, bỏ qua, thất bại và dữ liệu một phần.
- Chỉ hỗ trợ nguồn Hồng Quả; bình luận và đánh giá phim chỉ bao gồm phần công khai trên trang web chính thức. Tính năng xuất phát từ PR #61 của `jayeeliu`.

## Tính năng đầy đủ

| Mục tiêu | Tính năng chính |
|---|---|
| Tìm phim | Tìm kiếm hợp nhất Hồng Quả, XiFan, Hà Mã; duyệt danh mục, bảng thịnh hành, phân tích liên kết chia sẻ |
| Xem liên tục | Phát trực tuyến và cục bộ, tiếp tục phát từ điểm dừng, tự chuyển tập, chỉnh tốc độ, tải trước 2 tập tiếp theo, hình trong hình |
| Tải và xuất | Chọn độ phân giải, tải hàng loạt, tự động thử lại khi lỗi, gộp thành 1 tệp MP4 |
| Quản lý kho phim | Lịch sử xem, yêu thích trên máy, nhắc nhở tập mới, dọn dẹp tệp tải và bộ nhớ đệm |
| Tùy chỉnh trải nghiệm | Bố cục ngang/dọc, ghim cửa sổ, chế độ thu nhỏ, hình trong hình (PiP), chủ đề, phím tắt, tăng cường độ nét |
| Đọc bình luận | Đánh giá công khai, mưa bình luận (Danmaku) theo dòng thời gian, từ khóa chặn trên máy |

<details>
<summary>Mở rộng chi tiết tính năng và giới hạn sử dụng</summary>

### 1. Tìm phim: Ba nguồn trong một lần tìm kiếm

- **Tìm kiếm tất cả các nguồn**: Mặc định truy vấn đồng thời Hồng Quả, XiFan và Hà Mã, kết quả ghi rõ nguồn; có thể chuyển sang từng nguồn riêng lẻ. Khi một nguồn gặp lỗi, kết quả của các nguồn khác vẫn hiển thị bình thường.
- **Danh mục khám phá**: Hiển thị ảnh bìa, tên phim, số tập, bộ lọc thể loại, duyệt phân trang và làm mới danh sách; trang chi tiết hiển thị toàn bộ các tập cùng trạng thái tải xuống.
- **Phân loại và bảng xếp hạng Hồng Quả**: Phim người đóng, Hoạt hình, Phim AI; 4 bảng xếp hạng Tổng hợp, Người đóng, Hoạt hình, AI hiển thị thứ hạng và độ hot do nguồn cung cấp.
- **Phân tích liên kết / ID Hồng Quả**: Dán liên kết chia sẻ hoặc nhập ID phim ngắn để lấy thông tin chi tiết, phát ngay hoặc chọn tập tải về.
- **Phát trực tiếp từ chi tiết**: Không cần tải trước toàn bộ phim; các tập chưa tải có thể phát trực tuyến ngay lập tức.
- **Chọn tập linh hoạt**: Chọn từng tập, chọn nhiều tập, chọn tất cả, đảo vùng chọn, bỏ chọn tất cả; chọn nhanh 10 tập đầu, 30 tập đầu, 30 tập cuối; hỗ trợ các cú pháp khoảng như `1-30`, `1,3,5`, `1,5,10-20`.

| Nguồn | Đã triển khai | Giới hạn hiện tại |
|---|---|---|
| Hồng Quả | Danh mục, thể loại, 4 bảng xếp hạng, tìm kiếm, phân tích link/ID, phát và tải tập khả dụng | Khi trang web chưa có nguồn sẽ thử lấy luồng bổ sung từ App, kết quả tùy thuộc vào phản hồi thực tế của nguồn. |
| XiFan | Danh mục riêng, thể loại, phân trang, tìm kiếm, phát và tải tập đã mở | Chưa tích hợp bảng xếp hạng; các tập bị khóa giữ nguyên đánh dấu và bỏ qua. |
| Hà Mã | Danh mục web, thể loại, lật trang trước sau, tìm kiếm, danh sách tập đầy đủ, phát và tải tập miễn phí | Các tập thu phí hoặc trạng thái không rõ ràng sẽ bị khóa, ứng dụng không cung cấp mở khóa. |

Tệp của 3 nguồn được lưu theo thư mục riêng theo nguồn và tên phim.

### 2. Phát video: Trực tuyến, cục bộ và xem liên tục

- **Ưu tiên cục bộ**: Các tập đã tải về sẽ phát trực tiếp từ tệp cục bộ; các tập chưa tải và không bị khóa sẽ thử phát trực tuyến; nhấp đúp vào tập chưa tải để thêm vào hàng đợi tải xuống.
- **Điều khiển cơ bản**: Nhấp chuột vào khung hình hoặc nút để phát/tạm dừng, kéo thanh tiến độ, xem thời gian, chỉnh âm lượng và tắt tiếng.
- **Bộ nhớ đệm 2 tập tiếp theo**: Bật tắt bên cạnh nút liên tục trong "Kho phim của tôi", mặc định bật và ghi nhớ lựa chọn; khi bắt đầu phát tập hiện tại sẽ tải trước tối đa 2 tập tiếp theo có thể phát trực tuyến, bỏ qua các tập đã tải và bị khóa.
- **Tự động chuyển tập**: Mặc định bật, có thể tắt bất cứ lúc nào; tự động chuyển sang tập tiếp theo, bỏ qua tập bị khóa, kết nối mượt mà giữa tập cục bộ và trực tuyến.
- **Tiếp tục từ điểm dừng**: Lưu số tập và vị trí phát theo từng bộ phim, tiếp tục xem từ Kho phim hoặc Lịch sử; khi chuyển sang các trang khác trong ứng dụng vẫn tiếp tục phát và lưu tiến độ.
- **Tốc độ phát từ 0.25× đến 4×**: Tổng cộng 16 mức. Nút tốc độ ở góc dưới bên phải là nút độc lập, mỗi lần nhấp tăng 0.25×, sau 4× sẽ quay lại 1×; menu 3 chấm cho phép chọn nhanh các mức, chuyển tập và xem liên tục vẫn giữ nguyên tốc độ đã chọn.
- **Chế độ phát tương thích**: Mặc định bật chế độ tương thích; khi lỗi giải mã, màn hình đen nhưng có tiếng sẽ tự động chuyển đổi sang H.264, hoặc có thể chọn thủ công "Chuyển mã rồi phát". Hiển thị tiến độ chuyển mã, hỗ trợ hủy và dọn dẹp bộ nhớ đệm.
- **Khôi phục lỗi**: Cho phép hủy chuẩn bị, thử lại tập này, kết nối lại nguồn hoặc chuyển mã tương thích. Khi địa chỉ hết hạn hoặc truyền dữ liệu bị ngắt quãng sẽ làm mới lấy lại địa chỉ có giới hạn; khi chuyển mã phần cứng thất bại sẽ tự động thử chuyển mã phần mềm.

### 3. Khung hình và cửa sổ: Ngang, dọc và tập trung xem

- **Bản ngang / Bản dọc**: Chuyển đổi bố cục từ thanh trên cùng; khi chuyển lại bản ngang sẽ khôi phục kích thước và vị trí cửa sổ trước đó.
- **Ghim cửa sổ trên cùng**: Một nút để ghim hoặc bỏ ghim, thuận tiện vừa làm việc vừa xem phim.
- **Hình trong hình (PiP) hệ thống**: Nút bấm trên thanh điều khiển phát để mở cửa sổ nổi nhỏ của hệ thống; cửa sổ dùng chung phần tử video đang phát, có thể kéo di chuyển, ghim, tạm dừng và đóng, tự động chuyển tập và đổi chất lượng mà không đóng cửa sổ, tiếp tục phát khi chuyển không gian làm việc (virtual desktop).
- **Chế độ cửa sổ thu nhỏ**: Nút "Cửa sổ nhỏ" trên cùng thu nhỏ cửa sổ chính thành kích thước 400×600 ghim trên cùng; khi rê chuột ra ngoài sẽ tự động tạm dừng và ẩn đi, rê chuột vào tiếp tục, nhấn phím Esc, Dock hoặc menu cửa sổ để khôi phục.
- **Chọn tập tích hợp bên phải**: Trong chế độ dọc, thanh chọn tập mở rộng hoặc thu gọn theo cửa sổ, giảm che khuất khung hình video.
- **Toàn màn hình**: Bản ngang sử dụng toàn màn hình video; bản dọc lấp đầy cửa sổ hiện tại, nhấn `Esc` để thoát. Khi phát toàn màn hình hoặc dọc, thanh điều khiển tự động ẩn sau 2 giây không thao tác, di chuyển chuột hoặc bấm phím sẽ hiển thị lại.
- **Chế độ hiển thị khung hình**: Chuyển đổi trong menu 3 chấm, **ghi nhớ độc lập cho từng bộ phim**:
  - *Vừa cửa sổ (Mặc định)*: Co giãn theo tỷ lệ không gian khả dụng, hiển thị trọn vẹn toàn bộ khung hình, nhân vật và phụ đề.
  - *Giữ nguyên chiều rộng*: Co giãn theo chiều rộng khả dụng; khi giảm chiều cao cửa sổ, khung hình không bị thu nhỏ theo, phần vượt quá trên dưới sẽ được cắt giữa.

### 4. Lịch sử xem và nhắc nhở theo dõi phim

- Trang "Lịch sử xem" độc lập, chỉ ghi nhận khi video thực sự bắt đầu phát, sắp xếp theo thời gian xem gần nhất.
- Hiển thị ảnh bìa, tên phim, số tập, mốc thời gian phát và thời điểm xem gần nhất, nhấp vào để tiếp tục xem.
- Hỗ trợ "Kiểm tra cập nhật" thủ công; trong thời gian ứng dụng chạy, định kỳ khoảng 6 tiếng kiểm tra tập mới một lần cho từng bộ phim, nhắc nhở bằng dấu chấm đỏ và số tập mới thêm.
- Hằng ngày kiểm tra các **phần phim tiếp theo nghi vấn** cùng nguồn, cùng tên và có số phần cao hơn; tính năng này có thể tắt riêng biệt trong Cài đặt.
- Thông báo hệ thống mặc định tắt, có thể bật trong Cài đặt (cần cấp quyền thông báo trong hệ điều hành).

### 5. Hàng đợi tải xuống: Lưu hàng loạt và khôi phục khi lỗi

- **Độ nét tải xuống**: Tự động (Ưu tiên tương thích), 1080P, 720P, có thể lưu làm mặc định. Chọn nguồn theo độ phân giải thực tế của video, kiểm tra lại trước khi lưu. Nguồn Hồng Quả nếu độ nét đã chọn không khả dụng hoặc tải lỗi sẽ tự động thử độ nét thấp hơn và hiển thị thông báo. Không phóng to giả mạo HD; khi có độ phân giải cao hơn sẽ giữ nguyên, không nén giảm độ phân giải.
- **Lưu lựa chọn độc lập theo tác vụ**: Thay đổi độ nét mặc định không làm thay đổi các lần thử lại thông thường của tác vụ hiện có; tệp độ nét thấp đã có được giữ lại, không tự động ghi đè.
- Thêm từng tập hoặc hàng loạt vào hàng đợi, hiển thị các trạng thái: Đang chờ, Đang tải, Đã hoàn thành, Thất bại, Đã dừng, cùng tiến độ tải, dung lượng đã nhận / tổng dung lượng và nguyên nhân lỗi.
- Hỗ trợ: Bắt đầu tất cả, Tạm dừng tất cả, Dừng từng tác vụ, Thử lại các mục thất bại, Chọn mục thất bại và Thử lại các mục đã chọn; tác vụ đã dừng có thể xếp hàng chạy lại.
- **1 đến 10 tác vụ tải đồng thời**, mặc định là 3, có hiệu lực sau khi lưu trong Cài đặt.
- Danh sách tải tổ chức theo từng bộ phim và phân trang; **chọn tất cả xuyên trang, bỏ chọn tất cả, giữ lại vùng chọn và xóa hàng loạt**.
- Xác nhận trước khi xóa: Mặc định chỉ xóa bản ghi tác vụ, có thể tích chọn xóa đồng thời tệp cục bộ trên đĩa; có thể dọn sạch các bản ghi đã hoàn thành.
- Mở nhanh thư mục tác vụ bằng một nhấp chuột; **Quét thư mục tải xuống** để bổ sung đăng ký các tệp đã có sẵn trên đĩa phù hợp với quy tắc đặt tên.

### 6. Gộp và xuất phim: Kết hợp nhiều tập thành 1 tệp MP4

Trong "Quản lý tải xuống", chọn tên phim rồi nhấp "Gộp toàn bộ phim", không cần tích chọn từng tác vụ; "Kho phim của tôi" cũng cung cấp lối vào gộp phim. Danh sách ứng viên chỉ hiển thị những bộ phim còn tệp cục bộ có thể gộp.

| Chế độ | Cách xử lý |
|---|---|
| Gộp nhanh thông minh | Khi các thông số mã hóa đồng nhất sẽ ghép trực tiếp; khi không đồng nhất sẽ xử lý âm thanh/hình ảnh khi cần thiết, mã hóa hỗn hợp có thể cần chuyển mã. |
| Gộp tương thích (H.264) | Xuất chuẩn H.264/AAC; các tập đã tương thích sẽ ghép trực tiếp, chỉ xử lý những phần không khớp. |

Hiển thị giai đoạn, tiến độ, thời gian đã dùng và tốc độ xử lý khả dụng / thời gian ước tính còn lại, hỗ trợ hủy, mở thư mục chứa tệp xuất và xóa bản ghi gộp. Cả hai phương thức đều giữ nguyên các tập phim gốc; **chỉ gộp các tập đã tải xong, không tự động bổ sung tập còn thiếu**.

### 7. Kho phim của tôi và dọn dẹp dung lượng

- Tìm kiếm, chuyển đổi giữa các bộ phim đã đăng ký, xem số tập, số lượng đã tải và dung lượng chiếm dụng trên đĩa, tải tiếp các tập khả dụng chưa hoàn thành.
- Xóa khỏi danh sách Kho phim nhưng vẫn giữ lại tệp; khôi phục các bộ phim đã xóa; dọn dẹp hàng loạt các bộ phim không có tệp tải cục bộ.
- Xóa từng bộ phim hoặc toàn bộ tệp đã tải, giữ lại thông tin phim để sau này vẫn có thể xem trực tuyến hoặc tải lại.
- Dọn dẹp độc lập bộ nhớ đệm phát trực tuyến và bộ nhớ đệm chuyển mã tương thích.
- Tùy chọn "Tự động xóa sau khi xem xong": sau khi phát hết một tập sẽ tự động xóa tệp cục bộ của tập đó, mặc định tắt. **Không nên bật nếu bạn cần lưu trữ video lâu dài.**

### 8. Cài đặt, mạng và cập nhật phần mềm

- **Vị trí tải xuống**: Chọn thư mục qua hộp thoại hoặc nhập đường dẫn thư mục thủ công.
- **Quy tắc đặt tên tệp**: Hỗ trợ các biến "TenPhim", "Tap", "TieuDe" (hoặc "剧名", "集数", "标题"), cùng các mẫu dựng sẵn; giữ số tập độc lập để tránh bị ghi đè.
- **Cấu hình Proxy mạng**: Bật/tắt, Theo hệ thống / biến môi trường, Proxy HTTP/HTTPS thủ công, Kết nối trực tiếp; hỗ trợ địa chỉ, cổng, cổng thông dụng định sẵn và thông tin xác thực tùy chọn.
- **Kiểm tra Proxy**: Có thể kiểm tra kết cấu proxy trước khi lưu.
- **Công tắc thông báo**: Kiểm soát độc lập kiểm tra tập mới, phần tiếp theo nghi vấn, thông báo hệ thống và tự động kiểm tra bản cập nhật phần mềm.
- **Nhắc nhở cập nhật phần mềm**: Mặc định bật; khi khởi động và trong lúc chạy định kỳ 6 tiếng kiểm tra phiên bản chính thức mới trên GitHub.

### 9. Giao diện, yêu thích và bình luận

- **Giao diện và cửa sổ**: Sáng, Tối hoặc theo hệ thống; chế độ cửa sổ nhỏ tự động tạm dừng và ẩn khi rê chuột ra ngoài, rê chuột vào tiếp tục; hình trong hình hệ thống dùng để xem xuyên suốt qua các ứng dụng khác.
- **Hỗ trợ tìm phim**: Gợi ý lịch sử tìm kiếm trên máy, bảng xếp hạng thịnh hành công khai, lọc theo phim đã hoàn thành hoặc đang cập nhật.
- **Đánh giá phim công khai và mưa bình luận (Danmaku)**: Xem điểm đánh giá do nguồn cung cấp, nhận xét toàn bộ phim và trích đoạn bình luận từng tập. Danmaku có thể tùy chỉnh độ mờ, cỡ chữ, tốc độ, khu vực và mật độ hiển thị; mặc định bật bộ lọc từ khóa nhạy cảm, hỗ trợ thêm từ khóa chặn trên máy.
- **Yêu thích trên máy**: Mục yêu thích chỉ lưu trên máy này.
- **Tăng cường chất lượng hình ảnh**: Bản gốc, Làm sắc nét có thể điều chỉnh, Tăng cường Anime4K CNNx2M 2×.
- **Liên kết chia sẻ**: Nhấp để đọc liên kết chia sẻ; các bộ phim công khai có thể sao chép liên kết trang chia sẻ chính thức.

</details>

## Phím tắt phát video

| Phím | Thao tác |
|---|---|
| `Space` (Phím cách) | Phát / Tạm dừng |
| `←` / `→` | Lùi lại / Tiến tới 5 giây |
| `↑` / `↓` | Tập trước / Tập tiếp theo |
| `A` | Bật / Tắt tự động phát liên tục |
| `S` / `D` | Giảm / Tăng 0.25× tốc độ phát |
| `F` | Bật / Tắt toàn màn hình |
| `Esc` | Thoát chế độ dọc tràn cửa sổ, hoặc đóng menu / hộp thoại hiện tại |

Các phím trên là phím tắt mặc định, có thể nhấp để thay đổi trong "Cài đặt", hỗ trợ phím đơn hoặc tổ hợp với phím Shift, tự động kiểm tra xung đột và có nút khôi phục về mặc định. Thao tác trong ô nhập văn bản, menu và hộp thoại sẽ không kích hoạt nhầm phím tắt trình phát.

## Giao diện và minh họa

![Phim Ngắn Hồng Quả 1.6: Gợi ý thịnh hành và bảng xếp hạng công khai](docs/screenshots/macos-v1.6-hot.jpg)

<p align="center"><sub>Hình ảnh thực tế phiên bản macOS 1.6: Trang Gợi ý thịnh hành. Danh sách phim và độ hot trong ảnh chụp màn hình là nội dung công khai tại thời điểm chụp, sẽ cập nhật theo nguồn thực tế.</sub></p>

## Câu hỏi thường gặp

### Tại sao một số tập bị khóa, tải thất bại hoặc độ nét không đồng đều?

Nguồn video và phạm vi khả dụng do dịch vụ nền tảng quyết định; các tập bị khóa trên XiFan, tập tính phí hoặc trạng thái không rõ ràng trên Hà Mã sẽ được giữ nguyên trạng thái khóa. Ứng dụng không cung cấp tính năng mở khóa hay xem quảng cáo nhận thưởng, không cam kết khả dụng cho nội dung trả phí.

### Làm gì khi tải xuống thất bại hoặc không tải được danh mục?

Trước tiên hãy kiểm tra kết nối mạng và nền tảng nguồn, sau đó kiểm tra công tắc và chế độ Proxy, giảm bớt số lượng tải đồng thời, sử dụng tính năng "Thử lại mục lỗi" hoặc tải lại danh mục. Nếu màn hình đen nhưng vẫn có tiếng hãy thử bật chế độ Tương thích.

### Video, cài đặt và lịch sử xem được lưu ở đâu?

Video được lưu trong thư mục tải xuống đã chọn trong Cài đặt, phân cấp theo nguồn và tên phim. Cài đặt, tác vụ và lịch sử xem mặc định nằm tại:

- macOS: `~/Library/Application Support/hongguo-downloader/`
- Windows bản cài đặt: `%APPDATA%\hongguo-downloader\`
- Windows bản di động (Portable, từ bản 3.4 trở đi): Thư mục `data\` ngay cạnh tệp chương trình.

### Cách cập nhật ứng dụng?

Trước tiên cài đặt thủ công bản mới nhất một lần. Sau đó, bản cài đặt Mac và Windows khi phát hiện bản mới có thể nhấp tải về trong ứng dụng, tải xong nhấp khởi động lại để cài; bản di động Windows tiếp tục tải thủ công qua trang phát hành. Ứng dụng không ép buộc cập nhật và không tự động cài đặt khi chỉ thoát thông thường.

### Xây dựng từ mã nguồn có kèm chữ ký số và chứng thực không?

Mã nguồn mặc định khi build trên Mac sử dụng chữ ký ad-hoc, không tự động dùng chứng chỉ nhà phát triển hoặc gửi chứng thực Apple. Gói Mac chính thức có chữ ký Developer ID và chứng thực độc lập; các gói Windows hiện chưa ký số thương mại.

### Phản hồi sự cố như thế nào?

Truy cập [Issues](https://github.com/jackotom/hongguo-drama/issues) cung cấp phiên bản ứng dụng, hệ điều hành, loại chip, nguồn phim, các bước tái hiện và thông báo lỗi. Vui lòng che/xóa thông tin tài khoản, Cookie, thông tin đăng nhập proxy và đường dẫn cá nhân trước khi gửi ảnh chụp màn hình hay nhật ký log.

## Bản quyền, Giấy phép và Giới hạn sử dụng

Dự án này kế thừa giấy phép **[GPL-3.0](LICENSE)** từ thượng nguồn và bảo lưu các tuyên bố về sửa đổi và nguồn gốc. Xem chi tiết các thay đổi trong [NOTICE](NOTICE), giấy phép các thành phần phụ thuộc xem trong [Thông báo bên thứ ba](THIRD-PARTY-NOTICES.md).

Chân thành cảm ơn các dự án nền tảng và tài liệu tham khảo:

- **[327044572/hongguo-downloader](https://github.com/327044572/hongguo-downloader)**: Dự án gốc thượng nguồn.
- **[zhenyong97/hongguo-downloader](https://github.com/zhenyong97/hongguo-downloader)**: Nền tảng trực tiếp của bản chuyển đổi macOS này.
- **[woshishiq1/drpys](https://github.com/woshishiq1/drpys)** & **[N3urda/hongguoTV](https://github.com/N3urda/hongguoTV)**: Nguồn thuật toán liên quan đến App; chi tiết xem [Tuyên bố bản quyền thuật toán](src/native/licenses/NOTICE.txt).
- **[Hululu007/drpy-node](https://github.com/Hululu007/drpy-node/tree/295f2b7047e14122d542a7736cb931e81abcf85c)**: Tham khảo đường dẫn và cấu trúc dữ liệu XiFan; dự án tự viết bộ chuyển đổi độc lập.
- **Electron, React, FFmpeg & x264**: Môi trường chạy máy tính, giao diện và các thành phần xử lý đa phương tiện.

Giấy phép mã nguồn mở áp dụng cho phần mềm, không cấp quyền tái phân phối nội dung các tập phim. Gói cài đặt không chứa bất kỳ tệp video phim nào; bản quyền tác phẩm thuộc về nền tảng gốc và tác giả sáng tạo. Vui lòng chỉ xử lý nội dung mà bạn có quyền truy cập, tải về hoặc sao lưu hợp pháp, tuân thủ điều khoản dịch vụ của nền tảng và luật pháp hiện hành.
