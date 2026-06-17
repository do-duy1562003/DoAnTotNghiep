# ĐỒ ÁN TỐT NGHIỆP

## Đề tài

**Thiết kế và thi công mô hình nhà trồng nấm thông minh sử dụng ESP32 và Arduino Uno R3**

## Giới thiệu

Đồ án xây dựng mô hình nhà trồng nấm thông minh nhằm hỗ trợ giám sát và điều khiển các thông số môi trường trong nhà trồng nấm như nhiệt độ, độ ẩm và các thiết bị chấp hành. Hệ thống sử dụng vi điều khiển để thu thập dữ liệu từ cảm biến, truyền dữ liệu giữa các nút thông qua LoRa và hiển thị thông tin trên giao diện Web.

Mô hình được thiết kế theo hướng gồm nút **Master** và các nút **Slave**. Các nút Slave có nhiệm vụ thu thập dữ liệu cảm biến tại từng khu vực, sau đó gửi dữ liệu về nút Master. Nút Master xử lý dữ liệu, điều khiển thiết bị và hỗ trợ giám sát thông qua giao diện Web.

## Chức năng chính

* Giám sát các thông số môi trường trong nhà trồng nấm.
* Truyền dữ liệu không dây giữa Master và Slave bằng LoRa.
* Điều khiển thiết bị trong mô hình như quạt, phun sương hoặc các cơ cấu chấp hành khác.
* Hiển thị dữ liệu và trạng thái hệ thống trên giao diện Web.
* Lưu trữ và quản lý mã nguồn, tài liệu báo cáo và thiết kế phần cứng của đồ án.

## Cấu trúc thư mục

```text
DoAnTotNghiep/
├── Bao_cao/
├── POWER_Project/
├── ide_moi/
├── mushroom-dashboard/
├── slave_Project/
├── ĐATN_Project/
├── .gitignore
└── README.md
```

## Mô tả các thư mục

### 1. `Bao_cao/`

Thư mục chứa các tài liệu báo cáo của đồ án tốt nghiệp, bao gồm:

* File báo cáo Word.
* File báo cáo PDF.
* File PowerPoint trình chiếu bảo vệ đồ án.

### 2. `ĐATN_Project/`

Thư mục chứa các file thiết kế mạch Master cho dự án nhà trồng nấm thông minh, bao gồm:

* Sơ đồ nguyên lý.
* Thiết kế mạch PCB.
* Thư viện linh kiện.
* File 3D hoặc các file liên quan đến thiết kế phần cứng.

### 3. `POWER_Project/`

Thư mục chứa phần thiết kế liên quan đến khối nguồn hoặc các mạch phụ trợ cấp nguồn cho hệ thống.

### 4. `ide_moi/`

Thư mục chứa mã nguồn chương trình cho vi điều khiển. Các chương trình này dùng để:

* Đọc dữ liệu cảm biến.
* Giao tiếp LoRa giữa Master và Slave.
* Điều khiển thiết bị chấp hành.
* Xử lý dữ liệu trong mô hình nhà trồng nấm.

### 5. `slave_Project/`

Thư mục chứa mã nguồn hoặc thiết kế liên quan đến các nút Slave trong hệ thống. Các nút Slave có nhiệm vụ thu thập dữ liệu cảm biến và gửi về nút Master thông qua LoRa.

### 6. `mushroom-dashboard/`

Thư mục chứa mã nguồn giao diện Web dùng để giám sát và điều khiển mô hình nhà trồng nấm. Giao diện Web hỗ trợ:

* Hiển thị dữ liệu cảm biến.
* Theo dõi trạng thái thiết bị.
* Hỗ trợ quản lý và điều khiển hệ thống từ máy tính hoặc trình duyệt.

## Công nghệ sử dụng

* Vi điều khiển ESP32/Arduino.
* Truyền thông LoRa.
* Cảm biến nhiệt độ, độ ẩm và các cảm biến môi trường.
* Giao diện Web sử dụng HTML, CSS, JavaScript.
* Thiết kế mạch bằng Altium Designer.
* GitHub để lưu trữ và quản lý mã nguồn đồ án.

## Mục tiêu đồ án

* Thiết kế mô hình nhà trồng nấm thông minh có khả năng giám sát môi trường.
* Ứng dụng truyền thông LoRa để truyền dữ liệu giữa các nút trong hệ thống.
* Xây dựng giao diện Web trực quan, dễ sử dụng.
* Hoàn thiện thiết kế phần cứng, phần mềm và tài liệu báo cáo phục vụ bảo vệ đồ án tốt nghiệp.

## Tác giả

Sinh viên thực hiện: **Đỗ Đức Duy**



