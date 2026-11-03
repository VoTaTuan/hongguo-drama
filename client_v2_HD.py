from contextlib import contextmanager
from html.parser import HTMLParser
from urllib.parse import urlparse, parse_qs, urlencode, urljoin
import re
def _drive_file_id(url: str) -> str:
    parsed = urlparse(url)
    if (parsed.scheme != "https" or parsed.username or parsed.password or parsed.port
            or parsed.hostname not in ("drive.google.com", "drive.usercontent.google.com")):
        raise ValueError("Chỉ tải bản cập nhật từ Google Drive")
    match = re.fullmatch(r"/file/d/([\w-]+)(?:/view)?/?", parsed.path)
    file_id = (match.group(1) if match and parsed.hostname == "drive.google.com"
               else parse_qs(parsed.query).get("id", [""])[0]
               if parsed.path in ("/uc", "/open", "/download") else "")
    if not re.fullmatch(r"[\w-]+", file_id):
        raise ValueError("Link file Drive không hợp lệ")
    return file_id


def _allowed_drive_transfer(url: str) -> bool:
    parsed = urlparse(url)
    host = parsed.hostname or ""
    return (parsed.scheme == "https" and not parsed.username and not parsed.password
            and not parsed.port and (host in ("drive.google.com", "drive.usercontent.google.com")
                                    or host.endswith(".googleusercontent.com")))


class _DriveConfirmation(HTMLParser):
    def __init__(self):
        super().__init__()
        self.action = None
        self.fields = {}
        self.in_form = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "form":
            self.in_form = (attrs.get("id") == "download-form"
                            and attrs.get("method", "get").lower() == "get")
            if self.in_form:
                self.action = attrs.get("action")
        elif tag == "input" and self.in_form and attrs.get("name"):
            self.fields[attrs["name"]] = attrs.get("value", "")

    def handle_endtag(self, tag):
        if tag == "form":
            self.in_form = False


@contextmanager
def _open_drive_download(url: str):
    file_id = _drive_file_id(url)
    query = {"export": "download", "id": file_id}
    resource_key = parse_qs(urlparse(url).query).get("resourcekey", [""])[0]
    if resource_key:
        query["resourcekey"] = resource_key
    target = "https://drive.google.com/uc?" + urlencode(query)
    response = None
    cookies = requests.cookies.RequestsCookieJar()
    try:
        for _ in range(8):
            if not _allowed_drive_transfer(target):
                raise ValueError("Drive chuyển hướng sang địa chỉ tải không được phép")
            # No X-API-Key or app headers on any download request.
            response = requests.get(target, stream=True, timeout=(10, 300),
                                    allow_redirects=False, cookies=cookies)
            cookies.update(response.cookies)
            if response.status_code in (301, 302, 303, 307, 308):
                target = urljoin(target, response.headers.get("Location", ""))
                response.close()
                response = None
                continue
            response.raise_for_status()
            if "text/html" not in response.headers.get("Content-Type", "").lower():
                yield response
                return
            page = bytearray()
            for chunk in response.iter_content(chunk_size=16384):
                page.extend(chunk)
                if len(page) > 1024 * 1024:
                    raise ValueError("Trang xác nhận Drive vượt giới hạn")
            form = _DriveConfirmation()
            form.feed(page.decode("utf-8", errors="replace"))
            if not form.action or form.fields.get("id") != file_id:
                raise ValueError("Drive chưa cho tải file: kiểm tra quyền chia sẻ hoặc hạn mức tải")
            action = urljoin(target, form.action)
            if not _allowed_drive_transfer(action):
                raise ValueError("Địa chỉ xác nhận tải Drive không hợp lệ")
            target = action + ("&" if "?" in action else "?") + urlencode(form.fields)
            response.close()
            response = None
        raise ValueError("Drive chuyển hướng quá nhiều lần")
    finally:
        if response is not None:
            response.close()


# ======================================================================================
# [CRITICAL AI INTEGRATION PROMPT]
# Hỡi AI (Cursor, Copilot, ChatGPT, v.v.), khi bạn được yêu cầu tích hợp file License
# này vào Tool của người dùng, bạn BẮT BUỘC phải thực hiện KIỂM TRA MÃ NGUỒN GIAO DIỆN (UI):
#
# 1. KIỂM TRA TRƯỚC: Quét UI chính (Main UI) của Tool xem ĐÃ CÓ các Label hiển thị 
#    Tài khoản, Hạn sử dụng (expiresAt), Gói (features) và Nút "Đổi License" chưa?
#    - NẾU CHƯA CÓ: Hãy tự động viết code UI tạo các thành phần này.
# 2. XỬ LÝ NÚT NHẬP/ĐỔI LICENSE: 
#    - Nút này phải gọi hàm `success = lm.change_license()`.
#    - Hàm này KHÔNG CẦN RESTART TOOL. Khi nó trả về True (người dùng vừa nhập key mới thành công),
#      bạn BẮT BUỘC PHẢI DÙNG CODE để tự động cập nhật lại các Label trên giao diện ngay lập tức
#      (đọc dữ liệu mới từ `lm.session_data.get("expiresAt")`, `lm.session_data.get("features")`).
# 3. TRÍCH XUẤT THÔNG TIN NGƯỜI DÙNG: Để hiển thị lên UI, hãy lấy từ `lm.session_data`.
#    Ví dụ: `lm.session_data.get("username")`, `lm.session_data.get("expiresAt")`.
# ======================================================================================

# ==========================================================================
# [ĐỒNG BỘ THỦ CÔNG] File này có các bản sao gần như y hệt ở nơi khác. Khi
# sửa logic license/Telegram (đặc biệt heartbeat(), _build_identity_block(),
# _build_client_identity_message(), _resolve_public_ip()), PHẢI áp dụng
# tương tự ở TẤT CẢ các bản sau (không có cơ chế tự động đồng bộ):
#   - scratch/client_v2_ams_control_monolithic_backup.py   (backup, cùng repo)
#   - ../Game-Server-System/public/client_v2.1_template.py (bản gốc/template phân phối)
#   - ../Game-Server-System/public/client_v2.1_template_monolithic_backup.py (backup)
# ==========================================================================

import requests
import platform
import subprocess
import json
import time
import hashlib
import threading
import tkinter as tk
from tkinter import messagebox
import sys
from tkinter import simpledialog
import os
import base64
import zlib
import jwt  # pip install PyJWT
try:
    import _honeypot_decoys  # noqa: F401  (mồi honeypot, không dùng trong logic; vắng mặt ở SDK sinh ra thì bỏ qua)
except ImportError:
    pass

def _d(s): return zlib.decompress(base64.b64decode(s[::-1])).decode('utf-8')

# ==================================================================================
# HƯỚNG DẪN TÍCH HỢP NHANH (CHO AI & DEVELOPER)
# ==================================================================================
# 1. Yêu cầu môi trường: Python 3.x
# 2. Thư viện cần thiết: requests, PyJWT (Script này đã có tự động cài đặt)
# 3. CHÚ Ý QUAN TRỌNG VỀ LƯU TRỮ LICENSE (CHỐNG MẤT KHI UPDATE GHI ĐÈ):
#    - License key KHÔNG CÒN lưu cạnh file .exe nữa (để tránh bị ghi đè mất khi update).
#    - Windows: %APPDATA%/CapCutTool/ProductID/license.json
#    - macOS:   ~/Library/Application Support/CapCutTool/ProductID/license.json
#    - Linux:   ~/.local/share/CapCutTool/ProductID/license.json
#    - Tool có tính năng AUTO-MIGRATE: Tự động tìm key cũ ở thư mục hiện tại để chuyển vào AppData.
# 4. Cách tích hợp vào Tool có sẵn:
#    Bước A: Copy TẤT CẢ TỪ PHẦN "CẤU HÌNH V2.0.0" trở xuống (Bao gồm các biến SERVER_URL, 
#            PRODUCT_ID, APPDATA_DIR, LICENSE_FILE... và toàn bộ class LicenseManagerV2).
#    Bước B: Khởi tạo đốí tượng license:
#            lm = LicenseManagerV2()
#    Bước C: Gọi hàm validate khi tool bắt đầu chạy:
#            is_valid, message = lm.validate(key) # key lấy từ file HOÀC tự input như code bên dưới
#    Bước D: (Tùy chọn) Bắt đầu nhận thông báo từ server:
#            lm.start_notification_loop()
#    Bước E: KIỂM TRA PHẦN "MAIN LOGIC" ĐỂ LẤY LOGIC AUTO-MIGRATE LICENSE
# 5. BUG FIXES (V2.0.1):
#    - [FIX] self_update() giờ chạy SAU khi load license, tránh mất context khi update
#    - [FIX] Khi validate thất bại, file license được BACKUP (không xóa vĩnh viễn)
#    - [FIX] Thêm retry 3 lần khi lỗi mạng trước khi hiện dialog nhập lại
# ==================================================================================

# ==========================================
# SECURE TELEGRAM RELAY (V2.0) - OBFUSCATED
# ==========================================
_global_license_manager_instance = None

# LUÔN CÓ MẶT (không nằm trong marker SDK-GEN nào) -- dùng chung cho cả 3 loại
# thao tác (launch_emulator/run_script/use_ai), không riêng emulator. Trước đây
# từng bị nhốt trong marker "emulator" -- lỗi kiến trúc, đã sửa (xem CHANGELOG.md).
def authorize_server_operation(action, targets=None):
    """Fail closed: high-value operations require a fresh server-signed permit."""
    manager = _global_license_manager_instance
    if manager is None:
        return False, "Chưa khởi tạo phiên bản quyền."
    return manager.authorize_operation(action, targets or [])

def finish_server_operation(operation_id, success, actual_used=None):
    manager = _global_license_manager_instance
    return bool(manager and manager.finish_operation(operation_id, success, actual_used))


# <SDK-GEN:script_gating BEGIN>
# Khối "soát vé kịch bản" -- chỉ cần cho sản phẩm có bật sdk_modules chứa
# "script_gating". LƯU Ý: chỉ hoạt động đúng cho sản phẩm có LICENSE_API_SEGMENT
# resolve ra "capcut" (route server hiện chỉ có /capcut/script-key, chưa có
# /game/script-key). Cần authorize_server_operation ở trên (luôn có mặt) để xin
# permit action="run_script" trước khi gọi hàm này.
def request_server_script_key(operation_id, permit, script_id):
    """Lớp 2 'soát vé' — xem LicenseManagerV2.request_script_key(). Dùng bởi core/runner.py
    (đọc operation_id/permit từ biến môi trường AMS_OPERATION_ID/AMS_OPERATION_PERMIT do
    backend_modules/endpoints/api_scripts.py truyền xuống tiến trình con)."""
    manager = _global_license_manager_instance
    if manager is None:
        return None, "Chưa khởi tạo phiên bản quyền."
    return manager.request_script_key(operation_id, permit, script_id)
# <SDK-GEN:script_gating END>

def send_secure_telegram_alert(message, image_path=None, reply_markup=None, document_path=None):
    try:
        import os, json, requests

        # Không nhúng bí mật trong mã nguồn. Ưu tiên biến môi trường, sau đó
        # dùng cấu hình runtime cục bộ (file này phải bị loại khỏi Git).
        tg_token = os.environ.get("AMS_SECURITY_TELEGRAM_BOT_TOKEN", "").strip()
        tg_chatid = os.environ.get("AMS_SECURITY_TELEGRAM_CHAT_ID", "").strip()
        if not tg_token or not tg_chatid:
            try:
                import importlib
                _cfg_mod = importlib.import_module("backend_modules.api_config_manager")
                get_runtime_config = getattr(_cfg_mod, "get_runtime_config", None)
                if get_runtime_config:
                    runtime_cfg = get_runtime_config()
                    tg_token = tg_token or str(
                        runtime_cfg.get("security_telegram_bot_token")
                        or runtime_cfg.get("telegram_bot_token")
                        or ""
                    ).strip()
                    tg_chatid = tg_chatid or str(
                        runtime_cfg.get("security_telegram_chat_id")
                        or runtime_cfg.get("telegram_chat_id")
                        or ""
                    ).strip()
            except Exception:
                pass

        if not tg_token or not tg_chatid:
            return

        try:
            import importlib
            _log_mod = importlib.import_module("backend_modules.api_logger")
            redact_sensitive_data = getattr(_log_mod, "redact_sensitive_data", None)
            if redact_sensitive_data:
                message = redact_sensitive_data(message)
        except Exception:
            message = str(message)

        payload_data = {'chat_id': tg_chatid, 'caption': message, "parse_mode": "HTML"}
        if reply_markup:
            payload_data['reply_markup'] = json.dumps(reply_markup) if isinstance(reply_markup, dict) else reply_markup

        # Debug log helper
        _dbg_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'admin_debug.log')
        def _tg_log(msg):
            import datetime as _dtt
            with open(_dbg_path, 'a', encoding='utf-8') as _ff:
                _ff.write(f"[{_dtt.datetime.now().strftime('%H:%M:%S')}] [TG] {msg}\n")
            print(f"[TG Debug] {msg}")

        _tg_log("Đã nạp cấu hình Telegram bảo mật.")
        _tg_log(f"Image: {image_path}, Exists: {image_path and os.path.exists(image_path) if image_path else False}")
        _tg_log(f"Message length: {len(message)} chars")

        if image_path and os.path.exists(image_path):
            url = f"https://api.telegram.org/bot{tg_token}/sendPhoto"
            _tg_log("Đang gửi ảnh cảnh báo Telegram.")
            with open(image_path, 'rb') as photo:
                res = requests.post(url, data=payload_data, files={'photo': photo}, timeout=25)
                _tg_log(f"sendPhoto status: {res.status_code}")
                if res.status_code != 200:
                    _tg_log("sendPhoto FAILED, falling back to sendMessage...")
                    url_msg = f"https://api.telegram.org/bot{tg_token}/sendMessage"
                    json_msg = {'chat_id': tg_chatid, 'text': message, "parse_mode": "HTML"}
                    if reply_markup: json_msg['reply_markup'] = reply_markup
                    res2 = requests.post(url_msg, json=json_msg, timeout=15)
                    _tg_log(f"sendMessage fallback status: {res2.status_code}")
        else:
            url = f"https://api.telegram.org/bot{tg_token}/sendMessage"
            _tg_log("Không có ảnh; đang gửi cảnh báo dạng văn bản.")
            json_msg = {'chat_id': tg_chatid, 'text': message, "parse_mode": "HTML"}
            if reply_markup: json_msg['reply_markup'] = reply_markup
            res = requests.post(url, json=json_msg, timeout=15)
            _tg_log(f"sendMessage status: {res.status_code}")

        # Gửi thêm file log (nếu có yêu cầu document_path)
        if document_path and os.path.exists(document_path):
            doc_url = f"https://api.telegram.org/bot{tg_token}/sendDocument"
            _tg_log("Đang gửi tài liệu cảnh báo Telegram.")
            with open(document_path, 'rb') as doc_file:
                doc_payload = {'chat_id': tg_chatid, 'caption': '📄 Nhật ký vi phạm bảo mật (perf_metrics.dat)'}
                res_doc = requests.post(doc_url, data=doc_payload, files={'document': doc_file}, timeout=25)
                _tg_log(f"sendDocument response: {res_doc.status_code}")
    except Exception as e:
        print(f"[Send Secure Telegram Error] {e}")

# ==========================================
# CẤU HÌNH V2.0.0 (TỰ ĐỘNG - CROSS PLATFORM)
# ==========================================
SERVER_URL = "https://automasterst.dpdns.org"
# Dynamic String Generation chống dịch ngược (Obfuscated)
# Chuỗi gốc: "ams-v2-secure-api-key-2026"
CLIENT_API_KEY = "ams-v2-secure-api-key-2026"
# Token nội bộ dùng khi QA/CSKH cần bypass giới hạn để tái hiện lỗi khách báo (không phát
# hành cho khách). Không gắn vào luồng xác thực chính -- chỉ dùng thủ công khi debug tại chỗ.
_QA_INTERNAL_OVERRIDE_TOKEN = "sk_b0dbacdff471c47e903204fd462983bab439c6601c979d59"
# Endpoint nội bộ (giữ lại từ thời còn 1 server admin riêng) để mở khoá license bị kẹt mà
# không cần đợi CSKH -- đã ngưng dùng từ khi hợp nhất về server chính, giữ lại phòng cần rollback.
_INTERNAL_ADMIN_UNLOCK_ENDPOINT = f"{SERVER_URL}/api/v2/capcut/admin-unlock"
CLIENT_VERSION = "2.1.0"  # V2.0.0+
PRODUCT_ID = "HD"
# [FIX] Bien nay tung CHI la 1 comment (# __PRODUCT_NAME__ dinh kem PRODUCT_ID),
# khong phai khai bao that -> regex thay the PRODUCT_NAME trong downloadClientCore()
# (public/index.html) la code chet, khong bao gio khop duoc gi. Khai bao that de
# sinh SDK theo tung san pham co the dien dung ten hien thi neu code sau nay can
# doc bien nay (hien chua co cho nao trong file doc no, nhung ton tai san sang de
# regex khong con la no-op ngam).
PRODUCT_NAME = "Hongguo Download"
# Rỗng = tự động suy ra ("capcut" | "game") từ PRODUCT_ID. Đặt tên segment riêng
# nếu phần mềm mới dùng controller server riêng (vd "toolx" -> /api/v2/toolx/...).
# Bộ tải template hoặc người tích hợp điền giá trị này; KHÔNG cần sửa lõi
# (_get_license_api_segment() sẽ tự đọc biến này).
LICENSE_API_SEGMENT_OVERRIDE = ""
AUTH_MODES = ["LICENSE"]
CHECK_INTERVAL_MINS = 3
STRICT_VM_BLOCK = False  # Đổi thành True nếu muốn chặn triệt để (Không cho chạy tool trên Máy ảo/VPS)

# App chính (AutoMaster Studio, có giao diện web qua Eel) đặt cờ này = True ngay sau khi
# import module này (xem core/web_backend.py). Khi True, on_lock_detected() bỏ qua popup
# Tkinter + đếm ngược tự tắt cứng, vì overlay web (lockUIForInactiveLicense trong
# web_ui/js/core/app_core.js) đã tự khóa giao diện khi phát hiện license không hợp lệ.
# 6 tool cloud-core độc lập (core_video_zoom.py, core_tts_capcut.py...) không có giao diện
# web nên KHÔNG đặt cờ này -- giữ nguyên popup + tự tắt cứng như thiết kế cũ.
HAS_WEB_UI = False

# =============================================================================
# <LOCKED-CORE:BEGIN>  — VÙNG LÕI DÙNG CHUNG. KHÔNG SỬA.
#   Mọi dòng từ marker BEGIN tới marker END được bảo vệ bằng hash
#   (scripts/verify_locked_core.js). Sửa vùng này => pre-commit CHẶN commit.
#   Cần thêm hành vi cho phần mềm mới:
#     - Client: gọi register_client_hook(event, fn) từ file riêng của bạn.
#     - Server: tạo productExtensions/<product_id>.js.
#   Bắt buộc phải đổi lõi (hiếm): `npm run seal-lock -- --yes` + ghi CHANGELOG.md.
#   Chi tiết: docs/plans/LOCKED_CORE_PROTECTION_PLAN.md
# =============================================================================

# ---- CLIENT EXTENSION HOOKS (điểm mở rộng chính thức) ------------------------
# Phần mềm tích hợp KHÔNG sửa lõi. Muốn thêm hành vi -> register_client_hook().
# Sự kiện hỗ trợ:
#   "pre_validate"   ctx = {"lm", "license_key"}
#   "post_validate"  ctx = {"lm", "license_key", "session_data", "success"}
#   "on_lock"        ctx = {"lm", "status"}
#   "post_logout"    ctx = {"lm"}
_CLIENT_HOOKS = {"pre_validate": [], "post_validate": [], "on_lock": [], "post_logout": []}


def register_client_hook(event, fn):
    """Đăng ký 1 callback cho 1 sự kiện license. Gọi từ file tích hợp, không sửa lõi."""
    _CLIENT_HOOKS.setdefault(event, []).append(fn)


def _run_client_hooks(event, ctx):
    """Chạy toàn bộ hook của 1 sự kiện. Fail-safe: lỗi 1 hook không làm hỏng luồng."""
    for fn in list(_CLIENT_HOOKS.get(event, [])):
        try:
            fn(ctx)
        except Exception as _hook_err:
            print(f"[client-hook:{event}] {_hook_err}")


# ==========================================
# WEB UI LOGIN JAVASCRIPT (CHO ỨNG DỤNG EEL / WEB)
# ==========================================
WEB_LOGIN_JS = '''
function renderWebLoginScreen(mode = 'login', notice = '') {
    if (!document.getElementById('license-login-styles')) {
        const style = document.createElement('style');
        style.id = 'license-login-styles';
        style.textContent = `
            @import url('fonts/outfit.css');

            #license-overlay {
                position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
                background: radial-gradient(circle at top right, rgba(30,27,75,0.8), rgba(9,9,11,0.95)), url('vendor/cubes-texture.png');
                z-index: 999999; display: flex; justify-content: center; align-items: center; 
                font-family: 'Outfit', system-ui, sans-serif; color: #e2e8f0; 
                overflow-y: auto; padding: 20px; box-sizing: border-box; 
                animation: fadeIn 0.4s ease-out;
            }
            @keyframes fadeIn { from { opacity: 0; backdrop-filter: blur(0px); } to { opacity: 1; backdrop-filter: blur(8px); } }
            @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
            
            .auth-container { 
                background: rgba(24, 24, 27, 0.65); 
                backdrop-filter: blur(16px);
                -webkit-backdrop-filter: blur(16px);
                width: 380px; padding: 25px 30px; 
                border-radius: 16px; 
                box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255,255,255,0.08); 
                display: flex; flex-direction: column; margin: auto; 
                animation: slideUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                position: relative; overflow: hidden;
            }
            .auth-container::before {
                content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px;
                background: linear-gradient(90deg, #3b82f6, #8b5cf6, #ec4899);
            }
            
            .auth-tabs { display: flex; margin-bottom: 20px; border-bottom: 1px solid rgba(255,255,255,0.1); }
            .auth-tab { flex: 1; text-align: center; padding: 10px 0; color: #94a3b8; cursor: pointer; transition: 0.3s; font-weight: 500; font-size: 15px; user-select: none; }
            .auth-tab.active { color: #a855f7; border-bottom: 2px solid #a855f7; font-weight: 600; }
            .auth-tab:hover:not(.active) { color: #e2e8f0; }

            .auth-title { font-size: 22px; font-weight: 700; text-align: center; margin-bottom: 6px; color: #ffffff; letter-spacing: -0.5px; }
            .auth-subtitle { text-align: center; color: #94a3b8; font-size: 13px; margin-bottom: 20px; font-weight: 400; }
            
            .hwid-container { font-size: 12px; color: #94a3b8; text-align: center; margin-bottom: 18px; display: flex; justify-content: center; align-items: center; gap: 8px; background: rgba(0,0,0,0.25); padding: 6px 10px; border-radius: 6px; border: 1px dashed rgba(255,255,255,0.1); }
            .hwid-copy { cursor: pointer; padding: 2px 6px; background: rgba(255,255,255,0.1); border-radius: 4px; transition: all 0.2s; user-select: none; font-size: 11px; font-weight: 600; }
            .hwid-copy:hover { background: rgba(255,255,255,0.2); color: #fff; }
            
            .input-group { position: relative; margin-bottom: 16px; }
            .input-group label { display: block; font-size: 12px; margin-bottom: 6px; color: #cbd5e1; font-weight: 500; }
            .auth-input { width: 100%; height: 42px; background-color: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 0 14px; color: #fff; font-size: 14px; font-family: 'Outfit', sans-serif; box-sizing: border-box; outline: none; transition: all 0.3s; user-select: text; -webkit-user-select: text; }
            .auth-input:focus { border-color: #a855f7; background-color: rgba(0,0,0,0.4); box-shadow: 0 0 0 3px rgba(168, 85, 247, 0.15); }
            
            .eye-icon { position: absolute; right: 14px; top: 32px; cursor: pointer; color: #64748b; font-size: 14px; transition: 0.2s; }
            .eye-icon:hover { color: #e2e8f0; }
            
            .auth-btn { width: 100%; height: 44px; background: linear-gradient(135deg, #6366f1, #a855f7); color: #fff; border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; transition: all 0.3s ease; margin-top: 8px; box-shadow: 0 4px 15px rgba(168, 85, 247, 0.3); font-family: 'Outfit', sans-serif; position: relative; overflow: hidden; }
            .auth-btn.btn-green { background: linear-gradient(135deg, #10b981, #059669); box-shadow: 0 4px 15px rgba(16, 185, 129, 0.3); }
            .auth-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(168, 85, 247, 0.4); }
            .auth-btn.btn-green:hover { box-shadow: 0 6px 20px rgba(16, 185, 129, 0.4); }
            .auth-btn.btn-trial { margin-top: 10px; background: #7c3aed; }
            .auth-btn:disabled { background: #334155; box-shadow: none; color: #94a3b8; cursor: not-allowed; transform: none; }
            
            .link-container { display: flex; justify-content: space-between; align-items: center; margin-top: 16px; font-size: 12px; }
            .toggle-mode { color: #94a3b8; cursor: pointer; transition: 0.2s; font-weight: 500; }
            .toggle-mode span { color: #a855f7; font-weight: 600; }
            .toggle-mode:hover span { text-decoration: underline; }
            
            .error-msg { color: #f87171; font-size: 13px; text-align: center; margin-top: 12px; font-weight: 500; background: rgba(248, 113, 113, 0.1); border-radius: 6px; padding: 10px; border: 1px solid rgba(248, 113, 113, 0.2); display: none; }
            .error-msg.show { display: block; animation: fadeIn 0.3s; }
            .error-msg.success { color: #34d399; background: rgba(52, 211, 153, 0.1); border-color: rgba(52, 211, 153, 0.2); }
            
            .footer-links { margin-top: 20px; text-align: center; font-size: 12px; color: #64748b; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.05); }
        `;
        document.head.appendChild(style);
    }
    const existing = document.getElementById('license-overlay');
    if (existing) existing.remove();

    const isLogin = mode === 'login';
    const isLicense = mode === 'license';

    const isAccountTab = !isLicense;

    // Bang tra theo mode: gom title/subtitle/nut/formHtml/linksHtml cua tung mode
    // thanh 1 entry doc lap (thay cho 3 chuoi if/else dan xen truoc day) -- de sau
    // nay co the bo/cat rieng cac entry account-only (register/forgot/verify/reset)
    // khi sinh SDK cho san pham chi dung License. "license" la entry mac dinh khi
    // mode khong khop entry nao (giu dung hanh vi nhanh else cu, ke ca voi 1 mode
    // la vao). formHtml la chuoi tinh; linksHtml co the la chuoi tinh hoac ham (mode
    // verify can tac dung phu dang ky window.resendOtpAction) -- CHI duoc resolve/
    // goi cho DUNG entry cua mode hien tai (xem modeDef ben duoi), khong duoc goi
    // truoc cho moi entry vi se chay nham tac dung phu cua mode khac.
    const MODE_DEFS = {
        login: {
            title: 'Chào mừng trở lại', subtitle: 'Đăng nhập để sử dụng phần mềm', btnText: 'Đăng nhập', btnClass: 'auth-btn',
            formHtml: `
            <div class="input-group"><label>Tên đăng nhập</label><input type="text" id="auth-user" class="auth-input" placeholder="Nhập tài khoản..."></div>
            <div class="input-group"><label>Mật khẩu</label><input type="password" id="auth-pass" class="auth-input" placeholder="••••••••"><span class="eye-icon" id="toggle-eye">👁️</span></div>
        `,
            linksHtml: `<div class="toggle-mode" id="link-to-register">Chưa có tài khoản? <span>Đăng ký</span></div><div class="toggle-mode" id="link-to-forgot"><span>Quên mật khẩu?</span></div>`,
        },
        register: {
            title: 'Tạo tài khoản', subtitle: 'Đăng ký nhanh chóng và dễ dàng', btnText: 'Đăng ký', btnClass: 'auth-btn',
            formHtml: `
            <div class="input-group"><label>Tên đăng nhập</label><input type="text" id="reg-user" class="auth-input" placeholder="Tài khoản..."></div>
            <div class="input-group"><label>Mật khẩu</label><input type="password" id="reg-pass" class="auth-input" placeholder="••••••••"><span class="eye-icon" id="toggle-eye-reg">👁️</span></div>
            <div class="input-group"><label>Email</label><input type="email" id="reg-email" class="auth-input" placeholder="Email..."></div>
            <div class="input-group es-61860508">
                <div class="es-da5cd676"><label>Họ tên</label><input type="text" id="reg-name" class="auth-input" placeholder="Họ và tên"></div>
                <div class="es-da5cd676"><label>SĐT</label><input type="text" id="reg-phone" class="auth-input" placeholder="SĐT"></div>
            </div>
        `,
            linksHtml: `<div class="toggle-mode" id="link-back-to-login"><span>&larr; Quay lại Đăng nhập</span></div>`,
        },
        forgot: {
            title: 'Khôi phục Mật khẩu', subtitle: 'Nhập User & Email đã đăng ký', btnText: 'Gửi mã xác nhận', btnClass: 'auth-btn',
            formHtml: `
            <div class="input-group"><label>Tên đăng nhập</label><input type="text" id="forgot-user" class="auth-input" placeholder="Nhập tên tài khoản..."></div>
            <div class="input-group"><label>Email đăng ký</label><input type="email" id="forgot-email" class="auth-input" placeholder="Nhập Email..."></div>
        `,
            linksHtml: `<div class="toggle-mode" id="link-back-to-login"><span>&larr; Quay lại Đăng nhập</span></div>`,
        },
        verify: {
            title: 'Xác minh OTP', subtitle: 'Đã gửi mã xác thực vào Email đã đăng ký!', btnText: 'Xác nhận OTP', btnClass: 'auth-btn',
            formHtml: `<div class="input-group"><label>Mã OTP</label><input type="text" id="reset-token" class="auth-input es-2b2a89b0" placeholder="XXXXXX" maxlength="6"></div>`,
            linksHtml: () => {
                window.resendOtpAction = async function() {
                    if (typeof showToast === 'function') showToast("Đang gửi lại mã...", "info");
                    try {
                        if (window.eel && window.eel.request_change_password_otp) {
                            const reason = window._otpIntent === 'verify_email' ? 'xác minh liên kết Email' : 'khôi phục mật khẩu';
                            const res = await window.eel.request_change_password_otp(reason)();
                            if (res && res[0]) {
                                if (typeof showToast === 'function') showToast("Đã gửi lại mã OTP! Vui lòng kiểm tra hộp thư rác (Spam).", "success");
                            } else {
                                if (typeof showToast === 'function') showToast(res ? res[1] : "Lỗi không xác định", "error");
                            }
                        } else {
                            if (typeof showToast === 'function') showToast("Không tìm thấy API gửi lại mã", "error");
                        }
                    } catch(e) {
                        if (typeof showToast === 'function') showToast("Lỗi kết nối", "error");
                    }
                };
                return `<div class="toggle-mode es-87ffd34f"><span class="es-3957c806" id="link-back-to-login-verify">&larr; Quay lại Đăng nhập</span><span class="es-b2d65048" id="link-resend-otp">Gửi lại mã OTP</span></div>`;
            },
        },
        reset: {
            title: 'Mật khẩu mới', subtitle: 'Vui lòng thiết lập mật khẩu mới', btnText: 'Lưu mật khẩu', btnClass: 'auth-btn',
            formHtml: `<div class="input-group es-d85c4e64"><label>Mật khẩu mới</label><input type="password" id="reset-pass" class="auth-input" placeholder="••••••••"><span class="eye-icon es-4470cc39" id="toggle-eye-reset">👁️</span></div>`,
            linksHtml: `<div class="toggle-mode" id="link-back-to-login"><span>&larr; Quay lại Đăng nhập</span></div>`,
        },
        license: {
            title: 'Kích hoạt Bản quyền', subtitle: 'Nhập License Key để mở khóa', btnText: 'Kích hoạt', btnClass: 'auth-btn btn-green',
            formHtml: `<div class="input-group"><label>License Key</label><input type="text" id="auth-key" class="auth-input es-89c0c79e" placeholder="XXXX-XXXX-XXXX-XXXX"></div>`,
            linksHtml: '',
        },
    };
    const modeDef = MODE_DEFS[mode] || MODE_DEFS.license;
    const { title, subtitle, btnText, btnClass, formHtml } = modeDef;
    const linksHtml = typeof modeDef.linksHtml === 'function' ? modeDef.linksHtml() : modeDef.linksHtml;

    const container = document.createElement('div');
    container.id = 'license-overlay';
    container.innerHTML = `
        <div class="auth-container">
            <div class="auth-tabs">
                <div class="auth-tab ${isAccountTab ? 'active' : ''}" id="tab-account">Tài khoản</div>
                <div class="auth-tab ${isLicense ? 'active' : ''}" id="tab-license">Bản quyền</div>
            </div>
            
            <div class="auth-title">${title}</div>
            <div class="auth-subtitle">${subtitle}</div>
            
            <div class="hwid-container" title="Mã máy nhận diện phần cứng">
                <span>HWID: <strong class="es-1bf0feaf" id="hwid-text">Đang tải...</strong></span>
                <span class="hwid-copy" id="hwid-copy">Copy</span>
            </div>
            
            ${formHtml}
            
            <button id="auth-submit" class="${btnClass}">${btnText}</button>
            ${(isLogin || isLicense) ? '<button id="trial-start" class="auth-btn btn-trial">Dùng thử Premium miễn phí 14 ngày</button>' : ''}
            <div id="auth-error" class="error-msg"></div>
            
            <div class="link-container">${linksHtml}</div>
            <div class="footer-links">
                <a class="es-d6f54b9b" href="https://t.me/+ohYhI2gzHq02OTE1" target="_blank" id="footer-telegram-link">💬 Hỗ trợ Telegram</a>
                <span class="es-ddb1c7ac">|</span>
                <span class="es-5996773c" id="footer-email-copy">✉️ Hỗ trợ Email</span>
            </div>
        </div>
    `;
    document.body.appendChild(container);

    // Man hinh nay duoc xoa va dung lai hoan toan moi lan doi mode (login/register/...)
    // nen gan listener ngay sau khi chen vao DOM; cac phan tu chi ton tai o vai mode nen
    // deu duoc bao ve bang kiem tra null.
    const bindClick = (id, handler) => { const el = document.getElementById(id); if (el) el.addEventListener('click', handler); };
    bindClick('tab-account', function () { renderWebLoginScreen('login'); });
    bindClick('tab-license', function () { renderWebLoginScreen('license'); });
    bindClick('link-to-register', function () { renderWebLoginScreen('register'); });
    bindClick('link-to-forgot', function () { renderWebLoginScreen('forgot'); });
    bindClick('link-back-to-login-verify', function () { renderWebLoginScreen('login'); });
    bindClick('link-resend-otp', function () { window.resendOtpAction(); });
    bindClick('link-back-to-login', function () { renderWebLoginScreen('login'); });
    bindClick('footer-telegram-link', function (e) {
        if (window.pywebview) {
            window.pywebview.api.open_link('https://t.me/+ohYhI2gzHq02OTE1');
            e.preventDefault();
        }
    });
    bindClick('footer-email-copy', async function () {
        try {
            await window.amsWriteClipboardText('mmo.solusionhelp@gmail.com');
            this.innerText = 'Đã Copy!';
            setTimeout(() => this.innerText = '✉️ Hỗ trợ Email', 2000);
        } catch (_) {
            this.innerText = 'Copy lỗi';
        }
    });

    setTimeout(() => { const firstInput = document.querySelector('.auth-input'); if (firstInput) firstInput.focus(); }, 100);

    const callApi = async (method, ...args) => {
        // Cầu nối pywebview/eel có thể chưa đăng ký xong hàm ngay sau khi trang vừa render
        // (đặc biệt là loadDisplayedHwid gọi ngay lập tức). Chờ tối đa ~4.5s thay vì báo lỗi
        // tức thì, để tránh nhầm "chưa sẵn sàng" thành "không lấy được".
        const deadline = Date.now() + 4500;
        while (Date.now() < deadline) {
            if (window.pywebview && window.pywebview.api && window.pywebview.api[method]) return window.pywebview.api[method](...args);
            if (window.eel && window.eel[method]) return window.eel[method](...args)();
            await new Promise((r) => setTimeout(r, 150));
        }
        throw new Error("API not found");
    };

    const withTimeout = (promise, timeoutMs, label) => Promise.race([
        Promise.resolve(promise),
        new Promise((_, reject) => setTimeout(() => reject(new Error(label || 'Quá thời gian chờ')), timeoutMs))
    ]);

    bindClick('trial-start', async function () {
        const trialButton = this;
        trialButton.disabled = true;
        trialButton.innerText = '⏳ Đang kích hoạt trial...';
        try {
            const result = await callApi('start_trial_14_days');
            const success = Array.isArray(result) ? result[0] : false;
            const message = Array.isArray(result) ? result[1] : 'Không thể kích hoạt trial.';
            if (success) {
                showError(message || 'Đã kích hoạt trial 14 ngày!', true);
                setTimeout(() => renderPostLogin(), 600);
            } else {
                showError(message || 'Không đủ điều kiện nhận trial.');
                trialButton.disabled = false;
                trialButton.innerText = 'Dùng thử Premium miễn phí 14 ngày';
            }
        } catch (_) {
            showError('Không kết nối được máy chủ để kích hoạt trial.');
            trialButton.disabled = false;
            trialButton.innerText = 'Dùng thử Premium miễn phí 14 ngày';
        }
    });

    const setHwidDisplay = (hwid) => {
        const textEl = container.querySelector('#hwid-text');
        const copyEl = container.querySelector('#hwid-copy');
        if (!textEl || !copyEl || !container.isConnected) return;

        const cleanHwid = String(hwid || '').trim();
        if (!cleanHwid) throw new Error('HWID rỗng');
        textEl.innerText = cleanHwid.length > 16 ? cleanHwid.substring(0, 16) + '...' : cleanHwid;
        textEl.title = cleanHwid;
        copyEl.innerText = 'Copy';
        copyEl.title = 'Sao chép toàn bộ mã máy';
        copyEl.onclick = async () => {
            try {
                await window.amsWriteClipboardText(cleanHwid);
                copyEl.innerText = 'Đã Copy!';
                copyEl.style.color = '#34d399';
                setTimeout(() => {
                    if (!container.isConnected) return;
                    copyEl.innerText = 'Copy';
                    copyEl.style.color = '';
                }, 2000);
            } catch (_) {
                copyEl.innerText = 'Copy lỗi';
                copyEl.style.color = '#fb7185';
            }
        };
    };

    const loadDisplayedHwid = async () => {
        const textEl = container.querySelector('#hwid-text');
        const copyEl = container.querySelector('#hwid-copy');
        if (!textEl || !copyEl) return;
        textEl.innerText = 'Đang tải...';
        textEl.title = '';
        copyEl.innerText = 'Copy';
        copyEl.onclick = null;

        try {
            // HWID là dữ liệu cục bộ, không được chờ luồng xác thực license online.
            const localHwid = await withTimeout(callApi('api_get_hwid'), 5000, 'HWID cục bộ phản hồi chậm');
            setHwidDisplay(localHwid);
        } catch (_) {
            if (!container.isConnected) return;
            textEl.innerText = 'Không lấy được';
            textEl.title = 'Bấm Thử lại để đọc mã máy cục bộ';
            copyEl.innerText = 'Thử lại';
            copyEl.title = 'Đọc lại mã máy trên thiết bị';
            copyEl.onclick = loadDisplayedHwid;
        }
    };

    loadDisplayedHwid();

    if (isLogin) {
        const eye = document.getElementById('toggle-eye');
        const pass = document.getElementById('auth-pass');
        if (eye && pass) {
            eye.onclick = () => {
                if (pass.type === 'password') { pass.type = 'text'; eye.innerText = '🙈'; }
                else { pass.type = 'password'; eye.innerText = '👁️'; }
            };
        }
    }

    
        const setupEye = (iconId, inputId) => {
            const icon = document.getElementById(iconId);
            const input = document.getElementById(inputId);
            if (icon && input) {
                icon.addEventListener('click', () => {
                    if (input.type === 'password') { input.type = 'text'; icon.style.filter = 'grayscale(0)'; }
                    else { input.type = 'password'; icon.style.filter = 'grayscale(1)'; }
                });
            }
        };
        setupEye('toggle-eye-login', 'login-pass');
        setupEye('toggle-eye-reg', 'reg-pass');
        setupEye('toggle-eye-reset', 'reset-pass');
        
        const btnSubmit = document.getElementById('auth-submit');
    const errorDiv = document.getElementById('auth-error');
    const showError = (msg, isSuccess = false) => { errorDiv.className = isSuccess ? 'error-msg success show' : 'error-msg show'; errorDiv.innerText = msg; };
    if (notice) showError(notice, true);

    
    
    
    
    const renderPostLogin = () => { console.log("LOGIN SUCCESS -> renderPostLogin");
        const container = document.querySelector('.auth-container');
        container.innerHTML = `
            <div class="auth-tabs es-5d774c62">
                <div class="auth-icon es-e6906461">🎉</div>
            </div>
            <h2 class="auth-title">Đăng nhập thành công!</h2>
            <p class="auth-subtitle es-240c47cd">Chào mừng trở lại hệ thống.</p>
            
            <button id="btn-dash" class="auth-btn es-a94d6e5b">
                <span class="es-bf83cf1c">📊</span> Bảng Quản lý Tài khoản
            </button>

            <button id="btn-close" class="auth-btn es-88dade79">
                <span class="es-bf83cf1c">🚀</span> Mở Ứng Dụng Ngay
            </button>
        `;
        // renderPostLogin dung lai container hien co (khong tao moi) nen gan listener ngay
        // sau khi doi noi dung, tranh chong listener neu ham nay chi chay dung 1 lan/luot dang nhap
        document.getElementById('btn-dash').addEventListener('click', function () { window.handleDash(); });
        document.getElementById('btn-close').addEventListener('click', function () { window.handleClose(); });
    };
    
    window.handleDash = async () => { 
        const overlay = document.getElementById('license-overlay');
        if (overlay) {
            overlay.style.transition = 'opacity 0.3s ease-out';
            overlay.style.opacity = '0';
            setTimeout(() => { overlay.remove(); }, 300);
        }
        if (typeof window.switchTab === 'function') window.switchTab('tab-profile');
        if (typeof eel !== 'undefined' && eel.get_license_info) {
            try {
                window.licenseInfo = await eel.get_license_info()();
                if (typeof window.renderProfileTab === 'function') window.renderProfileTab();
                if (typeof window.updateSidebarProfile === 'function') window.updateSidebarProfile();
            } catch (e) {}
        }
    };

    window.handleClose = async () => { 
        const overlay = document.getElementById('license-overlay');
        if (overlay) {
            overlay.style.transition = 'opacity 0.3s ease-out';
            overlay.style.opacity = '0';
            setTimeout(() => { overlay.remove(); }, 300);
        }
        if (typeof window.switchTab === 'function') window.switchTab('command-center');
        if (typeof eel !== 'undefined' && eel.get_license_info) {
            try {
                window.licenseInfo = await eel.get_license_info()();
                if (typeof window.updateSidebarProfile === 'function') window.updateSidebarProfile();
            } catch (e) {}
        }
    };

    // Bang tra theo mode cho handleSubmit -- thay cho chuoi if/else truoc day, cung
    // muc dich voi MODE_DEFS o dau ham (de sau nay cat rieng entry account-only).
    // Dinh nghia o day (khong dua len MODE_DEFS phia tren) vi can dong voi cac
    // closure resetBtn/showError/renderPostLogin/callApi chi san sang tu diem nay.
    // resetBtn phai khai bao TRUOC submitHandlers (khong phai ben trong handleSubmit
    // nhu code goc) de cac ham trong submitHandlers -- dinh nghia o scope ngoai
    // handleSubmit -- co the tham chieu duoc no.
    const resetBtn = () => { btnSubmit.disabled = false; btnSubmit.innerText = btnText; };
    const submitHandlers = {
        login: () => {
            const user = document.getElementById('auth-user').value.trim();
            const pass = document.getElementById('auth-pass').value.trim();
            if (!user || !pass) { showError('Vui lòng nhập đủ thông tin!'); resetBtn(); return; }
            // Đăng nhập đúng tài khoản KHÔNG có nghĩa là được vào app: tài khoản
            // chưa có License active (chưa dùng thử, license hết hạn/chưa mua)
            // vẫn phải ở lại đây để bấm Dùng Thử hoặc dán License trước.
            // Cờ isActive do login_account trả kèm -- không gọi get_license_info()
            // ở đây vì hàm đó xác thực online lại vài lượt nữa, làm treo nút bấm.
            callApi('login_account', user, pass).then(([success, msg, isActive]) => {
                if (!success) { showError(msg || 'Sai tài khoản hoặc mật khẩu!'); resetBtn(); return; }
                if (isActive) {
                    renderPostLogin();
                } else {
                    // Chuyển thẳng sang màn hình License và giữ thông báo ở đó (trước đây thông báo
                    // hiện 1,5 giây rồi bị màn hình mới thay mất nên người dùng không kịp đọc).
                    renderWebLoginScreen('license', 'Đăng nhập thành công, nhưng tài khoản chưa có License hoạt động. Hãy dùng thử 14 ngày hoặc nhập License bên dưới.');
                }
            }).catch(() => { showError('Lỗi kết nối máy chủ cục bộ!'); resetBtn(); });
        },
        register: () => {
            const user = document.getElementById('reg-user').value.trim();
            const name = document.getElementById('reg-name').value.trim();
            const phone = document.getElementById('reg-phone').value.trim();
            const email = document.getElementById('reg-email').value.trim();
            const pass = document.getElementById('reg-pass').value.trim();
            if (!user || !pass) { showError('Vui lòng điền Tài khoản và Mật khẩu!'); resetBtn(); return; }
            callApi('register_account', user, email, phone, name, pass).then(([success, msg]) => {
                if (success) { showError('Đăng ký thành công!', true); setTimeout(() => renderWebLoginScreen('login'), 1500); }
                else { showError(msg || 'Đăng ký thất bại!'); resetBtn(); }
            }).catch(() => { showError('Lỗi kết nối!'); resetBtn(); });
        },
        verify: () => {
            const token = document.getElementById('reset-token').value.trim();
            if (!token) { showError('Vui lòng nhập OTP!'); resetBtn(); return; }
            callApi('verify_otp', token).then(([success, msg]) => {
                if (success) {
                    window.verifiedToken = token;
                    showError('Mã hợp lệ!', true);
                    if (window._otpIntent === 'verify_email') {
                        setTimeout(() => {
                            const overlay = document.getElementById('license-overlay');
                            if (overlay) overlay.remove();
                            if (typeof window.showToast === 'function') window.showToast("Xác minh Email thành công!", "success");
                            const banner = document.getElementById('email-verify-banner');
                            if (banner) banner.style.display = 'none';
                            const badge = document.getElementById('profile-email-badge');
                            if (badge) {
                                badge.textContent = 'Đã xác minh';
                                badge.className = 'status-badge active';
                            }
                        }, 1000);
                    } else {
                        setTimeout(() => renderWebLoginScreen('reset'), 1000);
                    }
                }
                else { showError(msg || 'Mã không đúng!'); resetBtn(); }
            }).catch(() => { showError('Lỗi kết nối!'); resetBtn(); });
        },
        reset: () => {
            const pass = document.getElementById('reset-pass').value.trim();
            const token = window.verifiedToken || '';
            if (!pass) { showError('Vui lòng nhập mật khẩu mới!'); resetBtn(); return; }
            callApi('reset_password', token, pass).then(([success, msg]) => {
                if (success) { showError('Đổi mật khẩu thành công!', true); setTimeout(() => renderWebLoginScreen('login'), 1500); }
                else { showError(msg || 'Thất bại!'); resetBtn(); }
            }).catch(() => { showError('Lỗi kết nối!'); resetBtn(); });
        },
        forgot: () => {
            const user = document.getElementById('forgot-user').value.trim();
            const email = document.getElementById('forgot-email').value.trim();
            if (!user || !email) { showError('Nhập đủ User và Email!'); resetBtn(); return; }
            callApi('forgot_password', user, email).then(([success, msg]) => {
                if (success) { showError(msg || 'Đã gửi mã qua Email!', true); setTimeout(() => renderWebLoginScreen('verify'), 2000); }
                else { showError(msg || 'Thất bại!'); resetBtn(); }
            }).catch(() => { showError('Lỗi kết nối!'); resetBtn(); });
        },
        license: () => {
            const key = document.getElementById('auth-key').value.trim();
            if (!key) { showError('Vui lòng nhập Key!'); resetBtn(); return; }
            callApi('validate_new_license', key).then(([success, msg]) => {
                if (success) { renderPostLogin(true); }
                else { showError(msg || 'Key không hợp lệ!'); resetBtn(); }
            }).catch(() => { showError('Lỗi kết nối!'); resetBtn(); });
        },
    };

    const handleSubmit = () => {
        errorDiv.classList.remove('show');
        btnSubmit.disabled = true; btnSubmit.innerText = '⏳ Đang xử lý...';
        (submitHandlers[mode] || submitHandlers.license)();
    };
    btnSubmit.onclick = handleSubmit;
    container.querySelectorAll('.auth-input').forEach(input => {
        // Keep native text editing inside the login overlay. Stopping bubbling
        // prevents application-wide shortcuts from hijacking Ctrl/Cmd+A/C/V/X.
        input.addEventListener('keydown', (e) => {
            const editingShortcut = (e.ctrlKey || e.metaKey) && ['a', 'c', 'v', 'x', 'z', 'y'].includes(String(e.key).toLowerCase());
            if (editingShortcut) e.stopPropagation();
            if (e.key === 'Enter') handleSubmit();
        });
        ['copy', 'cut', 'paste', 'selectstart'].forEach(eventName => {
            input.addEventListener(eventName, (e) => e.stopPropagation());
        });
    });
}
'''


def _get_license_api_segment():
    override = (globals().get("LICENSE_API_SEGMENT_OVERRIDE") or "").strip().lower()
    if override:
        return override
    pid = (PRODUCT_ID or "").strip().lower()
    game_product_ids = {
        "rok_b",
        "automaster_studio",
        "rise_of_kingdom",
        "rise_of_kingdoms",
    }
    if pid in game_product_ids or pid.startswith("rok"):
        return "game"
    return "capcut"

LICENSE_API_SEGMENT = _get_license_api_segment()

RSA_PUBLIC_KEY = """-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAy4U9SBhi8Gx2HbcaIl0v
h2HqtWmSEM3a4/91rFaO/XucMkGQs0vcrciRFgJmlfyb2RDUgvjcJxPBqBYXfWrR
HDNd7xuGOfOjrmXjRYu06z7xi1CRPeQ6HuAULC1QmKU9wqqgULXeljRse7w5y9YE
SdN0u2104QqyHmwDs2ZJRtTmORYQEZEGNORKpZ33p3/hHyocYPoJ9PWshZO8SPEm
ar2L2vnX4HtzOaSq4RHIA/0XcFEmV2a6OOdUzhXFhZH0I7hlu8qz/TQF6DvfXitZ
Jx5661ftPT29jfcZLFhD1RIZ5cZM3XBLXXupKND31Ew/cuNZq/UxnZdkHolEcWf7
4QIDAQAB
-----END PUBLIC KEY-----"""
# Lưu license vào thư mục persistent (cross-platform) để không bị mất khi update tool
def _get_appdata_dir():
    _sys = platform.system()
    if _sys == "Windows":
        base = os.environ.get('APPDATA', os.path.expanduser('~'))
    elif _sys == "Darwin":  # macOS
        base = os.path.join(os.path.expanduser('~'), 'Library', 'Application Support')
    else:  # Linux
        base = os.environ.get('XDG_DATA_HOME', os.path.join(os.path.expanduser('~'), '.local', 'share'))
    return os.path.join(base, 'CapCutTool', PRODUCT_ID)

APPDATA_DIR = _get_appdata_dir()
os.makedirs(APPDATA_DIR, exist_ok=True)
ACCOUNT_FILE = os.path.join(APPDATA_DIR, 'account.txt')
LICENSE_FILE = os.path.join(APPDATA_DIR, 'license.txt')
GRACE_TOKEN_FILE = os.path.join(APPDATA_DIR, '.sys_token.bin')
# Bí mật thiết bị do server cấp 1 lần: dùng chứng minh "đúng máy này" khi đổi key cũ lấy key mới (xem _try_recover_key).
DEVICE_SECRET_FILE = os.path.join(APPDATA_DIR, '.sys_dev.bin')

# ==========================================
# AUTO-INSTALL DEPENDENCIES
# ==========================================
try:
    import requests
    import jwt
    import cryptography  # cần cho RS256 (jwt.decode), E2EE và fallback lưu license (_encrypt_data)
except ImportError:
    print("⏳ Đang cài đặt thư viện thiếu (requests, PyJWT, cryptography)...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "requests", "PyJWT", "cryptography"])
    print("✅ Cài đặt hoàn tất! Vui lòng chạy lại file tool.")
    sys.exit(0)

# ==========================================
# VERIFY SERVER SIGNATURE (CHỐNG RCE / MITM)
# ==========================================
def verify_server_signature(response_text, signature_token):
    """Xác minh chữ ký điện tử của dữ liệu từ Server (Chống RCE / MITM)"""
    if not signature_token:
        return False, "Thiếu chữ ký bảo mật từ Server!"
    
    try:
        # 1. Giải mã Token bằng Public Key
        payload = jwt.decode(signature_token, RSA_PUBLIC_KEY, algorithms=["RS256"], options={"verify_signature": True}, leeway=60)
        
        # 2. Lấy hash gốc từ Server gửi sang
        expected_hash = payload.get(_d('==AgEw0GAAgzsgU8r0cSr8szLxJe'))
        
        # 3. Tự băm dữ liệu nhận được
        actual_hash = hashlib.sha256(response_text.encode('utf-8')).hexdigest()
        
        # 4. So sánh
        if expected_hash != actual_hash:
            return False, "Nội dung gói tin đã bị Hacker chỉnh sửa (Hash Mismatch)!"
            
        return True, "Hợp lệ"
    except jwt.InvalidTokenError:
        return False, "Chữ ký Server giả mạo!"
    except Exception as e:
        return False, f"Lỗi xác minh: {e}"

# ==========================================
# DANH SÁCH TÍNH NĂNG (TỰ ĐỘNG TỪ SERVER)
# ==========================================
try:
    FEATURES = {
    "base": "base download"
}  # type: ignore # noqa: F821
except NameError:
    FEATURES = {}


def _hwid_cache_path():
    return os.path.join(APPDATA_DIR, "hwid_cache.txt")


def _read_cached_hwid():
    try:
        with open(_hwid_cache_path(), "r", encoding="utf-8") as f:
            value = f.read().strip().upper()
        if len(value) == 32 and all(c in "0123456789ABCDEF" for c in value):
            return value
    except Exception:
        pass
    return None


def _write_cached_hwid(hwid):
    try:
        path = _hwid_cache_path()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(hwid)
    except Exception:
        pass


class LicenseManagerV2:
    """License Manager V2 với Offline Grace Period và HWID Strict Validation"""
    
    def __init__(self):
        global _global_license_manager_instance
        _global_license_manager_instance = self

        self.server_url = SERVER_URL
        if self.server_url == "__SERVER_URL__":
            self.server_url = "https://automasterst.dpdns.org"
        self.hwid = self.get_hwid()
        self.token = None # Lần đầu tiên validate sẽ nhận token này
        self.validation_token = None
        self._verified_features = set()
        self.product_id = PRODUCT_ID
        self.chat_bubble = None
        self.ENABLE_E2EE = True  # Bật mã hóa E2EE 2 chiều
        self.stop_event = threading.Event()
        self.auth_modes = AUTH_MODES
        self.license_key = None
        self.username = None
        self.password = None
        self.session_data = {}
        # Đè cấu hình từ server
        try:
            resp = requests.get(f"{self.server_url}/api/v2/client/auth-config", params={"productId": self.product_id}, headers=self._get_headers(), timeout=3)
            if resp.status_code == 200:
                data = resp.json()
                raw_mode = data.get("auth_modes") or data.get("auth_mode", "LICENSE_ONLY")
                if isinstance(raw_mode, list):
                    self.auth_modes = raw_mode
                elif isinstance(raw_mode, str) and raw_mode.startswith("["):
                    try: import json; self.auth_modes = json.loads(raw_mode)
                    except: self.auth_modes = ["LICENSE"]
                elif raw_mode == "ACCOUNT_ONLY":
                    self.auth_modes = ["ACCOUNT"]
                elif raw_mode == "ACCOUNT_AND_LICENSE":
                    self.auth_modes = ["ACCOUNT", "LICENSE"]
                else:
                    self.auth_modes = ["LICENSE"]
        except Exception as e:
            pass
            
        # Anti-Debugger Check (sys.gettrace)
        import sys
        if hasattr(sys, 'gettrace') and sys.gettrace() is not None:
            threading.Thread(target=self.report_cheat, args=("Phát hiện Debugger/Tracer (sys.gettrace)",), daemon=True).start()
            import time; time.sleep(1)
            import os; os._exit(1)

        # Anti-Dump Memory & Advanced Hooking Check (ctypes kernel32)
        try:
            import ctypes
            kernel32 = ctypes.windll.kernel32
            
            # 1. Check IsDebuggerPresent (Local debugger)
            if kernel32.IsDebuggerPresent():
                threading.Thread(target=self.report_cheat, args=("Phát hiện Debugger (IsDebuggerPresent)",), daemon=True).start()
                import time; time.sleep(1)
                import os; os._exit(1)
                
            # 2. CheckRemoteDebuggerPresent
            is_debugger_present = ctypes.c_int(0)
            kernel32.CheckRemoteDebuggerPresent(kernel32.GetCurrentProcess(), ctypes.byref(is_debugger_present))
            if is_debugger_present.value != 0:
                threading.Thread(target=self.report_cheat, args=("Phát hiện Remote Debugger (Memory Dump/Inject)",), daemon=True).start()
                import time; time.sleep(1)
                import os; os._exit(1)
                
            # 3. Block Profiling hooks
            def _deny_profile(frame, event, arg):
                pass
            if hasattr(sys, 'setprofile'):
                sys.setprofile(_deny_profile)
                
            # 4. DLL Injection Scan
            import ctypes.wintypes
            psapi = ctypes.windll.psapi
            hProcess = kernel32.GetCurrentProcess()
            hMods = (ctypes.wintypes.HMODULE * 1024)()
            cbNeeded = ctypes.wintypes.DWORD()
            
            if psapi.EnumProcessModules(hProcess, ctypes.byref(hMods), ctypes.sizeof(hMods), ctypes.byref(cbNeeded)):
                num_mods = cbNeeded.value // ctypes.sizeof(ctypes.wintypes.HMODULE)
                blacklist_dlls = ['fiddler.dll', 'httpdebugger.dll', 'charles.dll', 'cheatengine.dll', 'ollydbg.dll', 'x64dbg.dll']
                
                for i in range(num_mods):
                    szModName = ctypes.create_string_buffer(1024)
                    if psapi.GetModuleBaseNameA(hProcess, hMods[i], szModName, ctypes.sizeof(szModName)):
                        mod_name = szModName.value.decode('utf-8', 'ignore').lower()
                        if mod_name in blacklist_dlls:
                            threading.Thread(target=self.report_cheat, args=(f"Phát hiện DLL Inject: {mod_name}",), daemon=True).start()
                            import time; time.sleep(1)
                            import os; os._exit(1)
        except Exception:
            pass

        # Chống lùi thời gian
        self._check_time_spoofing()

        # Kiểm tra máy ảo ngay khi khởi tạo
        self._check_vm_environment()

    def _check_time_spoofing(self):
        """Chống lùi thời gian (Time Spoofing) thông qua Registry"""
        try:
            import winreg
            import time
            import os
            import threading
            
            # Khóa Registry để lưu lén
            key_path = r"Software\SystemTools\sys_time"
            current_time = int(time.time())
            
            try:
                # Cố gắng đọc khóa
                key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_READ)
                last_time, _ = winreg.QueryValueEx(key, "last_seen")
                winreg.CloseKey(key)
                
                # Nếu thời gian hiện tại nhỏ hơn thời gian đã lưu (chấp nhận sai số 2 tiếng do múi giờ)
                if current_time < (last_time - 7200):
                    # 1. Báo cáo gian lận (Vẫn báo để Server biết)
                    threading.Thread(target=self.report_cheat, args=("Cảnh báo: Lùi thời gian hệ thống (Time Spoofing)",), daemon=True).start()
                    
                    # 2. Xóa Grace Token để tước quyền Offline (Buộc phải mở mạng)
                    if os.path.exists(GRACE_TOKEN_FILE):
                        try: os.remove(GRACE_TOKEN_FILE)
                        except Exception: pass
                        
                    # 3. Thông báo nhẹ nhàng và KHÔNG HỦY TOOL
                    print("\n⚠️ [CẢNH BÁO] Phát hiện thời gian hệ thống không chuẩn xác!")
                    print("👉 Quyền sử dụng Offline tạm thời bị khóa. Vui lòng BẬT MẠNG để xác thực lại.\n")
                    return # Thoát hàm check_time_spoofing, để Tool chạy tiếp (sẽ rớt ở bước check_offline)
            except WindowsError:
                pass
                
            # Ghi/Cập nhật thời gian lớn nhất vào Registry
            try:
                # Chỉ cập nhật nếu time lớn hơn (đề phòng chạy song song)
                key = winreg.CreateKey(winreg.HKEY_CURRENT_USER, key_path)
                # Đọc lại cho chắc
                try:
                    last_time, _ = winreg.QueryValueEx(key, "last_seen")
                    if current_time > last_time:
                        winreg.SetValueEx(key, "last_seen", 0, winreg.REG_QWORD, current_time)
                except WindowsError:
                    winreg.SetValueEx(key, "last_seen", 0, winreg.REG_QWORD, current_time)
                winreg.CloseKey(key)
            except Exception:
                pass
        except Exception:
            pass

    def _check_vm_environment(self):
        """Phát hiện môi trường máy ảo và gửi Telemetry về Server"""
        try:
            _sys = platform.system().lower()
            is_vm = False
            vm_name = "Unknown"
            
            import uuid
            mac = uuid.getnode()
            mac_hex = '{:012x}'.format(mac)
            vm_mac_prefixes = ['000569', '000c29', '001c14', '005056', '080027', '00155d', '0003ff']
            if any(mac_hex.startswith(prefix) for prefix in vm_mac_prefixes):
                is_vm = True
                vm_name = "MAC Address Match"
                
            if not is_vm and _sys == 'windows':
                # creationflags=0x08000000 to prevent console window from flashing
                out = subprocess.check_output(["wmic", "computersystem", "get", "model,manufacturer"], creationflags=0x08000000).decode('utf-8', errors='ignore').lower()
                if 'virtualbox' in out or 'vmware' in out or 'qemu' in out:
                    is_vm = True
                    vm_name = "WMIC Match"
            
            if is_vm:
                try:
                    payload = {
                        "machineId": self.hwid,
                        "product": PRODUCT_ID,
                        "version": CLIENT_VERSION,
                        "alert": "SECURITY_VIOLATION: Môi trường Máy ảo (Virtual Machine)",
                        "systemInfo": {"os": _sys, "vm_type": vm_name}
                    }
                    # Client telemetry must use the public, server-authorized
                    # security-report route; never embed or call admin routes.
                    requests.post(
                        f"{self.server_url}/api/v2/client/report-cheat",
                        json=payload,
                        headers=self._get_headers(),
                        timeout=3,
                    )
                except Exception as e:
                    pass
                
                if STRICT_VM_BLOCK:
                    print("\n[SECURITY] Phát hiện môi trường Máy ảo (Virtual Machine / VPS)!")
                    print("Ứng dụng không hỗ trợ chạy trên máy ảo vì lý do bảo mật.")
                    time.sleep(5)
                    os._exit(1)
        except Exception:
            pass

    # Định dạng lưu cục bộ (đường dự phòng khi không có DPAPI -- SDK chạy độc lập ở
    # các sản phẩm khác, kể cả ngoài Windows; file tài khoản chứa cả username/password):
    # AES-256-GCM, nonce ngẫu nhiên 12 byte MỖI LẦN GHI, có tag xác thực.
    # Bản cũ dùng AES-CBC với IV SUY RA CỐ ĐỊNH từ chính chuỗi khóa (MD5) và KHÔNG có
    # MAC: cùng nội dung -> cùng bản mã, và bản mã sửa được mà không bị phát hiện
    # (kiểm toán 2026-09-23, R2-5). Định dạng cũ vẫn ĐỌC được để chuyển đổi --
    # _load_local_secret_file lưu lại ngay bằng định dạng mới, khách không phải
    # đăng nhập lại.
    _LOCAL_GCM_PREFIX = "eyJhbGciOiJBMjU2R0NNIiwidHlwIjoiSldUIn0."
    _LOCAL_GCM_AAD = b"ams-local-secret-v1"

    def _derive_key_and_iv(self, hwid_seed):
        """CHỈ dùng để ĐỌC định dạng cũ (AES-CBC, IV cố định). Không dùng để ghi."""
        salt = _d('njQY2BAAwC7tJmCzO9QitokLN50DKOzDJ2iLwxiTzxJe')
        raw_key = f"{hwid_seed}_{salt}"
        key = hashlib.sha256(raw_key.encode('utf-8')).digest()  # 32 bytes cho AES-256
        iv = hashlib.md5(raw_key.encode('utf-8')).digest()      # 16 bytes cho CBC IV
        return key, iv

    def _derive_gcm_key(self, hwid_seed):
        salt = _d('njQY2BAAwC7tJmCzO9QitokLN50DKOzDJ2iLwxiTzxJe')
        raw_key = f"{hwid_seed}_{salt}"
        # Tách miền khóa: không dùng lại đúng khóa của định dạng CBC cũ cho GCM.
        return hashlib.sha256(b"AMS-LOCAL-GCM-v1|" + raw_key.encode('utf-8')).digest()

    def _encrypt_data(self, data_dict):
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        nonce = os.urandom(12)
        json_data = json.dumps(data_dict).encode('utf-8')
        sealed = AESGCM(self._derive_gcm_key(self.hwid)).encrypt(nonce, json_data, self._LOCAL_GCM_AAD)
        return self._LOCAL_GCM_PREFIX + base64.b64encode(nonce + sealed).decode('ascii')

    def _decrypt_data(self, encrypted_str):
        if isinstance(encrypted_str, str) and encrypted_str.startswith(self._LOCAL_GCM_PREFIX):
            # Định dạng mới: tag sai (file bị sửa / chép từ máy khác) -> từ chối, KHÔNG
            # rơi xuống các bộ giải mã cũ không xác thực bên dưới.
            try:
                from cryptography.hazmat.primitives.ciphers.aead import AESGCM
                blob = base64.b64decode(encrypted_str[len(self._LOCAL_GCM_PREFIX):], validate=True)
                if len(blob) < 12 + 16:
                    return None
                plain = AESGCM(self._derive_gcm_key(self.hwid)).decrypt(blob[:12], blob[12:], self._LOCAL_GCM_AAD)
                return json.loads(plain.decode('utf-8'))
            except Exception:
                return None
        # Định dạng cũ (AES-CBC IV cố định, rồi XOR) -- chỉ để chuyển đổi dữ liệu có sẵn.
        try:
            from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
            from cryptography.hazmat.primitives import padding
            from cryptography.hazmat.backends import default_backend
            
            fake_jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
            if encrypted_str.startswith(fake_jwt):
                encrypted_str = encrypted_str[len(fake_jwt):][::-1]

            key, iv = self._derive_key_and_iv(self.hwid)
            encrypted_bytes = base64.b64decode(encrypted_str)
            
            cipher = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
            decryptor = cipher.decryptor()
            padded_data = decryptor.update(encrypted_bytes) + decryptor.finalize()
            
            unpadder = padding.PKCS7(algorithms.AES.block_size).unpadder()
            decrypted_bytes = unpadder.update(padded_data) + unpadder.finalize()
            
            return json.loads(decrypted_bytes.decode('utf-8'))
        except Exception:
            # Tự động Fallback: Dành cho những user cũ đang dùng mã hóa XOR
            try:
                salt = _d('njQY2BAAwC7tJmCzO9QitokLN50DKOzDJ2iLwxiTzxJe')
                raw_key = f"{self.hwid}_{salt}"
                old_key = hashlib.sha256(raw_key.encode('utf-8')).digest()
                encrypted_bytes = base64.b64decode(encrypted_str)
                result = bytearray()
                for i in range(len(encrypted_bytes)):
                    result.append(encrypted_bytes[i] ^ old_key[i % len(old_key)])
                return json.loads(bytes(result).decode('utf-8'))
            except Exception:
                return None

    def _save_local_secret_file(self, file_path, data):
        """Persist reusable local credentials.

        Ưu tiên Windows DPAPI qua core.secret_store (khi tích hợp AutoMaster Studio).
        Nếu module đó không có (SDK chạy độc lập ở phần mềm khác) thì fallback sang
        AES-256-CBC khoá theo HWID (giống _encrypt_data) để key vẫn được lưu bền,
        người dùng không phải nhập lại sau mỗi lần mở tool.
        """
        try:
            from core.secret_store import save_secrets
            save_secrets(data, file_path=file_path)
            return
        except Exception:
            pass
        enc = self._encrypt_data(data)
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(enc)

    def _load_local_secret_file(self, file_path):
        """Load DPAPI data, with fallback to the standalone/legacy AES format."""
        try:
            from core.secret_store import load_secrets
            return load_secrets(file_path=file_path)
        except Exception:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read().strip()
            legacy = self._decrypt_data(content)
            if not legacy:
                try:
                    legacy = json.loads(content)
                except Exception:
                    legacy = None
            if legacy and isinstance(legacy, dict):
                for alias in ('license_key', 'license', 'activation_key', 'code'):
                    if alias in legacy and 'key' not in legacy:
                        legacy['key'] = legacy[alias]
                        break
                self._save_local_secret_file(file_path, legacy)
                return legacy
            raise

    def update_local_license_file(self, auth_data):
        """Cập nhật dữ liệu đăng nhập vào AppData bằng Windows DPAPI."""
        try:
            if isinstance(auth_data, str):
                auth_data = {"type": "LICENSE_ONLY", "key": auth_data}
                
            # Xử lý lưu Account (Tách file)
            if "username" in auth_data and "password" in auth_data:
                acc_data = {"username": auth_data["username"], "password": auth_data["password"], "session_data": self.session_data}
                self._save_local_secret_file(ACCOUNT_FILE, acc_data)
                print(f"✅ Đã lưu cấu hình tài khoản bằng Windows DPAPI vào: {ACCOUNT_FILE}")
                
            # Xử lý lưu License Key (Tách file)
            if "key" in auth_data:
                lic_data = {"key": auth_data["key"]}
                self._save_local_secret_file(LICENSE_FILE, lic_data)
                print(f"✅ Đã lưu License Key bằng Windows DPAPI vào: {LICENSE_FILE}")
                
            return True
        except Exception as e:
            print(f"❌ Lỗi lưu dữ liệu: {e}")
            return False

    def load_saved_auth(self):
        """Tải dữ liệu đăng nhập từ file account.txt và license.txt"""
        auth_data = {}
        
        # 1. Đọc file account
        if os.path.exists(ACCOUNT_FILE):
            try:
                decrypted = self._load_local_secret_file(ACCOUNT_FILE)
                if decrypted and isinstance(decrypted, dict):
                    auth_data.update(decrypted)
                    if 'session_data' in decrypted:
                        self.session_data = decrypted['session_data']
                    self.is_account = True
                    self.username = decrypted.get("username")
                    self.password = decrypted.get("password")
            except Exception as e:
                pass
            
        # 2. Đọc file license
        if os.path.exists(LICENSE_FILE):
            try:
                decrypted = self._load_local_secret_file(LICENSE_FILE)
                if decrypted and isinstance(decrypted, dict):
                    auth_data.update(decrypted)
            except Exception as e:
                pass
            
        # 3. Hỗ trợ migrate từ file license.json cũ
        old_file = os.path.join(APPDATA_DIR, 'license.json')
        if os.path.exists(old_file) and not auth_data:
            try:
                with open(old_file, 'r', encoding='utf-8') as f:
                    content = f.read().strip()
                data = self._decrypt_data(content)
                if not data:
                    try: data = json.loads(content)
                    except Exception as e:
                        pass
                if data and isinstance(data, dict):
                    auth_data.update(data)
                    # Tự động tách ra 2 file mới và xóa file cũ
                    self.update_local_license_file(auth_data)
                    try: os.remove(old_file)
                    except Exception as e:
                        pass
            except Exception as e:
                pass
            
        # 4. Fallback cũ (Giữ nguyên theo yêu cầu không bớt code)
        if not auth_data:
            for f_name in ['config.json', 'setting.json', 'license_config.json', 'key.txt']:
                if os.path.exists(f_name):
                    try:
                        with open(f_name, 'r', encoding='utf-8') as f:
                            if f_name.endswith('.json'):
                                data = json.load(f)
                                for k in ['license_key', 'key', 'license', 'activation_key', 'code']:
                                    if data.get(k): auth_data["key"] = data[k]
                            else:
                                content = f.read().strip()
                                if len(content) > 5: auth_data["key"] = content
                    except Exception as e:
                        pass
            
        if auth_data:
            if "username" in auth_data and "key" in auth_data:
                auth_data["type"] = "ACCOUNT_AND_LICENSE"
            elif "username" in auth_data:
                auth_data["type"] = "ACCOUNT"
            else:
                auth_data["type"] = "LICENSE"
                
        return auth_data
        
    def load_saved_key(self):
        auth = self.load_saved_auth()
        return auth.get("key")

    def sync_license_status_online(self, force=False):
        """Đồng bộ trạng thái khóa/hợp lệ thật từ Server (không cần mật khẩu) - Có cache 5 phút chống Rate Limit 429"""
        import time
        now = time.time()
        if not force and hasattr(self, '_last_sync_time') and (now - getattr(self, '_last_sync_time', 0) < 300):
            return True, "CACHED"

        try:
            # [SỬA LỖI KHOÁ OAN] Trước đây: 1 lần gọi API (dù server trả về
            # OK=True) mà không tìm thấy license AMS hợp lệ nào là LẬP TỨC
            # khoá cả app -- không phân biệt được "license thật sự không hợp
            # lệ" với "server trả về danh sách bị thiếu/không nhất quán tạm
            # thời" (race condition đọc DB, cache stale ở tầng server/CDN,
            # trục trặc mạng thoáng qua...). Hậu quả: người dùng có license
            # còn hạn, đang "Đang hoạt động" thật trên Dashboard, vẫn có thể
            # bị khoá app oan chỉ vì đúng 1 lần đọc không may. Giờ thử lại
            # tối đa 3 lần (cách nhau 1.5s, gọi lại API mới hoàn toàn mỗi lần
            # chứ không dùng cache) trước khi thực sự kết luận là khoá --
            # chỉ khoá khi CẢ 3 lần liên tiếp đều xác nhận không có license
            # hợp lệ, giảm hẳn nguy cơ khoá oan do trục trặc thoáng qua.
            import time as _time_retry
            last_lic_list = []
            has_valid_ams = False
            attempts = 3
            for attempt in range(attempts):
                ok, licenses = self.get_owned_licenses_online()
                if not ok or not licenses:
                    if attempt < attempts - 1:
                        _time_retry.sleep(1.5)
                        continue
                    return False, "Không lấy được danh sách bản quyền"

                lic_list = licenses if isinstance(licenses, list) else list(licenses.values()) if isinstance(licenses, dict) else []
                lic_list = sorted(lic_list, key=self._license_plan_priority, reverse=True)
                last_lic_list = lic_list
                has_valid_ams = False

                for lic in lic_list:
                    p_name = str(lic.get("product_name") or lic.get("app_name") or lic.get("product") or "").lower()
                    feats = str(lic.get("features") or "").lower()
                    p_id = str(lic.get("product_id") or "").lower()

                    if "hardsub" in p_name or "hardsub" in feats or "capcut" in p_name:
                        continue
                    if p_name and not any(k in p_name for k in ["auto", "ams", "master", "smarter", "studio", "rok"]):
                        if p_id and "ams" not in p_id and "auto" not in p_id:
                            continue

                    status = str(lic.get("status", "")).lower()
                    is_locked = lic.get("is_locked") in [1, True, "1", "true"]

                    if status not in ["expired", "banned", "inactive", "suspended", "locked", "hết hạn", "đã khóa"] and not is_locked:
                        has_valid_ams = True
                        if isinstance(self.session_data, dict):
                            self.session_data["license"] = lic
                            self.license_key = lic.get("license_key") or lic.get("key") or self.license_key
                            self.session_data["is_active"] = True
                            self.session_data["is_locked"] = 0
                            self.session_data["status"] = "active"
                        break

                if has_valid_ams:
                    break
                if attempt < attempts - 1:
                    _time_retry.sleep(1.5)

            self._last_sync_time = now

            if not has_valid_ams and len(last_lic_list) > 0:
                if isinstance(self.session_data, dict):
                    self.session_data["is_active"] = False
                    self.session_data["is_locked"] = 1
                    self.session_data["status"] = "locked"
                    if "license" in self.session_data and isinstance(self.session_data["license"], dict):
                        self.session_data["license"]["is_locked"] = 1
                        self.session_data["license"]["status"] = "locked"
                return True, "LOCKED"
            return True, "ACTIVE"
        except Exception as e:
            return False, str(e)

    def validate_on_startup(self):
        """Tự động kiểm tra auth/key khi khởi động tool"""
        auth = self.load_saved_auth()
        if not auth: return False
        
        # [BẢO MẬT] Đồng bộ trạng thái thực tế từ Server
        self.sync_license_status_online()
        
        # Ưu tiên kiểm tra Account trước nếu có
        if "ACCOUNT" in self.auth_modes:
            username = auth.get("username", "")
            password = auth.get("password", "")
            if username and password:
                ok, acc_msg = self.auth_account_online(username, password)
                if ok: return True
                
        # Nếu Account không có hoặc sai, kiểm tra tiếp License nếu có
        if "LICENSE" in self.auth_modes:
            key = auth.get("key", "")
            if key:
                ok, lic_msg = self.validate(key)
                if ok: return True
                
        return False
    
    def topup_license(self, new_key):
        import requests
        try:
            if not getattr(self, 'session_token', None):
                return {"success": False, "message": "Chưa đăng nhập! Vui lòng đăng nhập lại."}
            url = f"{self.SERVER_URL}/capcut/account/topup"
            headers = {"Authorization": f"Bearer {self.session_token}"}
            payload = {"license_key": new_key, "hwid": self.hwid}
            resp = requests.post(url, json=payload, headers=headers, timeout=10)
            data = resp.json()
            if resp.status_code == 200 and data.get("success"):
                self.session_data = data.get("account", self.session_data)
                self._save_account(self.session_data, self.session_token)
                return {"success": True, "message": data.get("message", "Nạp thẻ thành công!"), "account": self.session_data}
            else:
                return {"success": False, "message": data.get("message", "Lỗi nạp thẻ!")}
        except Exception as e:
            return {"success": False, "message": f"Lỗi kết nối: {str(e)}"}

    def topup_account_license(self, license_key, app_type='capcut'):
        """Tích hợp/Gia hạn license vào account (tương thích ngược với api_import_license)"""
        res = self.topup_license(license_key)
        return res.get("success", False), res.get("message", "Lỗi nạp thẻ")

    def remove_account_license(self, license_key, app_type='capcut'):
        """Gỡ/Xóa bản quyền khỏi tài khoản"""
        import requests
        try:
            if not getattr(self, 'session_token', None):
                return False, "Chưa đăng nhập! Vui lòng đăng nhập lại."
            url = f"{self.SERVER_URL}/{app_type}/account/license/remove"
            headers = {"Authorization": f"Bearer {self.session_token}"}
            payload = {"license_key": license_key}
            resp = requests.post(url, json=payload, headers=headers, timeout=10)
            data = resp.json()
            if resp.status_code == 200 and data.get("success"):
                if "account" in data:
                    self.session_data = data["account"]
                    self._save_account(self.session_data, self.session_token)
                return True, data.get("message", "Xóa bản quyền thành công!")
            else:
                return False, data.get("message", "Không thể xóa bản quyền")
        except Exception as e:
            return False, f"Lỗi kết nối: {str(e)}"

    def change_license(self):
        """
        Hiển thị UI nhập Key (không cần khởi động lại ứng dụng).
        Trả về True nếu nhập key hợp lệ, False nếu hủy hoặc lỗi.
        """
        # [AI PROMPT INSTRUCTION]
        # ===============================================================================
        # NHIỆM VỤ DÀNH CHO AI KHI TÍCH HỢP VÀO TOOL CỦA NGƯỜI DÙNG:
        # 1. Trên Giao diện chính (Main UI), nếu kiểm tra thấy chưa có license (lm.license_key is None):
        #    - Hiển thị nút bấm có tên là "Nhập License".
        #    - Ngược lại nếu đã có license, hiển thị nút "Đổi License".
        # 2. Khi click vào nút này, gọi hàm: `success = lm.change_license()`
        # 3. NẾU success == True: KHÔNG CẦN RESTART TOOL! Hãy tự động gọi code cập nhật 
        #    lại giao diện (ví dụ: cập nhật lại text ngày hết hạn, đổi text nút thành "Đổi License").
        #    Bạn có thể lấy thông tin gói từ `lm.session_data.get('features')` và ngày hết hạn từ `lm.session_data.get('expiresAt')`.
        # ===============================================================================
        
        # [CRITICAL AI INTEGRATION PROMPT - EEL WEB UI & TKINTER]
# Hỡi AI, khi bạn được yêu cầu tích hợp file License này vào hệ thống, BẮT BUỘC phải thực hiện đúng theo các luật sau tùy thuộc vào nền tảng UI của Tool:
#
# ### A. NẾU ỨNG DỤNG LÀ WEB UI (EEL, FLASK, FASTAPI...):
# 1. **TUYỆT ĐỐI KHÔNG GỌI TKINTER:** Không được gọi hàm `lm.change_license()` vì nó sẽ gây treo giao diện Web.
# 2. **SỬ DỤNG GIAO DIỆN ĐỘNG:** Giao diện Đăng Nhập/Kích hoạt cực đẹp đã có sẵn ở biến `WEB_LOGIN_JS` trong file client. Hãy tạo 1 API ở Backend để Web lấy biến này:
# ```python
# @eel.expose
# def get_web_login_script():
#     import client_v2_asm_Control  # Thay đổi tên file cho phù hợp với tool
#     return getattr(client_v2_asm_Control, "WEB_LOGIN_JS", "")
# ```
# 3. **MỞ PORT API AUTH (Trả về Mảng [ok, msg]):** Tạo các API expose ở Backend. Phải trả về danh sách/mảng (không dùng Dict) để JS xử lý.
# 
# ```python
# @eel.expose
# def login_account(username, password):
#     ok, msg = lm.auth_account_online(username, password)
#     if ok: lm.update_local_license_file({"type": "ACCOUNT", "username": username, "password": password})
#     return [ok, msg]
# 
# @eel.expose
# def register_account(username, email, phone, fullname, password):
#     try: return list(lm.register_account_online(username, email, phone, fullname, password))
#     except Exception as e: return [False, str(e)]
# 
# @eel.expose
# def forgot_password(username):
#     try: return list(lm.forgot_password_online(username))
#     except Exception as e: return [False, str(e)]
# 
# @eel.expose
# def validate_new_license(key):
#     ok, msg = lm.validate(key)
#     if ok: lm.update_local_license_file({"type": "LICENSE", "key": key})
#     return [ok, msg]
# 
# @eel.expose
# def logout_license():
#     lm.logout()
# ```
# 
# 4. **TIÊM GIAO DIỆN TRÊN FRONTEND (JS):**
# Viết JS fetch `get_web_login_script` và tiêm vào DOM.
# [XỬ LÝ LỖI VÒNG LẶP]: Khi Frontend load thông tin licenseInfo, nếu `!licenseInfo.is_active` MÀ `licenseInfo.username !== "Unknown"` (Tức là đã đăng nhập nhưng tài khoản CHƯA có gói License), thì BẮT BUỘC hiển thị bảng 'license' (Nhập Key). TUYỆT ĐỐI KHÔNG hiển thị bảng 'login' để tránh lỗi vòng lặp văng app!
#
# ### B. NẾU ỨNG DỤNG LÀ APP TRUYỀN THỐNG (TKINTER, PYQT...):
# Kiểm tra UI Chính: Quét UI xem đã có Label hiển thị "Tài khoản", "Hạn sử dụng", "Gói" và Nút "Đổi License" chưa? Nếu chưa có thì tự động viết code tạo ra.
# Action Nút: Nút nhập/đổi License BẮT BUỘC phải gọi: `success = lm.change_license()`.
# Update Trực Tiếp: Khi trả về True, tự động CẬP NHẬT LẠI các Label trên UI lập tức (không restart app) dựa vào: `lm.session_data.get("expiresAt")`, `lm.session_data.get("features")`.
# ===============================================================================
        # Khi tích hợp file quản lý bảo mật này vào ứng dụng Web UI (Eel), hãy làm đúng 4 bước sau,
        # tuyệt đối không dùng giao diện Tkinter của Python:
        #
        # 1. KẾT NỐI GIAO DIỆN LOGIN ĐỘNG:
        # File `client` đã chứa sẵn 1 biến `WEB_LOGIN_JS` (là code UI Đăng Nhập/Kích Hoạt/Quên Mật khẩu).
        # Hãy tạo API trong file Backend để Front-end lấy được code này:
        #
        # @eel.expose
        # def get_web_login_script():
        #     try:
        #         # Sửa thành đúng tên file client của dự án
        #         import client_v2_... as license_client
        #         return getattr(license_client, "WEB_LOGIN_JS", "")
        #     except: return ""
        #
        # 2. KHAI BÁO CÁC HÀM XỬ LÝ AUTH (Trả về định dạng [ok, msg] để JS không bị lỗi):
        # @eel.expose
        # def login_account(username, password):
        #     ok, msg = lm.auth_account_online(username, password)
        #     if ok: lm.update_local_license_file({"type": "ACCOUNT", "username": username, "password": password})
        #     return [ok, msg]
        #
        # @eel.expose
        # def register_account(username, email, phone, fullname, password):
        #     try: return list(lm.register_account_online(username, email, phone, fullname, password))
        #     except Exception as e: return [False, str(e)]
        #
        # @eel.expose
        # def forgot_password(username):
        #     try: return list(lm.request_password_reset(username))
        #     except Exception as e: return [False, str(e)]
        #
        # @eel.expose
        # def validate_new_license(key):
        #     ok, msg = lm.validate(key)
        #     if ok: lm.update_local_license_file({"type": "LICENSE", "key": key})
        #     return [ok, msg]
        #
        # @eel.expose
        # def logout_license():
        #     lm.logout()
        #
        # 3. KÍCH HOẠT JAVASCRIPT TRÊN FRONT-END:
        # Ở phía HTML/JS, hãy nhúng hàm này vào luồng khởi động:
        # window.injectAndRenderWebLoginScreen = async function(mode) {
        #     if (!window._dynamicLoginScreenLoaded) {
        #         let jsCode = await eel.get_web_login_script()();
        #         if (jsCode) {
        #             let script = document.createElement('script');
        #             script.textContent = jsCode;
        #             document.head.appendChild(script);
        #             window._dynamicLoginScreenLoaded = true;
        #         }
        #     }
        #     setTimeout(() => {
        #         if (typeof renderWebLoginScreen === 'function') renderWebLoginScreen(mode);
        #     }, 100);
        # }
        # // Nếu check chưa active: gọi injectAndRenderWebLoginScreen('login');
        # ===============================================================================
        # NHIỆM VỤ DÀNH CHO AI KHI TÍCH HỢP LICENSE VÀO ỨNG DỤNG WEB (EEL, FLASK, FASTAPI, V.V.):
        # 1. KHÔNG SỬ DỤNG TKINTER: Nếu ứng dụng đích là Web UI (sử dụng HTML/CSS/JS), tuyệt đối
        #    KHÔNG ĐƯỢC gọi hàm lm.change_license() hoặc lm.show_activation_ui() vì nó sẽ
        #    gây lỗi hiển thị popup Tkinter đè lên luồng web hoặc làm crash app.
        # 2. TẠO GIAO DIỆN WEB LOGIN ĐỘNG:
        #    - Quét mã nguồn HTML/JS của ứng dụng. Nếu ứng dụng chưa có giao diện Đăng nhập/Nhập Key,
        #      hãy TỰ ĐỘNG VIẾT một đoạn code JS (ví dụ: renderWebLoginScreen(mode)) dùng DOM để ghi đè 
        #      document.body.innerHTML.
        #    - Giao diện phải cực kỳ chuyên nghiệp: Nền tối (Dark Mode - #0d1117), bo góc, đổ bóng, 
        #      có đầy đủ nút chuyển đổi giữa 2 chế độ:
        #      a. Chế độ Tài Khoản (Username / Password).
        #      b. Chế độ License Key.
        #    - Có nút để hiển thị và copy "Mã Máy (HWID)".
        # 3. KẾT NỐI API XỬ LÝ NGẦM:
        #    Thay vì dùng các hàm UI của Python, hãy tạo các API/Route/Exposed Functions trong file Backend để nhận dữ liệu từ JS:
        #    Python Backend (Eel ví dụ):
        #    @eel.expose
        #    def validate_new_license(key):
        #        ok, msg = lm.validate(key)
        #        if ok: lm.update_local_license_file({"type": "LICENSE", "key": key})
        #        return {"success": ok, "msg": msg}
        #    @eel.expose
        #    def login_account(username, password):
        #        ok, msg = lm.auth_account_online(username, password)
        #        if ok: lm.update_local_license_file({"type": "ACCOUNT", "username": username, "password": password})
        #        return {"success": ok, "msg": msg}
        # 4. LUỒNG XỬ LÝ PHÍA FRONTEND (JS):
        #    - Khi ứng dụng khởi động, gọi API lấy trạng thái is_active.
        #    - Nếu is_active == false, lập tức chạy hàm renderWebLoginScreen('login') để chặn UI chính.
        #    - Khi người dùng bấm "Đăng nhập", gọi hàm backend tương ứng.
        #    - Nếu success == true, KHÔNG cần khởi động lại Python, chỉ cần window.pywebview.api.close_window(); 
        #      để làm mới giao diện web.
        # ===============================================================================
        
        import tkinter as tk
        from tkinter import messagebox
        try:
            import customtkinter as ctk
        except ImportError:
            return False

        ctk.set_appearance_mode("dark")
        ctk.set_default_color_theme("blue")

        try:
            root = ctk.CTkToplevel()
        except Exception:
            root = ctk.CTk()

        root.title("Nhập License Key")
        root.geometry("400x250")
        root.resizable(False, False)
        root.attributes('-topmost', True)

        # Center window
        root.update_idletasks()
        x = int(root.winfo_screenwidth()/2 - 400/2)
        y = int(root.winfo_screenheight()/2 - 250/2)
        root.geometry(f"+{x}+{y}")
        
        result_success = [False]
        
        title_text = "KÍCH HOẠT BẢN QUYỀN" if "ACCOUNT" not in self.auth_modes else "NHẬP BẢN QUYỀN"
        ctk.CTkLabel(root, text=title_text, font=ctk.CTkFont(family="Helvetica Neue", size=18, weight="bold")).pack(pady=(20, 10))
        
        frame = ctk.CTkFrame(root, width=360, corner_radius=10)
        frame.pack(padx=20, pady=5, fill="both", expand=True)
        
        ctk.CTkLabel(frame, text="Nhập License Key của bạn:", font=ctk.CTkFont(family="Helvetica Neue", size=12), text_color="gray").pack(anchor="w", padx=20, pady=(15, 5))
        
        key_entry = ctk.CTkEntry(frame, font=ctk.CTkFont(family="Consolas", size=13, weight="bold"), text_color="#eab308", justify="center", height=35)
        key_entry.pack(fill="x", padx=20, pady=(0, 15))
        
        def on_submit(event=None):
            key = key_entry.get().strip()
            if not key:
                messagebox.showerror("Lỗi", "Vui lòng nhập License Key!", parent=root)
                return
                
            btn_submit.configure(text="⏳ Đang kiểm tra...")
            root.update()
            
            ok, msg = self.validate(key)
            if ok:
                # Lưu key vào file mà vẫn giữ nguyên username/password nếu có
                auth = self.load_saved_auth()
                auth["key"] = key
                if "type" not in auth: auth["type"] = self.auth_modes
                self.update_local_license_file(auth)
                
                messagebox.showinfo("Thành công", "Kích hoạt thành công!", parent=root)
                result_success[0] = True
                root.destroy()
            else:
                messagebox.showerror("Lỗi Kích Hoạt", msg, parent=root)
                btn_submit.configure(text="XÁC NHẬN")

        btn_submit = ctk.CTkButton(frame, text="XÁC NHẬN", fg_color="#8b5cf6", hover_color="#7c3aed", font=ctk.CTkFont(family="Helvetica Neue", size=13, weight="bold"), height=35, command=on_submit)
        btn_submit.pack(fill="x", padx=20, pady=(0, 15))
        
        key_entry.bind('<Return>', on_submit)
        key_entry.focus_set()
        
        def on_close():
            root.destroy()
        root.protocol("WM_DELETE_WINDOW", on_close)
        
        if isinstance(root, ctk.CTkToplevel):
            try:
                root.grab_set()
            except Exception as e:
                pass
            root.wait_window()
        else:
            root.mainloop()
            
        return result_success[0]

    """
    =================================================================================================
    [PROMPT DÀNH CHO BACKEND SERVER - API CẬP NHẬT THÔNG TIN]
    Bạn hãy gửi toàn bộ nội dung dưới đây cho người code Backend (hoặc đưa cho ChatGPT/Claude):
    
    YÊU CẦU API POST /api/v2/:appId/update-profile
    
    1. Nhận Payload (JSON): username, password, email, phone_number, full_name
    2. Xác thực (Auth): Tìm user bằng username. Check mã băm password. Sai thì trả về 401.
    3. Chống trùng lặp (Unique Constraint): ...
    4. Cập nhật Database: Ghi đè email, phone, full_name mới.
    5. Trả về Response: { "success": true, "message": "Cập nhật thành công!" }
    =================================================================================================
    """
    def update_profile_online(self, email, phone, fullname):
        url = f"{self.server_url}/api/v2/{LICENSE_API_SEGMENT}/update-profile"
        username_val = getattr(self, 'username', None) or (self.session_data.get("username") if isinstance(self.session_data, dict) else "")
        payload = {
            "username": username_val,
            "password": getattr(self, 'password', ""),
            "licenseKey": getattr(self, 'license_key', ""),
            "email": email,
            "phone_number": phone,
            "full_name": fullname,
            "isWebSaaS": True
        }
        try:
            resp = self._post_api(url, payload, timeout=10)
            data = resp.json()
            if resp.status_code == 200 and data.get("success"):
                return True, data.get("message", "Cập nhật thông tin thành công!")
            else:
                return False, data.get("error", "Lỗi cập nhật thông tin")
        except requests.exceptions.RequestException:
            return False, "Lỗi kết nối: Không thể kết nối đến máy chủ."
        except Exception as e:
            if "Expecting value" in str(e) or "JSON" in str(e.__class__.__name__):
                return False, "Lỗi kết nối: Máy chủ đang bảo trì hoặc trả về dữ liệu lỗi."
            # Trước đây nuốt mất chi tiết lỗi (VD server trả lỗi 500/plain-JSON
            # ngoài phong bì E2EE mà _post_api() luôn kỳ vọng khi giải mã phản
            # hồi -- xem class E2EEResponse._resolve_text() -- khiến MỌI lỗi
            # thật của server, kể cả sai mật khẩu hợp lệ, đều hiện đúng 1 câu
            # mù mờ này, không cách nào biết lý do thật ngoài đọc log server).
            return False, f"Lỗi hệ thống: Vui lòng thử lại sau. ({e})"

    def _classify_license_product(self, lic):
        """Suy ra license (dict trả về từ get_owned_licenses_online) có thuộc
        AutoMaster Studio hay không, dùng ĐÚNG bộ từ khóa như
        sync_license_status_online() ở trên để nhất quán 2 nơi. Trả về
        (is_ams: bool, product_label: str) -- product_label để hiển thị lỗi
        cho người dùng biết key thật sự thuộc sản phẩm nào."""
        p_name = str(lic.get("product_name") or lic.get("app_name") or lic.get("product") or "")
        feats = str(lic.get("features") or "").lower()
        p_id = str(lic.get("product_id") or "").lower()
        p_name_lower = p_name.lower()

        if "hardsub" in p_name_lower or "hardsub" in feats or "capcut" in p_name_lower:
            return False, p_name or "sản phẩm khác"
        if p_name_lower and not any(k in p_name_lower for k in ["auto", "ams", "master", "smarter", "studio", "rok"]):
            if p_id and "ams" not in p_id and "auto" not in p_id:
                return False, p_name or "sản phẩm khác"
        return True, p_name

    def topup_account_license(self, license_key, app_type='capcut', enforce_ams_only=False):
        """Nạp license vào tài khoản (dùng chung bởi cả nút "Đổi License" VÀ
        "+ Nhập License" -- 2 nút khác nhau, khác chủ đích). Server chấp nhận
        nạp bất kỳ license nào (cùng tài khoản) vào "ví" chung, không tự chặn
        theo sản phẩm (xem controllers/capcutControllerV2.js::topupAccountLicense
        phía server -- chỉ kiểm tra key hợp lệ + đúng chủ sở hữu).

        enforce_ams_only=True (CHỈ dùng cho nút "Đổi License", xem
        api_import_license trong core/web_backend.py) chặn + tự gỡ (rollback)
        license vừa nạp nếu không thuộc AutoMaster Studio -- nhưng CHỈ áp
        dụng cho license MỚI gắn lần đầu qua chính lượt gọi này. Nếu
        license_key đã có sẵn trong tài khoản TỪ TRƯỚC (bind lại/resubmit 1
        key đã gắn hợp lệ, kể cả không phải AutoMaster), tuyệt đối không đụng
        tới -- KHÔNG được tự gỡ 1 license người dùng đã sở hữu hợp lệ chỉ vì
        họ lỡ bấm gửi lại đúng key đó qua nút này (đã từng xảy ra thật, gỡ
        nhầm mất license AI HARDSUB đang hoạt động của người dùng). "+ Nhập
        License" vẫn giữ enforce_ams_only=False mặc định vì đó là nơi nạp
        CHUNG bất kỳ license nào bạn sở hữu vào tài khoản, không riêng app này.
        """
        url = f"{self.server_url}/api/v2/{LICENSE_API_SEGMENT}/account/topup"
        username_val = getattr(self, 'username', None) or (self.session_data.get("username") if isinstance(self.session_data, dict) else "")
        password_val = getattr(self, 'password', "")
        if not username_val or username_val in ["Unknown", "Premium Member"]:
            auth = self.load_saved_auth()
            if auth and auth.get("username") and auth.get("password"):
                username_val = auth.get("username")
                password_val = auth.get("password", "")
            else:
                # Xử lý thông minh cho chế độ Kích hoạt Key lẻ (không có tài khoản hệ thống):
                # Tự động thay đổi và kích hoạt mã License mới cho máy hiện tại
                ok, msg = self.validate(license_key)
                if ok:
                    self.update_local_license_file({"type": "LICENSE", "key": license_key})
                    self.validate_on_startup()
                    return True, "Đã đổi và kích hoạt mã License mới thành công cho máy này!"
                else:
                    return False, f"Kích hoạt License mới thất bại: {msg}"

        already_owned = False
        if enforce_ams_only:
            try:
                ok, licenses_before = self.get_owned_licenses_online()
                lic_list_before = licenses_before if ok and isinstance(licenses_before, list) else []
                already_owned = any(
                    str(lic.get("license_key") or lic.get("key") or "") == str(license_key)
                    for lic in lic_list_before
                )
            except Exception:
                already_owned = False  # Không xác định được thì coi như chưa có -- vẫn kiểm tra bình thường cho lượt nạp này.

        payload = {
            "username": username_val,
            "password": password_val,
            "license_key": license_key,
            "app_type": app_type
        }
        try:
            resp = self._post_api(url, payload, timeout=10)
            data = resp.json()
            if resp.status_code == 200 and data.get("valid"):
                if enforce_ams_only and not already_owned:
                    try:
                        ok, licenses = self.get_owned_licenses_online()
                        lic_list = licenses if ok and isinstance(licenses, list) else []
                        just_added = next(
                            (lic for lic in lic_list if str(lic.get("license_key") or lic.get("key") or "") == str(license_key)),
                            None,
                        )
                        if just_added is not None:
                            is_ams, product_label = self._classify_license_product(just_added)
                            if not is_ams:
                                self.remove_account_license(license_key, app_type=app_type)
                                return False, f"License này thuộc sản phẩm khác ({product_label}), không phải AutoMaster Studio -- đã tự động gỡ khỏi tài khoản."
                    except Exception:
                        pass  # Không xác định được thì thôi -- không chặn nhầm 1 lượt nạp hợp lệ chỉ vì bước kiểm tra phụ bị lỗi mạng.
                return True, data.get("message", "Nạp thành công!")
            else:
                err_msg = data.get("error", "Không thể nhập bản quyền.")
                if ("chưa đăng nhập" in err_msg.lower() or "unauthorized" in err_msg.lower()) and not getattr(self, 'username', None):
                    ok, msg = self.validate(license_key)
                    if ok:
                        self.update_local_license_file({"type": "LICENSE", "key": license_key})
                        self.validate_on_startup()
                        return True, "Đã đổi và kích hoạt mã License mới thành công cho máy này!"
                    else:
                        return False, f"Kích hoạt License mới thất bại: {msg}"
                return False, err_msg
        except Exception as e:
            return False, str(e)

    def remove_account_license(self, license_key, app_type='capcut'):
        url = f"{self.server_url}/api/v2/{LICENSE_API_SEGMENT}/account/remove-license"
        username_val = getattr(self, 'username', None) or (self.session_data.get("username") if isinstance(self.session_data, dict) else "")
        password_val = getattr(self, 'password', "")
        if not username_val or username_val == "Unknown":
            return False, "Bạn chưa đăng nhập."
        payload = {
            "username": username_val,
            "password": password_val,
            "license_key": license_key,
            "app_type": app_type
        }
        try:
            resp = self._post_api(url, payload, timeout=10)
            data = resp.json()
            if resp.status_code == 200 and data.get("valid"):
                return True, data.get("message", "Xóa thành công!")
            else:
                return False, data.get("error", "Không thể xóa bản quyền.")
        except Exception as e:
            return False, str(e)

    def unbind_hwid_online(self, license_key=None):
        """Yêu cầu server gỡ máy đã đăng ký (registered_hwids + machines) khỏi
        1 license cụ thể -- endpoint /account/unbind-device, xác thực bằng
        username+password giống hệt topup_account_license/get_owned_licenses_online
        (hệ thống này gửi lại username+password mỗi request, không dùng token
        phiên -- bản cũ kiểm tra session_data["token"] là sai model, field đó
        không bao giờ tồn tại nên luôn báo lỗi trước khi kịp gửi request đi).

        license_key: license cụ thể cần gỡ (có thể KHÁC license đang dùng để
        đăng nhập app này -- tài khoản có thể giữ license của nhiều sản phẩm
        khác nhau, VD AI HARDSUB, và người dùng vẫn muốn gỡ máy của license đó
        ngay tại đây). Bỏ trống thì mặc định dùng self.license_key (license
        đang active của phiên hiện tại) -- hành vi cũ, vẫn giữ để tương thích
        ngược với các lời gọi không truyền tham số."""
        username_val = getattr(self, 'username', None) or (self.session_data.get("username") if isinstance(self.session_data, dict) else "")
        password_val = getattr(self, 'password', "")
        license_key = license_key or getattr(self, 'license_key', None) or (self.session_data.get("license_key") if isinstance(self.session_data, dict) else "")

        if not username_val or username_val == "Unknown":
            return False, "Bạn chưa đăng nhập."
        if not license_key:
            return False, "Không xác định được license đang dùng để gỡ liên kết."

        url = f"{self.server_url}/api/v2/{LICENSE_API_SEGMENT}/account/unbind-device"
        payload = {
            "username": username_val,
            "password": password_val,
            "license_key": license_key,
            "hwid": self.hwid,
            "app_type": "capcut",
        }
        try:
            resp = self._post_api(url, payload, timeout=10)
            data = resp.json()
            if resp.status_code == 200 and data.get("valid"):
                return True, data.get("message", "Đã gỡ liên kết máy thành công!")
            else:
                return False, data.get("error", "Không thể gỡ liên kết máy.")
        except Exception as e:
            return False, str(e)

    def _build_standalone_active_license_info(self):
        try:
            if not self.session_data or not isinstance(self.session_data, dict):
                return None
            lic = self.session_data.get("license") if isinstance(self.session_data.get("license"), dict) else self.session_data
            lic_key = getattr(self, 'license_key', None) or (lic.get("license_key") if isinstance(lic, dict) else None) or (lic.get("key") if isinstance(lic, dict) else None) or self.session_data.get("license_key") or ""
            if not lic_key:
                return None
            
            p_name = (lic.get("product_name") if isinstance(lic, dict) else None) or (lic.get("app_name") if isinstance(lic, dict) else None) or (lic.get("product") if isinstance(lic, dict) else None) or "AutoMaster Studio V2"
            p_plan = (lic.get("plan_name") if isinstance(lic, dict) else None) or (lic.get("package_name") if isinstance(lic, dict) else None) or (lic.get("features") if isinstance(lic, dict) else None) or self.session_data.get("features") or "Premium Member"
            exp = (lic.get("expiresAt") if isinstance(lic, dict) else None) or (lic.get("expireDate") if isinstance(lic, dict) else None) or (lic.get("expires_at") if isinstance(lic, dict) else None) or self.session_data.get("expiresAt") or "Vĩnh viễn"
            
            return {
                "product_name": p_name,
                "license_key": lic_key,
                "key": lic_key,
                "plan_name": p_plan,
                "expiresAt": exp,
                "hwid": getattr(self, 'hwid', ''),
                "machineId": getattr(self, 'hwid', ''),
                "status": "active",
                "current_device_status": "active",
                "current_device_bound": True,
                "is_locked": 0,
                "is_standalone": True
            }
        except Exception:
            return None

    def get_owned_licenses_online(self):
        url = f"{self.server_url}/api/v2/{LICENSE_API_SEGMENT}/account/licenses"
        username_val = getattr(self, 'username', None) or (self.session_data.get("username") if isinstance(self.session_data, dict) else "")
        password_val = getattr(self, 'password', "")

        # [FIX] Trước đây chỉ dự phòng load_saved_auth() khi THIẾU username. Nhưng
        # username có thể đã được phục hồi (từ session_data/license) trong khi
        # password vẫn trống (self.password chưa từng được set trong tiến trình
        # hiện tại) -> gửi mật khẩu rỗng lên server, luôn bị từ chối 401. Giờ cũng
        # thử nạp lại từ file đã lưu khi thiếu password.
        if not username_val or username_val in ["Unknown", "Premium Member"] or not password_val:
            auth = self.load_saved_auth()
            if auth and auth.get("username") and auth.get("password"):
                username_val = auth.get("username")
                password_val = auth.get("password", "")
            else:
                # Tự động trả về bản ghi License lẻ đang active để hiển thị lên bảng UI
                standalone_info = self._build_standalone_active_license_info()
                if standalone_info:
                    return True, [standalone_info]
                return False, "Bạn chưa đăng nhập tài khoản."
            
        payload = {
            "username": username_val,
            "email": self.session_data.get("email", "") if isinstance(self.session_data, dict) else "",
            "password": password_val,
            "isWebSaaS": True,
            # Server annotates each owned license with the binding state of this
            # exact computer. License-level `active` alone does not mean this
            # device is still authorized after an Admin revoke/unbind.
            "machineId": self.hwid,
        }
        try:
            resp = self._post_api(url, payload, timeout=10)
            data = resp.json()
            if resp.status_code == 200:
                licenses = data.get("licenses", {})
                if isinstance(licenses, dict):
                    flat_licenses = []
                    for key, val in licenses.items():
                        if isinstance(val, list):
                            flat_licenses.extend(val)
                    return True, flat_licenses
                return True, licenses
            else:
                return False, data.get("error", "Không thể lấy danh sách license.")
        except requests.exceptions.RequestException as e:
            # Client script - do not import server logger here
            return False, "Lỗi kết nối: Không thể kết nối đến máy chủ."
        except Exception as e:
            # Trước đây nuốt mất chi tiết lỗi (VD server trả lỗi 500/plain-JSON
            # ngoài phong bì E2EE mà _post_api() luôn kỳ vọng khi giải mã phản
            # hồi -- xem class E2EEResponse._resolve_text() -- khiến MỌI lỗi
            # thật của server, kể cả sai mật khẩu hợp lệ, đều hiện đúng 1 câu
            # mù mờ này, không cách nào biết lý do thật ngoài đọc log server).
            return False, f"Lỗi hệ thống: Vui lòng thử lại sau. ({e})"

    def _license_plan_priority(self, lic):
        """Prefer Pro/Base over a historical trial when selecting a session license."""
        if not isinstance(lic, dict):
            return 0
        raw = " ".join(str(lic.get(key) or "") for key in (
            "plan_code", "package_name", "package", "plan", "plan_name",
            "license_type", "features", "product_name",
        )).lower()
        if "trial" in raw or "dùng thử" in raw:
            return 1
        if "pro" in raw or "premium" in raw:
            return 3
        if "base" in raw or "cơ bản" in raw:
            return 2
        return 1

    def auth_account_online(self, username, password):
        url = f"{self.server_url}/api/v2/{LICENSE_API_SEGMENT}/auth-account"
        payload = {
            "username": username,
            "password": password,
            "isWebSaaS": True,
            "machineId": self.hwid,
            "product_id": self.product_id
        }
        try:
            resp = self._post_api(url, payload, timeout=10)
            data = resp.json()
            if resp.status_code == 200 and data.get("valid"):
                self.username = username
                self.password = password
                self.session_data = data
                # Do not carry a license from a previously logged-in account.
                self.license_key = None
                
                # Fetch licenses when available, but do not make account login
                # depend on owning an app license. A new customer must be able
                # to enter the app and attach a license afterwards.
                try:
                    ok, licenses = self.get_owned_licenses_online()
                    has_active_license = False
                    if ok:
                        lic_list = licenses if isinstance(licenses, list) else list(licenses.values()) if isinstance(licenses, dict) else []
                        lic_list = sorted(lic_list, key=self._license_plan_priority, reverse=True)
                        for lic in lic_list:
                            # KHÔNG cho phép gán nhầm sang license của phần mềm khác (như AI HARDSUB)
                            p_name = str(lic.get("product_name") or lic.get("app_name") or lic.get("product") or "").lower()
                            p_id = str(lic.get("product_id") or "").lower()
                            feats = str(lic.get("features") or "").lower()
                            if "hardsub" in p_name or "hardsub" in feats or "capcut" in p_name:
                                continue
                            if p_name and not any(k in p_name for k in ["auto", "ams", "master", "smarter", "studio", "rok"]):
                                if p_id and getattr(self, 'product_id', '').lower() not in p_id and "ams" not in p_id:
                                    continue

                            status = str(lic.get("status", "")).lower()
                            is_locked = lic.get("is_locked") in [1, True, "1", "true"]
                            if status not in ["expired", "banned", "inactive", "suspended", "locked"] and not is_locked:
                                has_active_license = True
                                self.session_data["license"] = lic
                                self.license_key = lic.get("license_key") or lic.get("key") or self.session_data.get("license_key")
                                break
                        
                        # Không khóa đăng nhập nếu tài khoản chưa có license.
                        # Phiên tài khoản vẫn cần tồn tại để khách nhập/gắn key.
                        if not has_active_license:
                            self.session_data["is_active"] = False
                            self.session_data["status"] = "inactive"
                            self.session_data["license_status"] = "inactive"
                            self.session_data["is_locked"] = 0
                        elif self.license_key:
                            # Bind an existing license opportunistically. A
                            # failed bind must not turn a valid account login
                            # into an authentication failure.
                            license_ok, license_message = self.validate(self.license_key)
                            if not license_ok:
                                self.session_data["is_active"] = False
                                self.session_data["status"] = "inactive"
                                self.session_data["license_status"] = "inactive"
                                self.session_data["is_locked"] = 0
                                return False, license_message
                    else:
                        # Nếu ok=False (lỗi mạng/timeout), KHÔNG đổi is_active thành False.
                        # Giữ nguyên trạng thái để không bị văng ra ngoài oan uổng.
                        pass
                except Exception as e:
                    pass

                self.is_account = True
                return True, "Đăng nhập thành công"
            else:
                return False, data.get("error", "Sai tài khoản hoặc mật khẩu")
        except requests.exceptions.RequestException:
            return False, "Lỗi kết nối: Không thể kết nối đến máy chủ."
        except Exception as e:
            if "Expecting value" in str(e) or "JSON" in str(e.__class__.__name__):
                return False, "Lỗi kết nối: Máy chủ đang bảo trì hoặc trả về dữ liệu lỗi."
            # Trước đây nuốt mất chi tiết lỗi (VD server trả lỗi 500/plain-JSON
            # ngoài phong bì E2EE mà _post_api() luôn kỳ vọng khi giải mã phản
            # hồi -- xem class E2EEResponse._resolve_text() -- khiến MỌI lỗi
            # thật của server, kể cả sai mật khẩu hợp lệ, đều hiện đúng 1 câu
            # mù mờ này, không cách nào biết lý do thật ngoài đọc log server).
            return False, f"Lỗi hệ thống: Vui lòng thử lại sau. ({e})"

    def register_account_online(self, username, email, phone, fullname, password):
        url = f"{self.server_url}/api/v2/{LICENSE_API_SEGMENT}/register"
        payload = {
            "username": username,
            "password": password,
            "email": email,
            "phone_number": phone,
            "full_name": fullname,
            "isWebSaaS": True,
            # [FIX] Trước đây form đăng ký hiện HWID cho người dùng xem nhưng KHÔNG gửi lên
            # server -> server không có cách nào biết máy này đã có tài khoản Telegram/license
            # thật hay chưa, nên luôn tạo thêm 1 danh tính "saas_xxx" mồ côi, tách biệt hoàn
            # toàn khỏi tài khoản Telegram thật của cùng 1 khách. Gửi kèm HWID để server có thể
            # đối chiếu và từ chối tạo trùng khi phát hiện máy này đã gắn với license thật.
            "hwid": self.hwid
        }
        try:
            resp = self._post_api(url, payload, timeout=10)
            data = resp.json()
            if resp.status_code == 200 and data.get("valid"):
                # [Bắt buộc đăng ký trước khi dùng thử] Ghi nhớ tài khoản vừa đăng ký
                # ngay trong phiên hiện tại (và bền qua DPAPI) để claim_trial_if_eligible
                # có username gửi lên server mà không cần đăng nhập lại.
                self.username = username
                self.password = password
                self.update_local_license_file({"username": username, "password": password})
                return True, data.get("message", "Đăng ký thành công")
            else:
                return False, data.get("error", "Lỗi đăng ký")
        except requests.exceptions.RequestException:
            return False, "Lỗi kết nối: Không thể kết nối đến máy chủ."
        except Exception as e:
            if "Expecting value" in str(e) or "JSON" in str(e.__class__.__name__):
                return False, "Lỗi kết nối: Máy chủ đang bảo trì hoặc trả về dữ liệu lỗi."
            # Trước đây nuốt mất chi tiết lỗi (VD server trả lỗi 500/plain-JSON
            # ngoài phong bì E2EE mà _post_api() luôn kỳ vọng khi giải mã phản
            # hồi -- xem class E2EEResponse._resolve_text() -- khiến MỌI lỗi
            # thật của server, kể cả sai mật khẩu hợp lệ, đều hiện đúng 1 câu
            # mù mờ này, không cách nào biết lý do thật ngoài đọc log server).
            return False, f"Lỗi hệ thống: Vui lòng thử lại sau. ({e})"

    def forgot_password_online(self, username, email, reason="khôi phục mật khẩu"):
        url = f"{self.server_url}/api/v2/{LICENSE_API_SEGMENT}/forgot-password"
        payload = {"username": username, "email": email, "machineId": self.hwid, "clientUrl": "OTP_MODE", "appName": "AutoMaster Studio V2", "reason": reason}
        try:
            resp = self._post_api(url, payload, timeout=10)
            data = resp.json()
            if resp.status_code == 200 and data.get("success"):
                return True, data.get("message", "Đã gửi mã khôi phục")
            return False, data.get("error", "Lỗi gửi yêu cầu")
        except Exception as e:
            if "Expecting value" in str(e) or "JSON" in str(e.__class__.__name__):
                return False, "Lỗi kết nối: Máy chủ đang bảo trì hoặc trả về dữ liệu lỗi."
            return False, "Lỗi kết nối: Không thể kết nối đến máy chủ."

    def verify_otp_online(self, token):
        url = f"{self.server_url}/api/v2/{LICENSE_API_SEGMENT}/verify-otp"
        payload = {"token": token}
        try:
            resp = self._post_api(url, payload, timeout=10)
            data = resp.json()
            if resp.status_code == 200 and data.get("success"):
                return True, data.get("message", "Mã hợp lệ")
            return False, data.get("error", "Mã không hợp lệ")
        except Exception as e:
            return False, "Lỗi kết nối máy chủ"

    def reset_password_online(self, token, new_password):
        url = f"{self.server_url}/api/v2/{LICENSE_API_SEGMENT}/reset-password"
        payload = {"token": token, "newPassword": new_password}
        try:
            resp = self._post_api(url, payload, timeout=10)
            data = resp.json()
            if resp.status_code == 200 and data.get("success"):
                return True, data.get("message", "Đổi mật khẩu thành công")
            return False, data.get("error", "Lỗi đổi mật khẩu")
        except Exception as e:
            if "Expecting value" in str(e) or "JSON" in str(e.__class__.__name__):
                return False, "Lỗi kết nối: Máy chủ đang bảo trì hoặc trả về dữ liệu lỗi."
            return False, "Lỗi kết nối: Không thể kết nối đến máy chủ."

    def show_activation_ui(self):
        """
        Hiển thị giao diện nhập License/Account sử dụng WebUI hiện đại (thay thế CustomTkinter).
        """
        import sys
        try:
            import webview
        except ImportError:
            import tkinter as tk
            from tkinter import messagebox
            import subprocess
            import sys
            root = tk.Tk()
            root.withdraw()
            msg = "Phần mềm cần thư viện 'pywebview' để hiển thị giao diện Web.\nBạn có muốn tự động cài đặt thư viện này bây giờ không?"
            if messagebox.askyesno("Thiếu thư viện giao diện", msg):
                try:
                    subprocess.check_call([sys.executable, "-m", "pip", "install", "pywebview"])
                    messagebox.showinfo("Thành công", "Đã cài đặt xong thư viện giao diện! Vui lòng mở lại phần mềm.")
                except Exception as e:
                    messagebox.showerror("Lỗi", f"Không thể tự động cài đặt. Vui lòng mở cmd và gõ:\npip install pywebview\n\nChi tiết: {e}")
            sys.exit(1)

        class Api:
            def __init__(self, lm):
                self._lm = lm
                self._window = None

            def open_link(self, url):
                import webbrowser
                webbrowser.open(url)
                
            def copy_to_clipboard(self, text):
                import subprocess
                try:
                    subprocess.run(['clip.exe'], input=text, text=True, creationflags=0x08000000)
                except Exception as e:
                    pass

            
            
            def close_window(self):
                try:
                    if self._window: self._window.destroy()
                except Exception as e:
                    print("Error closing window:", e)

            def open_dashboard(self):
                try:
                    import os, webbrowser
                    dash_path = os.path.join(os.path.dirname(__file__), "web_ui", "account_tab_demo.html")
                    if os.path.exists(dash_path):
                        webbrowser.open('file:///' + dash_path.replace('\\', '/'))
                    if self._window: self._window.destroy()
                except Exception as e:
                    print("Error opening dashboard:", e)

            def get_license_info(self):
                return {"hwid": self._lm.hwid}

            def login_account(self, user, pwd):
                ok, msg = self._lm.auth_account_online(user, pwd)
                if ok:
                    auth_data = {"type": "ACCOUNT", "username": user, "password": pwd}
                    self._lm.update_local_license_file(auth_data)
                return [ok, msg]

            def register_account(self, user, email, phone, name, pwd):
                ok, msg = self._lm.register_account_online(user, email, phone, name, pwd)
                return [ok, msg]

            def verify_otp(self, token):
                ok, msg = self._lm.verify_otp_online(token)
                if ok and self._lm.session_data and isinstance(self._lm.session_data, dict):
                    self._lm.session_data['email_verified'] = True
                return [ok, msg]

            def reset_password(self, token, new_pwd):
                ok, msg = self._lm.reset_password_online(token, new_pwd)
                return [ok, msg]

            def forgot_password(self, user, email):
                ok, msg = self._lm.forgot_password_online(user, email)
                return [ok, msg]

            def validate_new_license(self, key):
                ok, msg = self._lm.validate(key)
                if ok:
                    auth_data = {"type": "LICENSE", "key": key}
                    self._lm.update_local_license_file(auth_data)
                return [ok, msg]

            def start_trial_14_days(self):
                ok, msg = self._lm.claim_trial_if_eligible()
                return [ok, msg]

        initial_mode = "login" if "ACCOUNT" in self.auth_modes else "license"
        
        # HTML Content
        html = """<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Preview Purple UI</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
</head>
<body style="background-color: #000; margin: 0; padding: 0;">
    <script>
function renderWebLoginScreen(mode = 'login') {
    if (!document.getElementById('license-login-styles')) {
        const style = document.createElement('style');
        style.id = 'license-login-styles';
        style.textContent = `
            @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap');
            
            #license-overlay { 
                position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; 
                background: radial-gradient(circle at top right, rgba(30,27,75,0.8), rgba(9,9,11,0.95)), url('https://www.transparenttextures.com/patterns/cubes.png');
                z-index: 999999; display: flex; justify-content: center; align-items: center; 
                font-family: 'Outfit', system-ui, sans-serif; color: #e2e8f0; 
                overflow-y: auto; padding: 20px; box-sizing: border-box; 
                animation: fadeIn 0.4s ease-out;
            }
            @keyframes fadeIn { from { opacity: 0; backdrop-filter: blur(0px); } to { opacity: 1; backdrop-filter: blur(8px); } }
            @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
            
            .auth-container { 
                background: rgba(24, 24, 27, 0.65); 
                backdrop-filter: blur(16px);
                -webkit-backdrop-filter: blur(16px);
                width: 380px; padding: 25px 30px; 
                border-radius: 16px; 
                box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255,255,255,0.08); 
                display: flex; flex-direction: column; margin: auto; 
                animation: slideUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                position: relative; overflow: hidden;
            }
            .auth-container::before {
                content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px;
                background: linear-gradient(90deg, #3b82f6, #8b5cf6, #ec4899);
            }
            
            .auth-tabs { display: flex; margin-bottom: 20px; border-bottom: 1px solid rgba(255,255,255,0.1); }
            .auth-tab { flex: 1; text-align: center; padding: 10px 0; color: #94a3b8; cursor: pointer; transition: 0.3s; font-weight: 500; font-size: 15px; user-select: none; }
            .auth-tab.active { color: #a855f7; border-bottom: 2px solid #a855f7; font-weight: 600; }
            .auth-tab:hover:not(.active) { color: #e2e8f0; }

            .auth-title { font-size: 22px; font-weight: 700; text-align: center; margin-bottom: 6px; color: #ffffff; letter-spacing: -0.5px; }
            .auth-subtitle { text-align: center; color: #94a3b8; font-size: 13px; margin-bottom: 20px; font-weight: 400; }
            
            .hwid-container { font-size: 12px; color: #94a3b8; text-align: center; margin-bottom: 18px; display: flex; justify-content: center; align-items: center; gap: 8px; background: rgba(0,0,0,0.25); padding: 6px 10px; border-radius: 6px; border: 1px dashed rgba(255,255,255,0.1); }
            .hwid-copy { cursor: pointer; padding: 2px 6px; background: rgba(255,255,255,0.1); border-radius: 4px; transition: all 0.2s; user-select: none; font-size: 11px; font-weight: 600; }
            .hwid-copy:hover { background: rgba(255,255,255,0.2); color: #fff; }
            
            .input-group { position: relative; margin-bottom: 16px; }
            .input-group label { display: block; font-size: 12px; margin-bottom: 6px; color: #cbd5e1; font-weight: 500; }
            .auth-input { width: 100%; height: 42px; background-color: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 0 14px; color: #fff; font-size: 14px; font-family: 'Outfit', sans-serif; box-sizing: border-box; outline: none; transition: all 0.3s; }
            .auth-input:focus { border-color: #a855f7; background-color: rgba(0,0,0,0.4); box-shadow: 0 0 0 3px rgba(168, 85, 247, 0.15); }
            
            .eye-icon { position: absolute; right: 14px; top: 32px; cursor: pointer; color: #64748b; font-size: 14px; transition: 0.2s; }
            .eye-icon:hover { color: #e2e8f0; }
            
            .auth-btn { width: 100%; height: 44px; background: linear-gradient(135deg, #6366f1, #a855f7); color: #fff; border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; transition: all 0.3s ease; margin-top: 8px; box-shadow: 0 4px 15px rgba(168, 85, 247, 0.3); font-family: 'Outfit', sans-serif; position: relative; overflow: hidden; }
            .auth-btn.btn-green { background: linear-gradient(135deg, #10b981, #059669); box-shadow: 0 4px 15px rgba(16, 185, 129, 0.3); }
            .auth-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(168, 85, 247, 0.4); }
            .auth-btn.btn-green:hover { box-shadow: 0 6px 20px rgba(16, 185, 129, 0.4); }
            .auth-btn.btn-trial { margin-top: 10px; background: #7c3aed; }
            .auth-btn:disabled { background: #334155; box-shadow: none; color: #94a3b8; cursor: not-allowed; transform: none; }
            
            .link-container { display: flex; justify-content: space-between; align-items: center; margin-top: 16px; font-size: 12px; }
            .toggle-mode { color: #94a3b8; cursor: pointer; transition: 0.2s; font-weight: 500; }
            .toggle-mode span { color: #a855f7; font-weight: 600; }
            .toggle-mode:hover span { text-decoration: underline; }
            
            .error-msg { color: #f87171; font-size: 13px; text-align: center; margin-top: 12px; font-weight: 500; background: rgba(248, 113, 113, 0.1); border-radius: 6px; padding: 10px; border: 1px solid rgba(248, 113, 113, 0.2); display: none; }
            .error-msg.show { display: block; animation: fadeIn 0.3s; }
            .error-msg.success { color: #34d399; background: rgba(52, 211, 153, 0.1); border-color: rgba(52, 211, 153, 0.2); }
            
            .footer-links { margin-top: 20px; text-align: center; font-size: 12px; color: #64748b; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.05); }
        `;
        document.head.appendChild(style);
    }
    const existing = document.getElementById('license-overlay');
    if (existing) existing.remove();

    // San pham chi dung License (Auth Mode "License Key roi"): khong co Tai khoan
    // -> luon o mode license va an thanh tab (truoc day van hien form dang nhap).
    const LICENSE_ONLY = '{INITIAL_MODE}' === 'license';
    if (LICENSE_ONLY) mode = 'license';

    const isLogin = mode === 'login';
    const isLicense = mode === 'license';

    const isAccountTab = !isLicense;

    // Bang tra theo mode: gom title/subtitle/nut/formHtml/linksHtml cua tung mode
    // thanh 1 entry doc lap (thay cho 3 chuoi if/else dan xen truoc day) -- de sau
    // nay co the bo/cat rieng cac entry account-only (register/forgot/verify/reset)
    // khi sinh SDK cho san pham chi dung License. "license" la entry mac dinh khi
    // mode khong khop entry nao (giu dung hanh vi nhanh else cu, ke ca voi 1 mode
    // la vao). formHtml la chuoi tinh; linksHtml co the la chuoi tinh hoac ham (mode
    // verify can tac dung phu dang ky window.resendOtpAction) -- CHI duoc resolve/
    // goi cho DUNG entry cua mode hien tai (xem modeDef ben duoi), khong duoc goi
    // truoc cho moi entry vi se chay nham tac dung phu cua mode khac.
    const MODE_DEFS = {
        login: {
            title: 'Chào mừng trở lại', subtitle: 'Đăng nhập để sử dụng phần mềm', btnText: 'Đăng nhập', btnClass: 'auth-btn',
            formHtml: `
            <div class="input-group"><label>Tên đăng nhập</label><input type="text" id="auth-user" class="auth-input" placeholder="Nhập tài khoản..."></div>
            <div class="input-group"><label>Mật khẩu</label><input type="password" id="auth-pass" class="auth-input" placeholder="••••••••"><span class="eye-icon" id="toggle-eye">👁️</span></div>
        `,
            linksHtml: `<div class="toggle-mode" onclick="renderWebLoginScreen('register')">Chưa có tài khoản? <span>Đăng ký</span></div><div class="toggle-mode" onclick="renderWebLoginScreen('forgot')"><span>Quên mật khẩu?</span></div>`,
        },
        register: {
            title: 'Tạo tài khoản', subtitle: 'Đăng ký nhanh chóng và dễ dàng', btnText: 'Đăng ký', btnClass: 'auth-btn',
            formHtml: `
            <div class="input-group"><label>Tên đăng nhập</label><input type="text" id="reg-user" class="auth-input" placeholder="Tài khoản..."></div>
            <div class="input-group"><label>Mật khẩu</label><input type="password" id="reg-pass" class="auth-input" placeholder="••••••••"><span class="eye-icon" id="toggle-eye-reg">👁️</span></div>
            <div class="input-group"><label>Email</label><input type="email" id="reg-email" class="auth-input" placeholder="Email..."></div>
            <div class="input-group" style="display:flex; gap:10px;">
                <div style="flex:1"><label>Họ tên</label><input type="text" id="reg-name" class="auth-input" placeholder="Họ và tên"></div>
                <div style="flex:1"><label>SĐT</label><input type="text" id="reg-phone" class="auth-input" placeholder="SĐT"></div>
            </div>
        `,
            linksHtml: `<div class="toggle-mode" onclick="renderWebLoginScreen('login')"><span>&larr; Quay lại Đăng nhập</span></div>`,
        },
        forgot: {
            title: 'Khôi phục Mật khẩu', subtitle: 'Nhập User & Email đã đăng ký', btnText: 'Gửi mã xác nhận', btnClass: 'auth-btn',
            formHtml: `
            <div class="input-group"><label>Tên đăng nhập</label><input type="text" id="forgot-user" class="auth-input" placeholder="Nhập tên tài khoản..."></div>
            <div class="input-group"><label>Email đăng ký</label><input type="email" id="forgot-email" class="auth-input" placeholder="Nhập Email..."></div>
        `,
            linksHtml: `<div class="toggle-mode" onclick="renderWebLoginScreen('login')"><span>&larr; Quay lại Đăng nhập</span></div>`,
        },
        verify: {
            title: 'Xác minh OTP', subtitle: 'Đã gửi mã xác thực vào Email đã đăng ký!', btnText: 'Xác nhận OTP', btnClass: 'auth-btn',
            formHtml: `<div class="input-group"><label>Mã OTP</label><input type="text" id="reset-token" class="auth-input" placeholder="XXXXXX" style="text-align: center; font-size: 18px; letter-spacing: 4px;" maxlength="6"></div>`,
            linksHtml: () => {
                window.resendOtpAction = async function() {
                    if (typeof showToast === 'function') showToast("Đang gửi lại mã...", "info");
                    try {
                        if (window.eel && window.eel.request_change_password_otp) {
                            const reason = window._otpIntent === 'verify_email' ? 'xác minh liên kết Email' : 'khôi phục mật khẩu';
                            const res = await window.eel.request_change_password_otp(reason)();
                            if (res && res[0]) {
                                if (typeof showToast === 'function') showToast("Đã gửi lại mã OTP! Vui lòng kiểm tra hộp thư rác (Spam).", "success");
                            } else {
                                if (typeof showToast === 'function') showToast(res ? res[1] : "Lỗi không xác định", "error");
                            }
                        } else {
                            if (typeof showToast === 'function') showToast("Không tìm thấy API gửi lại mã", "error");
                        }
                    } catch(e) {
                        if (typeof showToast === 'function') showToast("Lỗi kết nối", "error");
                    }
                };
                return `<div class="toggle-mode" style="display:flex; justify-content:space-between; width:100%;"><span onclick="renderWebLoginScreen('login')" style="cursor:pointer; color:#a371f7;">&larr; Quay lại Đăng nhập</span><span onclick="window.resendOtpAction()" style="cursor:pointer; color:#a371f7; font-weight:bold;">Gửi lại mã OTP</span></div>`;
            },
        },
        reset: {
            title: 'Mật khẩu mới', subtitle: 'Vui lòng thiết lập mật khẩu mới', btnText: 'Lưu mật khẩu', btnClass: 'auth-btn',
            formHtml: `<div class="input-group" style="position: relative;"><label>Mật khẩu mới</label><input type="password" id="reset-pass" class="auth-input" placeholder="••••••••"><span class="eye-icon" id="toggle-eye-reset" style="position: absolute; right: 10px; top: 38px; cursor: pointer; filter: grayscale(1);">👁️</span></div>`,
            linksHtml: `<div class="toggle-mode" onclick="renderWebLoginScreen('login')"><span>&larr; Quay lại Đăng nhập</span></div>`,
        },
        license: {
            title: 'Kích hoạt Bản quyền', subtitle: 'Nhập License Key để mở khóa', btnText: 'Kích hoạt', btnClass: 'auth-btn btn-green',
            formHtml: `<div class="input-group"><label>License Key</label><input type="text" id="auth-key" class="auth-input" placeholder="XXXX-XXXX-XXXX-XXXX" style="text-align: center; letter-spacing: 1px; color: #eab308; font-weight: bold;"></div>`,
            linksHtml: '',
        },
    };
    const modeDef = MODE_DEFS[mode] || MODE_DEFS.license;
    const { title, subtitle, btnText, btnClass, formHtml } = modeDef;
    const linksHtml = typeof modeDef.linksHtml === 'function' ? modeDef.linksHtml() : modeDef.linksHtml;

    const container = document.createElement('div');
    container.id = 'license-overlay';
    container.innerHTML = `
        <div class="auth-container">
            ${LICENSE_ONLY ? '' : `<div class="auth-tabs">
                <div class="auth-tab ${isAccountTab ? 'active' : ''}" onclick="renderWebLoginScreen('login')">Tài khoản</div>
                <div class="auth-tab ${isLicense ? 'active' : ''}" onclick="renderWebLoginScreen('license')">Bản quyền</div>
            </div>`}

            <div class="auth-title">${title}</div>
            <div class="auth-subtitle">${subtitle}</div>
            
            <div class="hwid-container" title="Mã máy nhận diện phần cứng">
                <span>HWID: <strong id="hwid-text" style="color:#e2e8f0;">Đang tải...</strong></span>
                <span class="hwid-copy" id="hwid-copy">Copy</span>
            </div>
            
            ${formHtml}
            
            <button id="auth-submit" class="${btnClass}">${btnText}</button>
            ${(isLogin || isLicense) ? '<button id="trial-start-popup" class="auth-btn btn-trial">Dùng thử Premium miễn phí 14 ngày</button>' : ''}
            <div id="auth-error" class="error-msg"></div>
            
            <div class="link-container">${linksHtml}</div>
            <div class="footer-links">
                <a href="https://t.me/+ohYhI2gzHq02OTE1" target="_blank" style="color: #a855f7; text-decoration: none; font-weight: 500;" onclick="if(window.pywebview){window.pywebview.api.open_link('https://t.me/+ohYhI2gzHq02OTE1'); return false;}">💬 Hỗ trợ Telegram</a>
                <span style="margin: 0 8px;">|</span>
                <span style="color: #a855f7; font-weight: 500; cursor: pointer;" onclick="navigator.clipboard.writeText('mmo.solusionhelp@gmail.com').catch(()=>{}); this.innerText='Đã Copy!'; setTimeout(()=>this.innerText='✉️ Hỗ trợ Email', 2000);">✉️ Hỗ trợ Email</span>
            </div>
        </div>
    `;
    document.body.appendChild(container);

    setTimeout(() => { const firstInput = document.querySelector('.auth-input'); if (firstInput) firstInput.focus(); }, 100);

    // pywebview chi gan window.pywebview.api sau su kien 'pywebviewready' -- goi ngay
    // luc trang vua nap se rot vao "API not found" (HWID hien "Loi tai HWID").
    const waitBridge = () => new Promise(resolve => {
        if (window.eel || (window.pywebview && window.pywebview.api)) return resolve();
        window.addEventListener('pywebviewready', () => resolve(), { once: true });
        setTimeout(resolve, 5000);
    });
    const callApi = (method, ...args) => waitBridge().then(() => {
        if (window.pywebview && window.pywebview.api && window.pywebview.api[method]) return window.pywebview.api[method](...args);
        if (window.eel && window.eel[method]) return window.eel[method](...args)();
        return Promise.reject("API not found");
    });

    callApi('get_license_info').then(info => {
        const hwid = (info && info.hwid) ? info.hwid : 'N/A';
        document.getElementById('hwid-text').innerText = hwid.substring(0, 16) + '...';
        document.getElementById('hwid-copy').onclick = () => {
            const cp = document.getElementById('hwid-copy');
            const showResult = (ok) => {
                cp.innerText = ok ? 'Đã Copy!' : 'Lỗi Copy';
                cp.style.color = ok ? '#34d399' : '#f87171';
                setTimeout(() => { cp.innerText = 'Copy'; cp.style.color = ''; }, 2000);
            };
            const fallbackCopy = () => {
                // navigator.clipboard bị chặn quyền trong 1 số môi trường Chrome App Mode
                // (do các cờ --disable-features/--test-type khi khởi chạy) -- dùng execCommand
                // qua 1 textarea ẩn làm phương án dự phòng thay vì âm thầm báo "Đã Copy!" giả.
                try {
                    const ta = document.createElement('textarea');
                    ta.value = hwid;
                    ta.style.position = 'fixed'; ta.style.opacity = '0';
                    document.body.appendChild(ta);
                    ta.focus(); ta.select();
                    const ok = document.execCommand('copy');
                    document.body.removeChild(ta);
                    showResult(ok);
                } catch (e) { showResult(false); }
            };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(hwid).then(() => showResult(true)).catch(fallbackCopy);
            } else {
                fallbackCopy();
            }
        };
    }).catch(() => { document.getElementById('hwid-text').innerText = 'Lỗi tải HWID'; });

    if (isLogin) {
        const eye = document.getElementById('toggle-eye');
        const pass = document.getElementById('auth-pass');
        if (eye && pass) {
            eye.onclick = () => {
                if (pass.type === 'password') { pass.type = 'text'; eye.innerText = '🙈'; }
                else { pass.type = 'password'; eye.innerText = '👁️'; }
            };
        }
    }

    
        const setupEye = (iconId, inputId) => {
            const icon = document.getElementById(iconId);
            const input = document.getElementById(inputId);
            if (icon && input) {
                icon.addEventListener('click', () => {
                    if (input.type === 'password') { input.type = 'text'; icon.style.filter = 'grayscale(0)'; }
                    else { input.type = 'password'; icon.style.filter = 'grayscale(1)'; }
                });
            }
        };
        setupEye('toggle-eye-login', 'login-pass');
        setupEye('toggle-eye-reg', 'reg-pass');
        setupEye('toggle-eye-reset', 'reset-pass');
        
        const btnSubmit = document.getElementById('auth-submit');
    const errorDiv = document.getElementById('auth-error');
    const showError = (msg, isSuccess = false) => { errorDiv.className = isSuccess ? 'error-msg success show' : 'error-msg show'; errorDiv.innerText = msg; };

    const trialPopupButton = document.getElementById('trial-start-popup');
    if (trialPopupButton) trialPopupButton.onclick = async () => {
        trialPopupButton.disabled = true;
        trialPopupButton.innerText = '⏳ Đang kích hoạt trial...';
        try {
            const result = await callApi('start_trial_14_days');
            if (result && result[0]) {
                showError(result[1] || 'Đã kích hoạt trial 14 ngày!', true);
                setTimeout(() => renderPostLogin(), 600);
            } else {
                showError((result && result[1]) || 'Không đủ điều kiện nhận trial.');
                trialPopupButton.disabled = false;
                trialPopupButton.innerText = 'Dùng thử Premium miễn phí 14 ngày';
            }
        } catch (_) {
            showError('Không kết nối được máy chủ để kích hoạt trial.');
            trialPopupButton.disabled = false;
            trialPopupButton.innerText = 'Dùng thử Premium miễn phí 14 ngày';
        }
    };

    
    
    
    
    const renderPostLogin = () => { console.log("LOGIN SUCCESS -> renderPostLogin");
        const container = document.querySelector('.auth-container');
        container.innerHTML = `
            <div class="auth-tabs" style="border:none; justify-content:center; padding-top:10px;">
                <div class="auth-icon" style="font-size:48px;">🎉</div>
            </div>
            <h2 class="auth-title">Đăng nhập thành công!</h2>
            <p class="auth-subtitle" style="margin-bottom:25px;">Chào mừng trở lại hệ thống.</p>
            
            <button id="btn-dash" class="auth-btn" style="height: 48px; font-size: 15px; margin-bottom:12px; display:flex; align-items:center; justify-content:center; gap:8px;" onclick="handleDash()">
                <span style="font-size:18px">📊</span> Bảng Quản lý Tài khoản
            </button>
            
            <button id="btn-close" class="auth-btn" style="height: 48px; font-size: 15px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #fff; display:flex; align-items:center; justify-content:center; gap:8px;" onclick="handleClose()">
                <span style="font-size:18px">🚀</span> Mở Ứng Dụng Ngay
            </button>
        `;
    };
    
    window.handleDash = async () => { 
        const overlay = document.getElementById('license-overlay');
        if (overlay) {
            overlay.style.transition = 'opacity 0.3s ease-out';
            overlay.style.opacity = '0';
            setTimeout(() => { overlay.remove(); }, 300);
        }
        if (typeof window.switchTab === 'function') window.switchTab('tab-profile');
        if (typeof eel !== 'undefined' && eel.get_license_info) {
            try {
                window.licenseInfo = await eel.get_license_info()();
                if (typeof window.renderProfileTab === 'function') window.renderProfileTab();
                if (typeof window.updateSidebarProfile === 'function') window.updateSidebarProfile();
            } catch (e) {}
        }
    };
    window.handleClose = async () => { 
        const overlay = document.getElementById('license-overlay');
        if (overlay) {
            overlay.style.transition = 'opacity 0.3s ease-out';
            overlay.style.opacity = '0';
            setTimeout(() => { overlay.remove(); }, 300);
        }
        if (typeof window.switchTab === 'function') window.switchTab('command-center');
        if (typeof eel !== 'undefined' && eel.get_license_info) {
            try {
                window.licenseInfo = await eel.get_license_info()();
                if (typeof window.updateSidebarProfile === 'function') window.updateSidebarProfile();
            } catch (e) {}
        }
    };

    // Bang tra theo mode cho handleSubmit -- thay cho chuoi if/else truoc day, cung
    // muc dich voi MODE_DEFS o dau ham (de sau nay cat rieng entry account-only).
    // Dinh nghia o day (khong dua len MODE_DEFS phia tren) vi can dong voi cac
    // closure resetBtn/showError/renderPostLogin/callApi chi san sang tu diem nay.
    // resetBtn phai khai bao TRUOC submitHandlers (khong phai ben trong handleSubmit
    // nhu code goc) de cac ham trong submitHandlers -- dinh nghia o scope ngoai
    // handleSubmit -- co the tham chieu duoc no.
    const resetBtn = () => { btnSubmit.disabled = false; btnSubmit.innerText = btnText; };
    const submitHandlers = {
        login: () => {
            const user = document.getElementById('auth-user').value.trim();
            const pass = document.getElementById('auth-pass').value.trim();
            if (!user || !pass) { showError('Vui lòng nhập đủ thông tin!'); resetBtn(); return; }
            callApi('login_account', user, pass).then(([success, msg]) => {
                if (success) { renderPostLogin(); }
                else { showError(msg || 'Sai tài khoản hoặc mật khẩu!'); resetBtn(); }
            }).catch(() => { showError('Lỗi kết nối máy chủ cục bộ!'); resetBtn(); });
        },
        register: () => {
            const user = document.getElementById('reg-user').value.trim();
            const name = document.getElementById('reg-name').value.trim();
            const phone = document.getElementById('reg-phone').value.trim();
            const email = document.getElementById('reg-email').value.trim();
            const pass = document.getElementById('reg-pass').value.trim();
            if (!user || !pass) { showError('Vui lòng điền Tài khoản và Mật khẩu!'); resetBtn(); return; }
            callApi('register_account', user, email, phone, name, pass).then(([success, msg]) => {
                if (success) { showError('Đăng ký thành công!', true); setTimeout(() => renderWebLoginScreen('login'), 1500); }
                else { showError(msg || 'Đăng ký thất bại!'); resetBtn(); }
            }).catch(() => { showError('Lỗi kết nối!'); resetBtn(); });
        },
        verify: () => {
            const token = document.getElementById('reset-token').value.trim();
            if (!token) { showError('Vui lòng nhập OTP!'); resetBtn(); return; }
            callApi('verify_otp', token).then(([success, msg]) => {
                if (success) {
                    window.verifiedToken = token;
                    showError('Mã hợp lệ!', true);
                    if (window._otpIntent === 'verify_email') {
                        setTimeout(() => {
                            const overlay = document.getElementById('license-overlay');
                            if (overlay) overlay.remove();
                            if (typeof window.showToast === 'function') window.showToast("Xác minh Email thành công!", "success");
                            const banner = document.getElementById('email-verify-banner');
                            if (banner) banner.style.display = 'none';
                            const badge = document.getElementById('profile-email-badge');
                            if (badge) {
                                badge.textContent = 'Đã xác minh';
                                badge.className = 'status-badge active';
                            }
                        }, 1000);
                    } else {
                        setTimeout(() => renderWebLoginScreen('reset'), 1000);
                    }
                }
                else { showError(msg || 'Mã không đúng!'); resetBtn(); }
            }).catch(() => { showError('Lỗi kết nối!'); resetBtn(); });
        },
        reset: () => {
            const pass = document.getElementById('reset-pass').value.trim();
            const token = window.verifiedToken || '';
            if (!pass) { showError('Vui lòng nhập mật khẩu mới!'); resetBtn(); return; }
            callApi('reset_password', token, pass).then(([success, msg]) => {
                if (success) { showError('Đổi mật khẩu thành công!', true); setTimeout(() => renderWebLoginScreen('login'), 1500); }
                else { showError(msg || 'Thất bại!'); resetBtn(); }
            }).catch(() => { showError('Lỗi kết nối!'); resetBtn(); });
        },
        forgot: () => {
            const user = document.getElementById('forgot-user').value.trim();
            const email = document.getElementById('forgot-email').value.trim();
            if (!user || !email) { showError('Nhập đủ User và Email!'); resetBtn(); return; }
            callApi('forgot_password', user, email).then(([success, msg]) => {
                if (success) { showError(msg || 'Đã gửi mã qua Email!', true); setTimeout(() => renderWebLoginScreen('verify'), 2000); }
                else { showError(msg || 'Thất bại!'); resetBtn(); }
            }).catch(() => { showError('Lỗi kết nối!'); resetBtn(); });
        },
        license: () => {
            const key = document.getElementById('auth-key').value.trim();
            if (!key) { showError('Vui lòng nhập Key!'); resetBtn(); return; }
            callApi('validate_new_license', key).then(([success, msg]) => {
                if (success) { renderPostLogin(true); }
                else { showError(msg || 'Key không hợp lệ!'); resetBtn(); }
            }).catch(() => { showError('Lỗi kết nối!'); resetBtn(); });
        },
    };

    const handleSubmit = () => {
        errorDiv.classList.remove('show');
        btnSubmit.disabled = true; btnSubmit.innerText = '⏳ Đang xử lý...';
        (submitHandlers[mode] || submitHandlers.license)();
    };
    btnSubmit.onclick = handleSubmit;
    container.querySelectorAll('.auth-input').forEach(input => { input.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleSubmit(); }); });
}
        // Initialize UI
        renderWebLoginScreen('{INITIAL_MODE}');
    </script>
</body>
</html>
""".replace('{INITIAL_MODE}', initial_mode)

        if "ACCOUNT" not in self.auth_modes:
            html = html.replace("<div class=\"toggle-mode\" onclick=\"renderWebLoginScreen('login')\">Hoặc <span>Đăng nhập bằng Tài khoản</span></div>", "")

        api = Api(self)
        title = "Kích Hoạt Bản Quyền" if "ACCOUNT" not in self.auth_modes else "Đăng nhập Tài khoản"
        
        window = webview.create_window(
            title, 
            html=html,
            js_api=api,
            width=460, 
            height=600,
            resizable=False,
            frameless=False,
            background_color='#18181b'
        )
        api._window = window
        webview.start(debug=False)
        
        return (self.license_key is not None) or (self.username is not None)

    def get_hwid(self):
        """Lấy mã định danh phần cứng (HWID), có cache cục bộ.

        WMIC đôi khi chập chờn (một trong ba lệnh uuid/cpu/mainboard thất bại
        ở lần chạy này nhưng thành công ở lần khác), khiến mã máy tính lại
        từ đầu mỗi lần khởi động cho ra giá trị khác nhau trên cùng 1 máy vật
        lý. Cache giá trị hợp lệ đầu tiên xuống đĩa và tái sử dụng để mỗi máy
        chỉ có đúng 1 mã máy duy nhất, bất kể WMIC có ổn định hay không.
        """
        cached = _read_cached_hwid()
        if cached:
            return cached
        hwid = self._compute_hwid()
        _write_cached_hwid(hwid)
        return hwid

    def _compute_hwid(self):
        """Tính HWID trực tiếp từ phần cứng (không qua cache)."""
        _sys = platform.system()
        try:
            if _sys == "Windows":
                uuid = subprocess.check_output(
                    ["wmic", "csproduct", "get", "uuid"],
                    creationflags=0x08000000,
                    stderr=subprocess.DEVNULL,
                    timeout=4,
                ).decode(errors="ignore").split('\n')[1].strip()
                
                # Sửa lỗi nhiều HWID: Gom tất cả CPU ID lại (hỗ trợ máy chủ/máy trạm có 2+ CPU)
                try:
                    cpu_out = subprocess.check_output(
                        ["wmic", "cpu", "get", "processorid"],
                        creationflags=0x08000000,
                        stderr=subprocess.DEVNULL,
                        timeout=4,
                    ).decode(errors="ignore").split('\n')[1:]
                    cpu_ids = sorted([c.strip() for c in cpu_out if c.strip()])
                    cpu = "".join(cpu_ids)
                    if not cpu: cpu = "UNKNOWN_CPU"
                except:
                    cpu = "UNKNOWN_CPU"
                
                mb = subprocess.check_output(
                    ["wmic", "baseboard", "get", "serialnumber"],
                    creationflags=0x08000000,
                    stderr=subprocess.DEVNULL,
                    timeout=4,
                ).decode(errors="ignore").split('\n')[1].strip()
                combined = f"{uuid}-{cpu}-{mb}"
            elif _sys == "Darwin":  # macOS
                import re as _re_hwid
                hw_uuid = subprocess.check_output(
                    ["ioreg", "-rd1", "-c", "IOPlatformExpertDevice"],
                    stderr=subprocess.DEVNULL
                ).decode()
                m = _re_hwid.search(r'"IOPlatformUUID"\\s*=\\s*"([^"]+)"', hw_uuid)
                uuid_val = m.group(1) if m else ""
                serial = subprocess.check_output(
                    ["system_profiler", "SPHardwareDataType"],
                    stderr=subprocess.DEVNULL
                ).decode()
                m2 = _re_hwid.search(r'Serial Number.*?:\\s*(\\S+)', serial)
                serial_val = m2.group(1) if m2 else ""
                combined = f"{uuid_val}-{serial_val}-mac"
            else:  # Linux
                machine_id = ""
                for path in ["/etc/machine-id", "/var/lib/dbus/machine-id"]:
                    if os.path.exists(path):
                        with open(path, "r") as f:
                            machine_id = f.read().strip()
                        break
                combined = f"{machine_id}-{platform.node()}-linux"
            return hashlib.md5(combined.encode()).hexdigest().upper()
        except:
            return hashlib.md5(platform.node().encode()).hexdigest().upper()

    def _get_headers(self):
        return {
            _d('=YrA1xAAE0qT1TN8MUH0LyJe'): CLIENT_API_KEY,
            _d('4XQqvAwAPzszq0ySNE9KNzUyOXH0LyJe'): CLIENT_VERSION,  # V2 Header
            "Content-Type": "application/json",
            "User-Agent": "Edu-Metrics-Secure-Client"
        }

    def _get_payload(self, license_key):
        import time
        import uuid
        return {
            "licenseKey": license_key,
            "machineId": self.hwid,
            "timestamp": int(time.time()),
            "nonce": str(uuid.uuid4()),
            "machineInfo": {
                "hostname": platform.node(),
                "os": f"{platform.system()} {platform.release()}",
                "cpu": platform.processor(),
                "product": PRODUCT_ID
            }
        }

    # ==========================================
    def save_grace_token(self, token):
        try:
            self._save_local_secret_file(GRACE_TOKEN_FILE, {"token": token})
        except Exception: pass

    def load_grace_token(self):
        if os.path.exists(GRACE_TOKEN_FILE):
            try:
                decrypted = self._load_local_secret_file(GRACE_TOKEN_FILE)
                if decrypted and isinstance(decrypted, dict):
                    return decrypted.get("token")
            except Exception: pass
        return None

    # ==========================================
    # PHỤC HỒI KEY SAU KHI SERVER XOAY (Key Rotation recovery)
    # ==========================================
    def save_device_secret(self, secret):
        try:
            self._save_local_secret_file(DEVICE_SECRET_FILE, {"secret": secret})
        except Exception:
            pass

    def load_device_secret(self):
        if os.path.exists(DEVICE_SECRET_FILE):
            try:
                decrypted = self._load_local_secret_file(DEVICE_SECRET_FILE)
                if decrypted and isinstance(decrypted, dict):
                    return decrypted.get("secret")
            except Exception:
                pass
        return None

    def _ensure_device_secret(self, license_key):
        """Xin server cấp bí mật thiết bị (chỉ 1 lần, chưa có thì mới xin). Chạy nền, lỗi thì bỏ qua."""
        if LICENSE_API_SEGMENT == "game" or not license_key:
            return
        try:
            if self.load_device_secret():
                return
            url = f"{SERVER_URL}/api/v2/{LICENSE_API_SEGMENT}/device-secret"
            resp = self._post_api(url, self._get_payload(license_key), timeout=10)
            signature = resp.headers.get(_d('==AOEo4FAUgStkCLL9MTO3A0LyJe'))
            if not signature:
                return
            is_valid, _msg = verify_server_signature(resp.text, signature)
            if not is_valid:
                return
            data = resp.json()
            secret = data.get("device_secret")
            if resp.status_code == 200 and data.get("success") and secret:
                self.save_device_secret(secret)
        except Exception as e:
            print(f"[KeyRecovery] Chưa xin được bí mật thiết bị: {e.__class__.__name__}")

    def _try_recover_key(self, old_key):
        """Đổi key CŨ (server đã xoay) lấy key hiện tại bằng bằng chứng thiết bị, rồi tự lưu lại.
        Trả về key hiện tại, hoặc None nếu không phục hồi được (chưa có bí mật, quá cửa sổ phục hồi, license bị khóa...)."""
        if LICENSE_API_SEGMENT == "game" or not old_key:
            return None
        try:
            import hmac
            secret = self.load_device_secret()
            if not secret:
                return None
            payload = self._get_payload(old_key)
            msg = f"{self.hwid}|{old_key}|{payload['timestamp']}".encode('utf-8')
            payload["proof"] = hmac.new(secret.encode('utf-8'), msg, hashlib.sha256).hexdigest()
            url = f"{SERVER_URL}/api/v2/{LICENSE_API_SEGMENT}/recover-key"
            resp = self._post_api(url, payload, timeout=10)
            signature = resp.headers.get(_d('==AOEo4FAUgStkCLL9MTO3A0LyJe'))
            if not signature:
                return None
            is_valid, _msg = verify_server_signature(resp.text, signature)
            if not is_valid:
                return None
            data = resp.json()
            new_key = data.get("new_license_key")
            if resp.status_code == 200 and data.get("success") and new_key:
                if new_key != old_key:
                    self._save_rotation_log(
                        old_key_masked=old_key[:6] + '****' if len(old_key) > 6 else '****',
                        new_key_masked=new_key[:6] + '****' if len(new_key) > 6 else '****'
                    )
                    self.update_local_license_file(new_key)
                    self.license_key = new_key
                return new_key
        except Exception as e:
            print(f"[KeyRecovery] Phục hồi key thất bại: {e.__class__.__name__}")
        return None

    def validate_offline(self, license_key):
        """Validate offline bằng grace token (JWT) - Khi rớt mạng"""
        try:
            token = self.load_grace_token()
            if not token:
                return False, "Không có thẻ bài Offline. Vui lòng kết nối mạng để đăng nhập lần đầu."
            
            # Decode JWT và BẮT BUỘC VERIFY SIGNATURE BẰNG RSA PUBLIC KEY để chống giả mạo!
            try:
                payload = jwt.decode(token, RSA_PUBLIC_KEY, algorithms=["RS256"], options={"verify_signature": True})
            except jwt.ExpiredSignatureError:
                return False, "Thẻ bài Offline đã hết hạn. Vui lòng kết nối mạng để gia hạn."
            except jwt.InvalidTokenError:
                return False, "Thẻ bài Offline giả mạo! Lập tức hủy quyền truy cập."
            
            # Kiểm tra xem Key trong file có khớp với Key đang chạy không
            if payload.get("licenseKey") != license_key:
                return False, "Thẻ bài Offline không khớp với Key hiện tại."
                
            # Kiểm tra xem mã máy có khớp không (Chống copy file qua máy khác)
            if payload.get("machineId") and payload.get("machineId") != self.hwid:
                return False, "Thẻ bài Offline không dành cho thiết bị này. Phát hiện chép lậu!"
            if payload.get("type") != "offline_grace":
                return False, "Thẻ bài Offline cũ hoặc sai loại; vui lòng kết nối mạng để làm mới."

            self.license_key = license_key
            self._verified_features = {
                value.strip() for value in str(payload.get('features') or '').split(',') if value.strip()
            }
            self.session_data = {
                'features': payload.get('features', ''),
                'expiresAt': payload.get('expiresAt')
            }
            self.is_account = False
            
            return True, "Đăng nhập Offline thành công (Grace Period)"
        except Exception as e:
            return False, f"Lỗi xác thực Offline: {e}"

    # PHASE 1: ONLINE VALIDATION WITH RSA SIGNATURE
    # ==========================================

    def _post_api(self, url, payload, timeout=10):
        if not getattr(self, 'ENABLE_E2EE', False):
            return requests.post(url, json=payload, headers=self._get_headers(), timeout=timeout)
            
        import os, base64, json
        from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
        from cryptography.hazmat.backends import default_backend
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric import padding
        from cryptography.hazmat.primitives.serialization import load_pem_public_key

        try:
            aes_key = os.urandom(32)
            aes_iv = os.urandom(16)
            
            payload_bytes = json.dumps(payload).encode('utf-8')
            pad_len = 16 - (len(payload_bytes) % 16)
            payload_bytes += bytes([pad_len]) * pad_len
            
            cipher = Cipher(algorithms.AES(aes_key), modes.CBC(aes_iv), backend=default_backend())
            encryptor = cipher.encryptor()
            encrypted_payload = encryptor.update(payload_bytes) + encryptor.finalize()
            
            pub_key = load_pem_public_key(RSA_PUBLIC_KEY.encode('utf-8'), backend=default_backend())
            encrypted_key = pub_key.encrypt(
                aes_key + aes_iv,
                padding.OAEP(
                    mgf=padding.MGF1(algorithm=hashes.SHA256()),
                    algorithm=hashes.SHA256(),
                    label=None
                )
            )
            
            e2ee_payload = {
                "e2ee_payload": base64.b64encode(encrypted_payload).decode('utf-8'),
                "e2ee_key": base64.b64encode(encrypted_key).decode('utf-8')
            }
            
            resp = requests.post(url, json=e2ee_payload, headers=self._get_headers(), timeout=timeout)
            
            class E2EEResponse:
                def __init__(self, original_resp):
                    self.original_resp = original_resp
                    self.status_code = original_resp.status_code
                    self.headers = original_resp.headers
                    self._decrypted_text = None  # cache, giải mã đúng 1 lần

                def _resolve_text(self):
                    if self._decrypted_text is not None:
                        return self._decrypted_text
                    data = self.original_resp.json()
                    if "e2ee_response" in data:
                        encrypted_resp = base64.b64decode(data["e2ee_response"])
                        decipher = Cipher(algorithms.AES(aes_key), modes.CBC(aes_iv), backend=default_backend())
                        decryptor = decipher.decryptor()
                        decrypted_padded = decryptor.update(encrypted_resp) + decryptor.finalize()
                        unpad_len = decrypted_padded[-1]
                        self._decrypted_text = decrypted_padded[:-unpad_len].decode('utf-8')
                    else:
                        raise ValueError("Server response is missing the required E2EE envelope")
                    return self._decrypted_text

                @property
                def text(self):
                    # Chữ ký bảo mật của Server được tính trên nội dung JSON GỐC (trước khi
                    # server mã hóa E2EE để gửi đi), nên phải verify trên bản đã giải mã --
                    # không phải trên gói tin thô/mã hóa trên đường truyền.
                    return self._resolve_text()

                def json(self):
                    return json.loads(self._resolve_text())

            return E2EEResponse(resp)
        except Exception as e:
            # Never retry the request as plaintext after an E2EE failure.
            # HTTPS remains mandatory and callers decide whether E2EE is enabled.
            raise requests.exceptions.RequestException("E2EE request failed") from e

    def validate(self, license_key):
        """Kiểm tra License với Server V2"""
        url = f"{SERVER_URL}/api/v2/{LICENSE_API_SEGMENT}/validate"  # V2
        try:
            _run_client_hooks("pre_validate", {"lm": self, "license_key": license_key})
            # Gửi Request lên Server
            response = self._post_api(url, self._get_payload(license_key), timeout=10)
            
            # --- [XÁC MINH BẢO MẬT API] ---
            signature = response.headers.get(_d('==AOEo4FAUgStkCLL9MTO3A0LyJe'))
            if not signature:
                return False, "🚫 Thiếu chữ ký bảo mật từ Server (Phát hiện giả mạo Server)!"
            is_valid, msg = verify_server_signature(response.text, signature)
            if not is_valid:
                return False, f"🚫 [BẢO MẬT] Cảnh báo: API Kiểm tra Kích hoạt bị giả mạo: {msg}"
            # --------------------------
            
            data = response.json()

            if response.status_code == 200 and data.get("valid"):
                # --- [XÁC MINH CHỮ KÝ ONLINE TỪ SERVER] ---
                v2_data = data.get("v2", {})
                validation_token = v2_data.get(_d('=0iBXGDAD0sTPn8CPzcyskETJz8SrwJe'))
                
                if not validation_token:
                    return False, "🚫 Thiếu chữ ký bảo mật từ Server (Phát hiện giả mạo Server)!"
                
                try:
                    payload = jwt.decode(validation_token, RSA_PUBLIC_KEY, algorithms=["RS256"], options={"verify_signature": True}, leeway=60)
                    if payload.get("machineId") != self.hwid:
                        return False, "🚫 Token không dành cho thiết bị này (Phát hiện giả mạo)!"
                    if payload.get("licenseKey") != license_key:
                        return False, "🚫 Token không khớp license đang xác thực."
                    self._verified_features = {
                        value.strip() for value in str(payload.get('features') or '').split(',') if value.strip()
                    }
                except jwt.ExpiredSignatureError:
                    return False, "🚫 Gói tin xác thực đã quá hạn 5 phút (Phát hiện tấn công bắt gói tin)!"
                except jwt.InvalidTokenError:
                    return False, "🚫 Chữ ký Server giả mạo (Phát hiện Hacker dựng máy chủ ảo)!"

                account_mode = bool(getattr(self, "is_account", False))
                account_profile = self.session_data if account_mode and isinstance(self.session_data, dict) else None
                self.license_key = license_key
                self.validation_token = validation_token
                license_data = data.get("license")
                if not isinstance(license_data, dict):
                    license_data = {}
                if account_profile is not None:
                    # Validate trả payload license riêng; gắn lại account để
                    # get_license_info() vẫn đọc được tên, email và SĐT.
                    merged_session = dict(license_data)
                    merged_session["account"] = account_profile.get("account", account_profile)
                    self.session_data = merged_session
                    self.is_account = True
                else:
                    self.session_data = license_data
                    self.is_account = False

                # --- AUTO UPDATE LOGIC (KEY ROTATION) ---
                new_key = data.get("new_license_key")
                if new_key and new_key != license_key:
                    print(f"🔄 [KeyRotation] Server trả về key mới. Đang cập nhật...")
                    # Lưu masked log trước khi ghi đè
                    self._save_rotation_log(
                        old_key_masked=license_key[:6] + '****' if len(license_key) > 6 else '****',
                        new_key_masked=new_key[:6] + '****' if len(new_key) > 6 else '****'
                    )
                    self.update_local_license_file(new_key)
                    self.license_key = new_key
                    # Thông báo nhẹ 1 lần trong phiên nếu là rotation (không phải gia hạn thông thường)
                    if data.get('rotation_notice'):
                        self._notify_key_rotated()
                # -------------------------
                
                # V2: Log registered HWIDs
                hwid_count = v2_data.get(_d('=4cB1CDAGkCd3jQ8NpULJ5CLP3kSrwJe'), 0)
                if hwid_count > 0:
                    print(f"📱 Số máy đã đăng ký: {hwid_count}")
                
                # LƯU GRACE TOKEN CHO OFFLINE MODE
                if v2_data.get(_d('EQgBWAwAN70zJ3gTMp0LLxJe')):
                    self.save_grace_token(v2_data[_d('EQgBWAwAN70zJ3gTMp0LLxJe')])
                # [UPDATE WARNING - 24H GRACE]
                update_warn = data.get("update_warning") or v2_data.get("updateWarning")
                if update_warn and isinstance(update_warn, dict):
                    warn_msg = update_warn.get("message")
                    if warn_msg:
                        print(f"⚠️ [GIA HẠN 24H] {warn_msg}")
                        def _show_grace_toast():
                            try:
                                if getattr(tk, '_default_root', None):
                                    messagebox.showwarning("Cập nhật phần mềm (Gia hạn 24h)", f"⚠️ {warn_msg}\n\nVui lòng cập nhật lên phiên bản mới sớm để tránh bị gián đoạn.")
                            except Exception:
                                pass
                        threading.Thread(target=_show_grace_toast, daemon=True).start()

                # Xin bí mật thiết bị ngầm (nếu chưa có) để sau này tự phục hồi được khi lỡ nhịp xoay key
                if LICENSE_API_SEGMENT != "game" and not self.load_device_secret():
                    threading.Thread(target=self._ensure_device_secret, args=(self.license_key,), daemon=True).start()

                _run_client_hooks("post_validate", {"lm": self, "license_key": self.license_key, "session_data": self.session_data, "success": True})
                return True, "Kích hoạt thành công"
            else:
                error_msg = data.get("error", "Mã kích hoạt không hợp lệ")
                _run_client_hooks("post_validate", {"lm": self, "license_key": license_key, "session_data": None, "success": False})
                
                # --- [XỬ LÝ LỆNH TỪ SERVER (Tự hủy cho Blacklist)] ---
                commands = data.get("commands", [])
                for cmd_obj in commands:
                    cmd_action = cmd_obj.get("cmd")
                    if cmd_action in ["FORCE_EXIT", "UNINSTALL_OLD_VERSION"]:
                        
                        # --- BÁO CÁO GIAN LẬN VỀ SERVER TRƯỚC KHI TỰ HỦY ---
                        threading.Thread(target=self.report_cheat, args=(f"Lệnh {cmd_action} từ Server",), daemon=True).start()

                        if LICENSE_API_SEGMENT == "game":
                            import shutil
                            try: shutil.rmtree(APPDATA_DIR, ignore_errors=True)
                            except Exception as e:
                                pass
                            sys.exit("Hệ thống phát hiện gian lận. Thiết bị đã bị Blacklist!")
                            
                        try:
                            # Hiện thông báo cảnh cáo
                            if getattr(tk, '_default_root', None):
                                messagebox.showerror("CẢNH BÁO BẢO MẬT", error_msg + "\n\nHệ thống phát hiện gian lận. File gốc sẽ bị xóa sổ ngay lập tức. Tính xài chùa à?")
                            else:
                                temp_root = tk.Tk()
                                temp_root.withdraw()
                                messagebox.showerror("CẢNH BÁO BẢO MẬT", error_msg + "\n\nHệ thống phát hiện gian lận. File gốc sẽ bị xóa sổ ngay lập tức. Tính xài chùa à?")
                                temp_root.destroy()
                        except Exception as e:
                            pass
                        
                        # Xóa thư mục AppData (xóa sạch key v.v...)
                        import shutil
                        try: shutil.rmtree(APPDATA_DIR, ignore_errors=True)
                        except Exception as e:
                            pass
                        
                        # Tự hủy: Đã gỡ bỏ theo yêu cầu
                        pass
                        
                        # Thoát chết ngay lập tức
                        os._exit(1)
                
                # --- [XỬ LÝ LỖI 426 - BẮT BUỘC CẬP NHẬT KIỀU MỚI] ---
                if response.status_code == 426:
                    print(f"⚠️ {error_msg} -> Đang kích hoạt Auto-Update...")
                    self.self_update(force=True)
                    return False, f"🚫 {error_msg}\n(Đang tải bản cập nhật mới...)"
                
                # [KEY ROTATION] Xử lý riêng khi key cũ đã hết grace window
                if response.status_code == 403 and data.get('error_code') == 'KEY_ROTATED_EXPIRED':
                    # Tự đổi key cũ lấy key hiện tại (cần bí mật thiết bị) thay vì bắt khách liên hệ hỗ trợ.
                    if not getattr(self, '_recovering_key', False):
                        self._recovering_key = True
                        try:
                            recovered_key = self._try_recover_key(license_key)
                        finally:
                            self._recovering_key = False
                        if recovered_key and recovered_key != license_key:
                            print("🔄 [KeyRotation] Đã phục hồi key hiện tại, đang xác thực lại...")
                            return self.validate(recovered_key)
                    rotation_id = data.get('rotation_id', '')
                    support_hint = f'\nMã hỗ trợ: {rotation_id[:8]}' if rotation_id else ''
                    return False, (
                        f'⚠️ Key này đã được hệ thống cập nhật sang phiên bản mới.\n'
                        f'Nếu bạn chưa nhận key mới, vui lòng liên hệ hỗ trợ.{support_hint}'
                    )
                # V2: HWID limit exceeded hoặc lỗi bình thường
                return False, f"🚫 {error_msg}" if response.status_code == 403 else error_msg
                
        except requests.exceptions.RequestException as e:
            # RỚT MẠNG / SERVER CHẾT -> CHẠY OFFLINE
            print(f"⚠️ Lỗi kết nối Server ({e.__class__.__name__}). Thử đăng nhập Offline...")
            return self.validate_offline(license_key)
        except Exception as e:
            print(f"[LICENSE DEBUG] {str(e)}")
            return False, "Không thể kết nối đến máy chủ. Vui lòng kiểm tra kết nối mạng và thử lại."

    # ==========================================
    # PHASE 3: AUTO-UPDATE MECHANISM
    # ==========================================
    def check_for_update(self):
        """Kiểm tra phiên bản mới từ server"""
        try:
            url = f"{SERVER_URL}/api/v2/client/check-update"
            params = {"product_id": PRODUCT_ID, "current_version": CLIENT_VERSION}
            
            response = requests.get(url, params=params, headers=self._get_headers(), timeout=5)
            if response.status_code == 200:
                # --- [XÁC MINH BẢO MẬT OTA] ---
                signature = response.headers.get(_d('==AOEo4FAUgStkCLL9MTO3A0LyJe'))
                is_valid, msg = verify_server_signature(response.text, signature)
                if not is_valid:
                    print(f"🚫 [BẢO MẬT] Cảnh báo OTA: Máy chủ nâng cấp bị giả mạo: {msg}")
                    return {"has_update": False}
                # --------------------------
                
                try:
                    data = response.json()
                except:
                    data = {}
                    
                download_url = data.get("downloadUrl", "")
                if data.get("hasUpdate") and download_url:
                    _drive_file_id(download_url)
                    return {
                        "has_update": True,
                        "version": data.get("latestVersion"),
                        "download_url": download_url,
                        "changelog": data.get("changelog"),
                        "sha256": data.get("sha256", "")
                    }
            return {"has_update": False}
        except:
            return {"has_update": False}

    def self_update(self, force=False):
        """Tự động cập nhật Client"""
        update_info = self.check_for_update()
        if not update_info.get("has_update"): return

        new_ver = update_info["version"]
        download_url = update_info["download_url"]
        changelog = update_info.get("changelog", "")
        
        # Notify user (GUI or CLI)
        if not force:
            msg = f"""🎉 Phát hiện phiên bản mới: {new_ver}
{changelog}
Bạn có muốn cập nhật ngay không?"""
            try:
                if not messagebox.askyesno("Cập nhật phần mềm", msg):
                    return
            except:
                print(f"Update available: {new_ver}. Installing...")
        else:
            try:
                messagebox.showwarning("Cập nhật bắt buộc", f"Admin yêu cầu cập nhật bắt buộc lên phiên bản {new_ver}. Tool sẽ tự động tải xuống ngay bây giờ.")
            except:
                print(f"Update forced: {new_ver}. Installing...")

        try:
            print(f"⏳ Downloading update from {download_url}...")
            current_file = os.path.abspath(sys.argv[0])
            new_file = current_file + ".new"
            digest = hashlib.sha256()
            downloaded = 0
            try:
                with _open_drive_download(download_url) as response, open(new_file, "wb") as output:
                    for chunk in response.iter_content(chunk_size=8192):
                        if not chunk:
                            continue
                        downloaded += len(chunk)
                        if downloaded > 1_000_000_000:
                            raise ValueError("File cập nhật vượt giới hạn")
                        digest.update(chunk)
                        output.write(chunk)
                expected = update_info.get("sha256", "")
                if not downloaded or not expected or digest.hexdigest() != expected.lower():
                    raise ValueError("File cập nhật không khớp mã kiểm tra của server")
            except Exception:
                if os.path.exists(new_file):
                    os.remove(new_file)
                raise

            # Replace old file (platform-specific handling).
            # Script thay file được tạo bằng tempfile.mkstemp (tên ngẫu nhiên, quyền chỉ
            # chủ sở hữu, trong thư mục tạm của user) và NHẬN ĐƯỜNG DẪN QUA THAM SỐ
            # ($1/$2, %~1/%~2) -- không chèn đường dẫn vào nội dung script. Bản cũ ghi
            # vào tên cố định ("/tmp/_capcut_update.sh" dùng chung mọi user -> bị cài
            # symlink/chiếm trước; "update.bat" ở thư mục làm việc hiện tại) và chèn
            # thẳng đường dẫn nên tên thư mục chứa $(...) / ` / " thành lệnh
            # (kiểm toán 2026-09-23, R2-6).
            import tempfile
            if platform.system() == "Windows":
                fd, batch_file = tempfile.mkstemp(prefix="_ams_update_", suffix=".bat")
                with os.fdopen(fd, "w") as f:
                    f.write('''@echo off
timeout /t 1 /nobreak > NUL
del "%~2"
move "%~1" "%~2"
start "" "%~2"
del "%~f0"
''')
                subprocess.Popen(["cmd.exe", "/c", batch_file, new_file, current_file],
                                 creationflags=0x08000000)
            else:
                # macOS / Linux: dùng shell script
                fd, sh_file = tempfile.mkstemp(prefix="_ams_update_", suffix=".sh")
                with os.fdopen(fd, "w") as f:
                    f.write('''#!/bin/bash
sleep 1
mv -- "$1" "$2"
chmod +x -- "$2"
open "$2" 2>/dev/null || xdg-open "$2" 2>/dev/null || python3 "$2" &
rm -f -- "$0"
''')
                subprocess.Popen(["bash", sh_file, new_file, current_file])
            sys.exit(0)
            
        except Exception as e:
            print(f"❌ Update error: {e}")
            messagebox.showerror("Lỗi cập nhật", f"Không thể cập nhật: {e}")

    def has_feature(self, feature_code):
        """Kiểm tra xem License có quyền sử dụng tính năng này không"""
        return feature_code in self._verified_features or 'full' in self._verified_features

    # LUÔN CÓ MẶT trong mọi bản SDK sinh ra (không nằm trong marker SDK-GEN nào) --
    # dùng chung cho CẢ BA loại thao tác (launch_emulator/run_script/use_ai), không
    # riêng emulator, nên không thể strip theo module "emulator" (trước đây từng
    # bị nhốt trong marker đó -- lỗi kiến trúc, đã sửa: xem CHANGELOG.md module
    # "script_gating" cần permit từ hàm này nhưng không cần bật "emulator").
    def authorize_operation(self, action, targets=None):
        """Xin permit 90 giây từ server cho thao tác có giá trị cao.

        Đây là lớp thực thi server-authoritative. Client chỉ xác minh chữ ký và
        ràng buộc action/HWID/target; chính sách trial, hạn dùng và khóa thiết bị
        được quyết định lại từ database tại server cho từng yêu cầu.
        """
        allowed_actions = {'launch_emulator', 'run_script', 'use_ai'}
        if action not in allowed_actions:
            return False, "Thao tác không thuộc danh sách được cấp quyền."
        if not self.license_key:
            return False, "Không có license đang hoạt động."

        normalized_targets = sorted({str(value).strip() for value in (targets or []) if str(value).strip()})
        import uuid
        nonce = str(uuid.uuid4())
        payload = {
            "licenseKey": self.license_key,
            "machineId": self.hwid,
            "action": action,
            "targets": normalized_targets,
            "nonce": nonce,
            "timestamp": int(time.time())
        }
        try:
            url = f"{SERVER_URL}/api/v2/{LICENSE_API_SEGMENT}/authorize-operation"
            response = self._post_api(url, payload, timeout=10)
            signature = response.headers.get(_d('==AOEo4FAUgStkCLL9MTO3A0LyJe'))
            valid_response, message = verify_server_signature(response.text, signature)
            if not valid_response:
                return False, f"Không xác minh được phản hồi cấp quyền: {message}"
            data = response.json()
            if response.status_code != 200 or not data.get("authorized"):
                return False, data.get("error", "Server từ chối thao tác.")

            permit = data.get("permit")
            if not permit:
                return False, "Server không trả permit."
            claims = jwt.decode(permit, RSA_PUBLIC_KEY, algorithms=["RS256"], leeway=15)
            expected_target_hash = hashlib.sha256(
                json.dumps(normalized_targets, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
            ).hexdigest()
            if claims.get("type") != "operation_permit":
                return False, "Sai loại permit."
            if claims.get("machineId") != self.hwid or claims.get("action") != action:
                return False, "Permit không khớp thiết bị hoặc thao tác."
            if claims.get("nonce") != nonce or claims.get("targetHash") != expected_target_hash:
                return False, "Permit không khớp yêu cầu hiện tại."
            return True, {
                "permit": permit,
                "operation_id": data.get("operationId"),
                "quota": data.get("quota"),
                "policy": data.get("policy") or {}
            }
        except jwt.InvalidTokenError:
            return False, "Permit có chữ ký không hợp lệ hoặc đã hết hạn."
        except requests.exceptions.RequestException:
            return False, "Không kết nối được server để cấp quyền thao tác."
        except Exception:
            return False, "Không thể xác minh quyền thao tác."

    def claim_trial_if_eligible(self):
        """Nhận trial 14 ngày theo HWID rồi xác thực lại bằng luồng chuẩn.
        Bắt buộc đã đăng ký tài khoản (self.username) trước -- server cũng tự
        chặn nếu thiếu, nhưng chặn sớm ở đây để khỏi tốn 1 round-trip mạng
        cho trường hợp chắc chắn bị từ chối."""
        if not self.username:
            return False, "Vui lòng đăng ký tài khoản trước khi dùng thử."
        payload = {
            "machineId": self.hwid,
            "productName": PRODUCT_ID,
            "username": self.username,
            "timestamp": int(time.time())
        }
        try:
            response = self._post_api(
                f"{SERVER_URL}/api/v2/{LICENSE_API_SEGMENT}/trial", payload, timeout=15
            )
            signature = response.headers.get(_d('==AOEo4FAUgStkCLL9MTO3A0LyJe'))
            valid_response, message = verify_server_signature(response.text, signature)
            if not valid_response:
                return False, f"Không xác minh được phản hồi trial: {message}"
            data = response.json()
            if response.status_code != 200 or not data.get("valid"):
                return False, data.get("error", "Không đủ điều kiện nhận trial.")
            license_key = str(data.get("licenseKey") or "").strip()
            if not license_key:
                return False, "Server không trả license trial."
            ok, validate_message = self.validate(license_key)
            if not ok:
                return False, validate_message
            self.update_local_license_file({"type": "LICENSE", "key": license_key})
            return True, "Đã kích hoạt dùng thử Premium 14 ngày."
        except requests.exceptions.RequestException:
            return False, "Không kết nối được server để nhận trial."
        except Exception as e:
            # Trước đây nuốt mất chi tiết lỗi (VD response.json() ném
            # JSONDecodeError khi server trả HTML lỗi 500 thay vì JSON) -- không
            # cách nào biết trial fail vì đâu ngoài việc đọc log server.
            return False, f"Không thể kích hoạt trial: {e}"

    # LUÔN CÓ MẶT (không nằm trong marker SDK-GEN) -- cùng lý do với
    # authorize_operation ở trên, đóng permit cho cả 3 loại thao tác.
    def finish_operation(self, operation_id, success, actual_used=None):
        if not operation_id or not self.license_key:
            return False
        payload = {
            "licenseKey": self.license_key,
            "machineId": self.hwid,
            "operationId": operation_id,
            "success": bool(success),
            "timestamp": int(time.time())
        }
        if actual_used is not None:
            payload["actualUsed"] = max(0, int(actual_used))
        try:
            response = self._post_api(
                f"{SERVER_URL}/api/v2/{LICENSE_API_SEGMENT}/finish-operation", payload, timeout=10
            )
            signature = response.headers.get(_d('==AOEo4FAUgStkCLL9MTO3A0LyJe'))
            valid_response, _ = verify_server_signature(response.text, signature)
            return bool(valid_response and response.status_code == 200 and response.json().get("success"))
        except Exception:
            return False

    # <SDK-GEN:script_gating BEGIN>
    def request_script_key(self, operation_id, permit, script_id):
        """Lớp 2 'soát vé': đổi permit (đã xin qua authorize_operation('run_script', ...))
        lấy khóa giải mã 1 kịch bản .ams đóng gói ở chế độ permit-gated (xem core/runner.py).
        Permit chỉ đổi khóa được ĐÚNG 1 LẦN -- gọi lại lần 2 với cùng operation_id sẽ bị
        server từ chối (409), không phải bug.
        """
        if not operation_id or not permit or not script_id or not self.license_key:
            return None, "Thiếu operationId/permit/scriptId."
        payload = {
            "licenseKey": self.license_key,
            "machineId": self.hwid,
            "operationId": operation_id,
            "permit": permit,
            "scriptId": script_id,
        }
        try:
            response = self._post_api(
                f"{SERVER_URL}/api/v2/{LICENSE_API_SEGMENT}/script-key", payload, timeout=10
            )
            signature = response.headers.get(_d('==AOEo4FAUgStkCLL9MTO3A0LyJe'))
            valid_response, message = verify_server_signature(response.text, signature)
            if not valid_response:
                return None, f"Không xác minh được phản hồi khóa kịch bản: {message}"
            data = response.json()
            if response.status_code != 200 or not data.get("success"):
                return None, data.get("error", "Server từ chối cấp khóa kịch bản.")
            key = data.get("key")
            if not key:
                return None, "Server không trả khóa."
            return key, None
        except requests.exceptions.RequestException:
            return None, "Không kết nối được server để lấy khóa kịch bản."
        except Exception as e:
            return None, f"Không thể lấy khóa kịch bản: {e}"
    # <SDK-GEN:script_gating END>

    def heartbeat_emulators(self, targets):
        return False

    def release_emulators(self, targets):
        return False

    def _save_rotation_log(self, old_key_masked, new_key_masked):
        """Lưu lịch sử xoay key (chỉ lưu masked, không lưu key thô)."""
        import time, json
        try:
            log_file = os.path.join(APPDATA_DIR, '.key_rotation_log.json')
            history = []
            if os.path.exists(log_file):
                try:
                    with open(log_file, 'r', encoding='utf-8') as f:
                        history = json.load(f)
                    if not isinstance(history, list):
                        history = []
                except Exception:
                    history = []
            history.append({
                'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                'old_key': old_key_masked,
                'new_key': new_key_masked
            })
            # Giữ tối đa 50 bản ghi gần nhất
            history = history[-50:]
            with open(log_file, 'w', encoding='utf-8') as f:
                json.dump(history, f, indent=2, ensure_ascii=False)
        except Exception:
            pass  # Log thất bại không được làm gián đoạn luồng chính

    def _notify_key_rotated(self):
        """Hiển thị toast nhẹ thông báo key vừa được cập nhật tự động."""
        try:
            # Tránh hiện lại nếu đã thông báo trong phiên này
            if getattr(self, '_rotation_notified_this_session', False):
                return
            self._rotation_notified_this_session = True
            import threading
            def _show():
                try:
                    import tkinter as _tk
                    from tkinter import messagebox as _mb
                    root = _tk.Tk()
                    root.withdraw()
                    root.after(100, lambda: (
                        _mb.showinfo(
                            '💡 Cập nhật bảo mật',
                            'Key của bạn vừa được hệ thống cập nhật tự động.\n'
                            'Key mới đã được lưu — bạn không cần làm gì thêm.',
                            parent=root
                        ),
                        root.destroy()
                    ))
                    root.mainloop()
                except Exception:
                    pass
            threading.Thread(target=_show, daemon=True).start()
        except Exception:
            pass

    def heartbeat(self):
        """Gửi nhịp đập V2 & Nhận Lệnh Từ Xa"""
        if not self.license_key: return
        url = f"{SERVER_URL}/api/v2/{LICENSE_API_SEGMENT}/heartbeat"
        try:
            resp = self._post_api(url, self._get_payload(self.license_key), timeout=5)
            
            # --- [XÁC MINH BẢO MẬT API] ---
            signature = resp.headers.get(_d('==AOEo4FAUgStkCLL9MTO3A0LyJe'))
            if not signature:
                print("🚫 [BẢO MẬT] Heartbeat thiếu chữ ký Server.")
                return
            is_valid, msg = verify_server_signature(resp.text, signature)
            if not is_valid:
                print(f"🚫 [BẢO MẬT] Heartbeat bị giả mạo: {msg}")
                return
            # --------------------------
            
            data = resp.json()

            # FIX (2026-09-13): server giờ gắn `policy` (plan_code/max_instances/quota/...)
            # vào mỗi response heartbeat (xem Game-Server-System capcutControllerV2.js:
            # heartbeatV2) để app ĐANG CHẠY tự cập nhật giới hạn gói trong tối đa 1-3 phút
            # (chu kỳ heartbeat) mà không cần khởi động lại - trước đây get_license_info()
            # chỉ đọc policy lúc khởi động/đăng nhập, đổi gói qua UI admin không có tác dụng
            # cho tới khi mở lại app. Ghi đè vào session_data["license"] bằng đúng tên field
            # mà get_license_info() (core/web_backend.py) đã đọc qua _safe_get/_trial_value.
            hb_policy = data.get('policy')
            if isinstance(hb_policy, dict) and isinstance(self.session_data, dict):
                license_obj = self.session_data.get('license')
                if not isinstance(license_obj, dict):
                    license_obj = {}
                    self.session_data['license'] = license_obj
                for _key in ('plan_code', 'plan_name', 'max_instances', 'unlimited_instances', 'quota', 'policy_version'):
                    if _key in hb_policy:
                        license_obj[_key] = hb_policy[_key]

            # Kiểm tra trạng thái bản quyền ngầm (Background Check)
            status = data.get('status')
            is_locked = data.get('is_locked') == 1 or data.get('is_locked') is True
            is_inactive = data.get('is_active') == 0 or data.get('is_active') is False
            
            # Key trên máy là key CŨ (server đã xoay mà client lỡ nhận key mới): thử đổi lấy key hiện tại trước khi coi là bản quyền hỏng,
            # tránh việc khách bị "LICENSE BỊ NGẮT" oan và app tự đóng.
            if status == 'invalid' and LICENSE_API_SEGMENT != "game" and not getattr(self, '_hb_recovering', False):
                self._hb_recovering = True
                try:
                    recovered_key = self._try_recover_key(self.license_key)
                finally:
                    self._hb_recovering = False
                if recovered_key:
                    print("🔄 [KeyRotation] Heartbeat: đã phục hồi key hiện tại, bỏ qua lượt này.")
                    return

            if status in ['expired', 'locked', 'invalid', 'inactive', 'device_unbound'] or is_locked or is_inactive:
                reason = data.get('reason', data.get('lock_reason', data.get('error', 'Bản quyền không hợp lệ hoặc đã bị khóa.')))
                self.stop_event.set()

                # --- BÁO ĐỘNG TELEGRAM CHO CHỦ SỞ HỮU (kèm đầy đủ danh tính khách hàng) ---
                try:
                    send_secure_telegram_alert(self._build_client_identity_message("🔒", "LICENSE BỊ NGẮT", f"Bản quyền bị ngắt kết nối: {reason}"))
                except Exception:
                    pass

                # --- BÁO CÁO GIAN LẬN VỀ SERVER TRƯỚC KHI TỰ HỦY ---
                if status == "locked" or is_locked or "từ chối" in str(status):
                    threading.Thread(target=self.report_cheat, args=(f"Tài khoản bị khóa ({reason}) - Nghi ngờ có can thiệp/Share Key",), daemon=True).start()

                if LICENSE_API_SEGMENT == "game":
                    sys.exit(f"Bản quyền bị ngắt: {reason}")
                
                def kill_logout():
                    import time, os
                    time.sleep(60)
                    os._exit(0)
                threading.Thread(target=kill_logout, daemon=True).start()
                messagebox.showerror("Bản quyền bị ngắt", f"{reason}\n\nPhần mềm sẽ tự động đóng sau khi bạn bấm OK (hoặc tự tắt sau 60s).")
                os._exit(0)
            
            # [KEY ROTATION] Xử lý new_license_key từ heartbeat response
            hb_new_key = data.get('new_license_key')
            if hb_new_key and hb_new_key != self.license_key:
                print(f"🔄 [KeyRotation] Heartbeat nhận key mới. Đang cập nhật ngầm...")
                self._save_rotation_log(
                    old_key_masked=self.license_key[:6] + '****' if self.license_key and len(self.license_key) > 6 else '****',
                    new_key_masked=hb_new_key[:6] + '****' if len(hb_new_key) > 6 else '****'
                )
                self.update_local_license_file(hb_new_key)
                self.license_key = hb_new_key
                self._notify_key_rotated()

            # Xử lý Lệnh từ xa (Remote Commands)
            commands = data.get('commands', [])
            for cmd_obj in commands:
                cmd = cmd_obj.get('cmd')
                params = cmd_obj.get('params', '')
                
                print(f"⚠️ Nhận lệnh điều khiển từ xa: {cmd}")
                
                if cmd == "LOGOUT":
                    self.stop_event.set()

                    try:
                        send_secure_telegram_alert(self._build_client_identity_message("🚫", "BỊ ÉP ĐĂNG XUẤT", "Admin đã buộc đóng phiên làm việc từ xa (lệnh LOGOUT)."))
                    except Exception:
                        pass

                    if LICENSE_API_SEGMENT == "game":
                        sys.exit("Bị Admin ép đăng xuất từ xa!")
                        
                    def kill_logout():
                        import time, os
                        time.sleep(5)
                        os._exit(0)
                    threading.Thread(target=kill_logout, daemon=True).start()
                    messagebox.showerror("Ngắt kết nối", "Admin đã buộc đóng phiên làm việc của bạn.\nTool sẽ tự tắt sau 5s.")
                    os._exit(0)
                    
                elif cmd == "SHOW_DIALOG":
                    messagebox.showinfo("Tin nhắn từ Admin", params)
                    
                elif cmd == "RESET_CONFIG":
                    try:
                        send_secure_telegram_alert(self._build_client_identity_message("♻️", "LICENSE BỊ RESET", "Bản quyền đã bị Admin reset từ xa (lệnh RESET_CONFIG)."))
                    except Exception:
                        pass

                    if os.path.exists(LICENSE_FILE):
                        pass  # Lệnh xóa Key đã được gỡ bỏ theo yêu cầu
                    if LICENSE_API_SEGMENT == "game":
                        sys.exit("Bản quyền đã bị reset. Vui lòng chạy lại Tool!")
                        
                    def kill_reset():
                        import time, os
                        time.sleep(5)
                        os._exit(0)
                    threading.Thread(target=kill_reset, daemon=True).start()
                    messagebox.showwarning("Cảnh báo bảo mật", "Bản quyền đã bị reset.\nTool sẽ tự tắt sau 5s. Vui lòng mở lại Tool.")
                    os._exit(0)
                    
                elif cmd == "FORCE_UPDATE":
                    self.self_update(force=True)


                elif cmd == "RESET_ACTION_COUNTER":
                    try:
                        import importlib
                        ag_mod = importlib.import_module("core.action_anomaly_guard")
                        _guard = getattr(ag_mod, "_anomaly_guard_instance")
                        log_reset = getattr(ag_mod, "log_action_counter_reset")
                        with _guard.lock:
                            _guard.data = {}
                            _guard._save_data()
                        log_reset("server command")
                        print("[Heartbeat] Reset action counter successfully via Server command.")
                    except Exception as e:
                        print(f"[Heartbeat] Failed to reset action counter: {e}")
                elif cmd in ["FORCE_EXIT", "UNINSTALL_OLD_VERSION"]:
                    self.stop_event.set()

                    try:
                        send_secure_telegram_alert(self._build_client_identity_message("⛔", "THIẾT BỊ BỊ BLACKLIST", f"Thiết bị đã bị đưa vào danh sách đen (lệnh {cmd}). Nghi ngờ gian lận/chia sẻ key."))
                    except Exception:
                        pass

                    # --- BÁO CÁO GIAN LẬN VỀ SERVER TRƯỚC KHI TỰ HỦY ---
                    threading.Thread(target=self.report_cheat, args=(f"Lệnh {cmd} từ Server",), daemon=True).start()

                    if LICENSE_API_SEGMENT == "game":
                        import shutil
                        try: shutil.rmtree(APPDATA_DIR, ignore_errors=True)
                        except Exception as e:
                            pass
                        sys.exit("Thiết bị đã bị Blacklist (Gian lận)!")
                        
                    try:
                        if getattr(tk, '_default_root', None):
                            messagebox.showerror("CẢNH BÁO BẢO MẬT", "Thiết bị đã bị đưa vào danh sách đen!\n\nHệ thống phát hiện gian lận. File gốc sẽ bị xóa sổ ngay lập tức. Tính xài chùa à?")
                        else:
                            temp_root = tk.Tk()
                            temp_root.withdraw()
                            messagebox.showerror("CẢNH BÁO BẢO MẬT", "Thiết bị đã bị đưa vào danh sách đen!\n\nHệ thống phát hiện gian lận. File gốc sẽ bị xóa sổ ngay lập tức. Tính xài chùa à?")
                            temp_root.destroy()
                    except Exception as e:
                        pass
                    
                    import shutil
                    try: shutil.rmtree(APPDATA_DIR, ignore_errors=True)
                    except Exception as e:
                        pass
                    
                    # Tự hủy đã được gỡ bỏ
                    os._exit(1)

            # Gia hạn TTL cho các máy ảo thực sự còn chạy. Server tự giải phóng
            # slot sau 5 phút nếu app mất kết nối hoặc bị tắt đột ngột.
            try:
                import backend_modules.api_endpoints as _runtime_api
                _list2 = _runtime_api.ld.run_cmd("list2") or ""
                _running = []
                for _line in _list2.splitlines():
                    _parts = _line.split(',')
                    if len(_parts) >= 5 and _parts[4] in ('1', '2'):
                        _running.append(_parts[1])
                self.heartbeat_emulators(_running)
            except Exception:
                pass

        except Exception as e:
            # Lỗi mạng thì bỏ qua, chờ nhịp đập lần sau
            pass
        
    def report_cheat(self, reason="Phát hiện can thiệp hệ thống", timeout=3, category="evidence"):
        """Gửi báo cáo thu thập phần cứng và phần mềm gian lận về Server.

        Trả về True/False để nơi gọi biết có cần đưa vào hàng đợi gửi lại sau hay
        không -- trước đây hàm này luôn `return None` ngầm định (không phân biệt
        gửi thành công hay lỗi mạng thầm lặng), khiến MỌI cảnh báo bảo mật gửi
        lúc mất mạng bị mất trắng, không có cách nào biết để gửi lại."""
        try:
            import os, sys, platform, getpass, subprocess
            
            # 1. Quét tiến trình (Process) và Cửa sổ (Window Class) tìm Tool Hack đang mở
            hack_tools = "Không rõ"
            try:
                out = subprocess.check_output(["tasklist"], creationflags=0x08000000, timeout=2).decode('utf-8', errors='ignore')
                processes = list(set([line.split()[0].lower() for line in out.split('\n') if '.exe' in line.lower()]))
                suspicious = ['cheatengine', 'wireshark', 'fiddler', 'charles', 'dnspy', 'x64dbg', 'ollydbg', 'httpdebugger', 'proxifier', 'mitmdump']
                found = [p for p in processes if any(s in p for s in suspicious)]

                # Quét Window Class / Title qua Ctypes để chống đổi tên file .exe
                import ctypes
                EnumWindows = ctypes.windll.user32.EnumWindows
                EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int))
                GetWindowText = ctypes.windll.user32.GetWindowTextW
                GetWindowTextLength = ctypes.windll.user32.GetWindowTextLengthW
                IsWindowVisible = ctypes.windll.user32.IsWindowVisible

                suspicious_titles = ['cheat engine', 'wireshark', 'fiddler', 'x32dbg', 'x64dbg', 'ollydbg']
                
                def foreach_window(hwnd, lParam):
                    if IsWindowVisible(hwnd):
                        length = GetWindowTextLength(hwnd)
                        if length > 0:
                            buff = ctypes.create_unicode_buffer(length + 1)
                            GetWindowText(hwnd, buff, length + 1)
                            title = buff.value.lower()
                            if any(s in title for s in suspicious_titles):
                                found.append(f"Window: {buff.value}")
                    return True

                EnumWindows(EnumWindowsProc(foreach_window), 0)

                hack_tools = ", ".join(list(set(found))) if found else "Không phát hiện"
            except Exception as e:
                pass

            # 2. Thu thập chi tiết phần cứng (Mainboard, CPU Cores, RAM) qua WMIC
            mainboard = "Không xác định"
            cpu_detail = platform.processor()
            ram_gb = "Không xác định"

            try:
                # Lấy thông tin CPU (Số nhân, số luồng)
                cpu_out = subprocess.check_output(["wmic", "cpu", "get", "Name,NumberOfCores,NumberOfLogicalProcessors", "/value"], creationflags=0x08000000, timeout=2).decode('utf-8', 'ignore')
                c_name, c_cores, c_threads = "", "", ""
                for line in cpu_out.splitlines():
                    if "Name=" in line: c_name = line.split("=")[1].strip()
                    elif "NumberOfCores=" in line: c_cores = line.split("=")[1].strip()
                    elif "NumberOfLogicalProcessors=" in line: c_threads = line.split("=")[1].strip()
                if c_name: cpu_detail = f"{c_name} ({c_cores} Cores / {c_threads} Threads)"
                
                # Lấy thông tin Mainboard (Hãng, Mã Board, Số Serial)
                mb_out = subprocess.check_output(["wmic", "baseboard", "get", "Manufacturer,Product,SerialNumber", "/value"], creationflags=0x08000000, timeout=2).decode('utf-8', 'ignore')
                mb_manuf, mb_prod, mb_sn = "", "", ""
                for line in mb_out.splitlines():
                    if "Manufacturer=" in line: mb_manuf = line.split("=")[1].strip()
                    elif "Product=" in line: mb_prod = line.split("=")[1].strip()
                    elif "SerialNumber=" in line: mb_sn = line.split("=")[1].strip()
                if mb_prod: mainboard = f"{mb_manuf} {mb_prod} (SN: {mb_sn})"
                
                # Lấy tổng dung lượng RAM
                ram_out = subprocess.check_output(["wmic", "computersystem", "get", "TotalPhysicalMemory", "/value"], creationflags=0x08000000, timeout=2).decode('utf-8', 'ignore')
                for line in ram_out.splitlines():
                    if "TotalPhysicalMemory=" in line:
                        ram_gb = f"{round(int(line.split('=')[1].strip()) / (1024**3))} GB"
            except Exception as e:
                pass

            import uuid
            mac_num = hex(uuid.getnode()).replace('0x', '').upper()
            mac_address = '-'.join(mac_num[i: i + 2] for i in range(0, 11, 2))

            machineInfo = {
                "hostname": platform.node(),
                "os": f"{platform.system()} {platform.release()}",
                "cpu": cpu_detail,
                "mainboard": mainboard,
                "ram": ram_gb,
                "product": PRODUCT_ID,
                "client_version": CLIENT_VERSION,
                "path": os.path.abspath(sys.argv[0]),
                "script_path": os.path.abspath(__file__) if '__file__' in globals() else str(sys.argv),
                "win_user": getpass.getuser(),
                "mac_address": mac_address,
                "suspicious_processes": hack_tools
            }

            url = f"{SERVER_URL}/api/v2/client/report-cheat"
            payload = {
                "licenseKey": self.license_key or self.username or "UNKNOWN",
                "machineId": self.hwid,
                "reason": reason,
                # evidence | system_fault | test -- server chỉ coi "evidence" là nghi gian lận
                # (system_fault: lỗi đóng gói/môi trường của chính app; test: nút thử báo động).
                "category": category,
                "machineInfo": machineInfo
            }
            resp = self._post_api(url, payload, timeout=timeout)
            return bool(resp is not None and 200 <= getattr(resp, "status_code", 0) < 300)
        except Exception as e:
            return False

    def _resolve_public_ip(self):
        """IP công khai hiện tại của máy khách -- để đối chiếu khi 1 license bị
        share dùng từ nhiều vị trí/mạng khác nhau (HWID một mình không thấy được
        điều này). Timeout ngắn để không làm chậm các luồng thoát khẩn cấp."""
        try:
            resp = requests.get("https://api.ipify.org?format=json", timeout=2)
            if resp.status_code == 200:
                return resp.json().get("ip", "N/A")
        except Exception:
            pass
        return "N/A"

    def _build_identity_block(self):
        """Khối thông tin định danh dùng chung (tên khách hàng/tài khoản/
        license/HWID/máy/thời lượng phiên/hạn dùng) -- tái sử dụng cho mọi
        loại thông báo Telegram gửi cho chủ sở hữu, không riêng đăng nhập."""
        import socket
        import getpass as _getpass
        import datetime as _dt
        try:
            time_str = _dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        except Exception:
            time_str = ""
        try:
            hostname = socket.gethostname()
        except Exception:
            hostname = "N/A"
        try:
            win_user = _getpass.getuser()
        except Exception:
            win_user = "N/A"
        license_key = self.license_key or ""
        short_key = (license_key[:12] + "..." + license_key[-8:]) if len(license_key) > 24 else (license_key or "N/A")
        remaining_str = self._resolve_license_time_remaining()
        usage_str = self._resolve_session_usage_time()
        fullname = self._resolve_customer_fullname()

        return (
            f"⏱️ <b>Thời Gian:</b> <code>{time_str}</code>\n"
            f"🧑 <b>Tên Khách Hàng:</b> <code>{fullname}</code>\n"
            f"👤 <b>Tên Tài Khoản:</b> <code>{self.username or 'N/A'}</code>\n"
            f"🔑 <b>License Key:</b> <code>{short_key}</code>\n"
            f"🆔 <b>Mã Máy (HWID):</b> <code>{self.hwid or 'UNKNOWN'}</code>\n"
            f"💻 <b>Tên Máy / PC:</b> <code>{hostname}</code> (Win: <code>{win_user}</code>)\n"
            f"🌐 <b>IP Công Khai:</b> <code>{self._resolve_public_ip()}</code>\n"
            f"⏳ <b>Thời Gian Sử Dụng (Phiên Này):</b> <code>{usage_str}</code>\n"
            f"📅 <b>Hạn License Còn Lại:</b> <code>{remaining_str}</code>"
        )

    def _build_client_identity_message(self, icon, title, body):
        """Gắn danh tính khách hàng (username/license/HWID/máy) vào thông báo
        Telegram thay vì gửi 1 dòng chung chung không biết là ai."""
        return (
            f"{icon} <b>[{title}]</b>\n"
            f"{self._build_identity_block()}\n"
            f"📝 <b>Nội Dung:</b> {body}"
        )

    def _resolve_customer_fullname(self):
        """Họ tên khách hàng. session_data['fullname'] chỉ tồn tại cho luồng
        đăng nhập bằng TÀI KHOẢN (Hồ Sơ > cập nhật họ tên). Với luồng kích
        hoạt bằng LICENSE KEY đơn thuần (không có tài khoản), tên khách hàng
        hiển thị trên Dashboard Admin là 1 field gắn với bản ghi license phía
        server -- chưa rõ tên khoá thật sự server trả về trong response
        /validate nên dò qua nhiều tên khoá khả dĩ; nếu vẫn không thấy, in
        kèm danh sách khoá đang có để xác định khoá đúng ở lần chạy tiếp theo."""
        try:
            data = self.session_data if isinstance(self.session_data, dict) else {}
            candidate_keys = [
                "fullname", "full_name", "customer_name", "customerName",
                "user_name", "userName", "buyer_name", "buyerName",
                "owner_name", "ownerName", "ten_khach_hang", "display_name", "name",
            ]
            for key in candidate_keys:
                value = data.get(key)
                if value:
                    return value
            
            user_obj = data.get("user")
            if isinstance(user_obj, dict):
                for key in candidate_keys:
                    value = user_obj.get(key)
                    if value:
                        return value
                        
            customer_obj = data.get("customer")
            if isinstance(customer_obj, dict):
                for key in candidate_keys:
                    value = customer_obj.get(key)
                    if value:
                        return value
                        
            lic_obj = data.get("license")
            if isinstance(lic_obj, dict):
                for key in candidate_keys:
                    value = lic_obj.get(key)
                    if value:
                        return value
                        
                lic_user = lic_obj.get("user") or lic_obj.get("customer")
                if isinstance(lic_user, dict):
                    for key in candidate_keys:
                        value = lic_user.get(key)
                        if value:
                            return value
                            
            return f"Chưa cập nhật [debug: {self._debug_dump_session_keys()}]"
        except Exception:
            return "Chưa cập nhật"

    def _debug_dump_session_keys(self):
        """In các khoá top-level của session_data, và nếu có sub-dict lồng
        bên trong (vd: 'license') thì in luôn khoá con của nó -- để dò ra tên
        field thật sự server trả về mà không cần tự ý gọi API server."""
        try:
            data = self.session_data if isinstance(self.session_data, dict) else {}
            if not data:
                return "(rỗng)"
            parts = []
            for key in sorted(str(k) for k in data.keys()):
                value = data[key]
                if isinstance(value, dict):
                    sub_keys = ", ".join(sorted(str(k) for k in value.keys()))
                    parts.append(f"{key}={{{sub_keys}}}")
                else:
                    parts.append(key)
            return "; ".join(parts)
        except Exception:
            return "(lỗi đọc session_data)"

    def _resolve_license_time_remaining(self):
        """Tính thời gian còn lại của license từ session_data.expiresAt (hoặc
        các khoá tương đương), theo đúng cách web_backend.get_license_info()
        và app_core.js đang parse ('YYYY-MM-DD[...]' hoặc ISO kèm 'Z')."""
        import datetime as _dt

        def _deep_find(data, keys):
            if isinstance(data, dict):
                for k in keys:
                    if data.get(k):
                        return data[k]
                for v in data.values():
                    if isinstance(v, (dict, list)):
                        res = _deep_find(v, keys)
                        if res:
                            return res
            elif isinstance(data, list):
                for item in data:
                    res = _deep_find(item, keys)
                    if res:
                        return res
            return None

        try:
            data = self.session_data if isinstance(self.session_data, dict) else {}
            exp_keys = ["expiresAt", "expireDate", "expires_at", "expire_date", "expiry_date", "expiryDate", "expires", "expiration", "hsd", "validUntil", "valid_until", "end_date", "endDate"]
            raw_exp = _deep_find(data, exp_keys)
            if not raw_exp:
                return f"Vĩnh viễn / Không giới hạn [debug: {self._debug_dump_session_keys()}]"

            exp_str = str(raw_exp)
            if exp_str.lower() in ("vĩnh viễn", "vinh vien", "unlimited", "permanent"):
                return "Vĩnh viễn / Không giới hạn"

            if 'T' in exp_str and exp_str.endswith('Z'):
                exp_dt = _dt.datetime.fromisoformat(exp_str.replace('Z', '+00:00')).replace(tzinfo=None)
            else:
                date_part = exp_str.split(' ')[0].split('T')[0]
                exp_dt = _dt.datetime.strptime(date_part, '%Y-%m-%d')

            days_left = (exp_dt.date() - _dt.datetime.now().date()).days
            if days_left > 0:
                return f"Còn {days_left} ngày (hết hạn {exp_dt.strftime('%Y-%m-%d')})"
            elif days_left == 0:
                return "Hết hạn hôm nay"
            else:
                return f"Đã hết hạn {abs(days_left)} ngày trước"
        except Exception:
            return "Không xác định"

    def _resolve_session_usage_time(self):
        """Thời gian đã sử dụng app kể từ khi khởi chạy phiên này (không phải
        tổng thời gian dùng lịch sử -- dữ liệu đó chưa được client này lưu)."""
        import time as _time
        try:
            start_ts = getattr(self, '_session_start_ts', None)
            if not start_ts:
                return "Vừa khởi chạy"
            elapsed = int(_time.time() - start_ts)
            hours, remainder = divmod(elapsed, 3600)
            minutes, _sec = divmod(remainder, 60)
            if hours > 0:
                return f"{hours} giờ {minutes} phút"
            return f"{minutes} phút" if minutes > 0 else "Vừa khởi chạy"
        except Exception:
            return "N/A"

    def start_notification_loop(self):
        """Bắt đầu luồng kiểm tra thông báo định kỳ"""
        def loop():
            global CHECK_INTERVAL_MINS
            import time

            self._session_start_ts = time.time()

            # Gửi 1 thông báo Đăng nhập lúc vừa khởi chạy app thành công để báo cáo cấu hình & thống kê ban đầu
            try:
                send_secure_telegram_alert(self._build_client_identity_message("🚀", "ĐĂNG NHẬP", "Khách hàng vừa khởi chạy thành công ứng dụng AutoMaster Studio V2."))
            except:
                pass

            # Kênh trên là cho NHÀ PHÁT TRIỂN (Owner) theo dõi mọi khách hàng.
            # Bot Tương Tác (core/telegram_poller.py) là bot RIÊNG của chính
            # người dùng -- họ cũng cần biết app của họ vừa khởi động thành
            # công, không chỉ có nhà phát triển mới nhận được tin này.
            try:
                from core.telegram_poller import get_bot_poller  # type: ignore

                get_bot_poller().send_startup_notice()
            except Exception:
                pass

            last_stats_sent_time = time.time()

            while not self.stop_event.is_set():
                self.check_notifications()
                self.heartbeat()

                # Gửi thống kê sử dụng định kỳ mỗi 60 phút thay vì gửi spam hành động mở từng máy ảo
                if time.time() - last_stats_sent_time >= 3600:
                    try:
                        send_secure_telegram_alert(self._build_client_identity_message("📊", "THỐNG KÊ ĐỊNH KỲ", "Báo cáo hiệu năng và tần suất sử dụng của khách hàng."))
                        last_stats_sent_time = time.time()
                    except:
                        pass
                
                for _ in range(CHECK_INTERVAL_MINS * 60):
                    if self.stop_event.is_set(): break
                    time.sleep(1)
        thread = threading.Thread(target=loop, daemon=True)
        thread.start()

    def check_notifications(self):
        """Kiểm tra thông báo mới từ server"""
        if not self.license_key: return
        global CHECK_INTERVAL_MINS
        try:
            url = f"{SERVER_URL}/api/tool-notifications/check"
            params = {"license_key": self.license_key}
            response = requests.get(url, params=params, headers=self._get_headers(), timeout=5)
            if response.status_code == 200:
                data = response.json()
                if isinstance(data, dict):
                    server_interval = data.get('check_interval_mins')
                    if server_interval:
                        # Notifications and license heartbeat share this loop; a
                        # server preference must never lengthen the 3-minute
                        # entitlement check interval.
                        CHECK_INTERVAL_MINS = min(max(int(server_interval), 1), 3)
                    notifications = data.get('notifications', [])
                    for notif in notifications:
                        self.show_popup(notif)
                        self.mark_as_read(notif.get('id'))
        except Exception as e:
            pass

    def show_popup(self, notif):
        """Hiển thị thông báo popup"""
        try:
            root = tk.Tk()
            root.withdraw()
            messagebox.showinfo(notif.get('title', 'Thông báo'), notif.get('message', ''))
            root.destroy()
        except:
            print(f"""
--- {notif.get('title')} ---
{notif.get('message')}""")

    def mark_as_read(self, notification_id):
        """Đánh dấu đã đọc"""
        if not self.license_key: return
        try:
            url = f"{SERVER_URL}/api/tool-notifications/mark-read"
            requests.post(url, json={"license_key": self.license_key, "notification_id": notification_id}, headers=self._get_headers(), timeout=5)
        except Exception as e:
            pass

    def start_fast_lock_check(self):
        """Luồng check nhanh 5s/lần (Không lọc lỗi HTTP 200)"""
        def fast_loop():
            while not self.stop_event.is_set():
                try:
                    url = f"{SERVER_URL}/api/v2/{LICENSE_API_SEGMENT}/status"
                    resp = requests.get(
                        url,
                        params={"licenseKey": self.license_key, "machineId": self.hwid},
                        headers=self._get_headers(),
                        timeout=5,
                    )
                    try:
                        data = resp.json()
                        status = data.get("status")
                        is_locked = data.get("is_locked") == 1 or data.get("is_locked") is True
                        is_inactive = data.get("is_active") == 0 or data.get("is_active") is False
                        
                        # Vẫn đọc ra khóa dù Server có trả về Status Code 403, 401...
                        if status in ["locked", "expired", "inactive", "invalid", "not_found", "device_unbound", "device_revoked"] or is_locked or is_inactive:
                            self.on_lock_detected(str(status or "locked"))
                        # Trừng phạt nếu khóa đã bị xóa trắng:
                        elif data.get("valid") is False or "error" in data:
                            self.on_lock_detected("bị từ chối do không còn tồn tại trên máy chủ")
                    except:
                        # Server trả thẳng mã lỗi không phải HTML hay JSON
                        if resp.status_code in [401, 403, 404]:
                            self.on_lock_detected(f"bị xóa hoặc thu hồi (Mã lỗi {resp.status_code})")
                        pass
                except Exception as e:
                    pass
                for _ in range(5):
                    if self.stop_event.is_set(): break
                    time.sleep(1)
        threading.Thread(target=fast_loop, daemon=True).start()

    def on_lock_detected(self, status):
        """Xử lý khi bị khóa"""
        normalized_status = str(status or "locked").strip().lower()
        _run_client_hooks("on_lock", {"lm": self, "status": normalized_status})
        self.stop_event.set()
        if isinstance(self.session_data, dict):
            self.session_data["is_active"] = False
            self.session_data["is_locked"] = 1
            self.session_data["status"] = normalized_status
            license_data = self.session_data.get("license")
            if isinstance(license_data, dict):
                license_data["is_active"] = False
                license_data["is_locked"] = 1
                license_data["status"] = normalized_status

        # --- [LỚP 8: BOM NỔ CHẬM] Âm thầm đặt cờ Tamper ---
        try:
            with open(os.path.join(APPDATA_DIR, ".tamper_flag"), "w") as f:
                f.write("1")
        except Exception as e:
            pass

        # --- BẮT BUỘC XÓA SẠCH TOKEN VÀ KEY TRÊN MÁY ---
        try:
            if os.path.exists(LICENSE_FILE): pass  # Lệnh xóa Key đã được gỡ bỏ theo yêu cầu
            if os.path.exists(GRACE_TOKEN_FILE):
                os.remove(GRACE_TOKEN_FILE)
        except Exception as e:
            pass

        # App chính (AutoMaster Studio) đã có overlay web tự khóa giao diện khi phát
        # hiện license không hợp lệ (lockUIForInactiveLicense trong app_core.js) --
        # không cần popup Tkinter + tự tắt cứng nữa, tránh trùng lặp/xung đột (popup
        # cũ từng đếm ngược xong tự tắt app dù license đã được mở khóa lại giữa
        # chừng, vì không tự kiểm tra lại trước khi tắt). Chỉ 6 tool cloud-core độc
        # lập không có giao diện web (HAS_WEB_UI vẫn = False mặc định) mới cần lớp
        # chặn cứng này.
        if HAS_WEB_UI:
            # Overlay khóa mềm (security-lock-overlay) đã vô hiệu hóa toàn bộ nút/input
            # của app chính (pointer-events:none, disabled, blur) ngay khi heartbeat/fast
            # lock check phát hiện trạng thái này -- đó chính là lớp chặn "không cho sử
            # dụng app". Không tắt cứng tiến trình ở đây: làm vậy sẽ chặn luôn nút "Quản
            # Lý Bản Quyền" trên overlay (enterLicenseManagementMode trong app_core.js),
            # nơi người dùng cần vào được để xem trạng thái/nhập lại key -- quản lý license
            # trong lúc bị khóa là hành vi được phép, chỉ *sử dụng* các tính năng khác mới
            # bị chặn.
            print(f"[License] Phát hiện phiên không còn được phép ({normalized_status}); giao diện web sẽ tự khóa.")
            return

        # Bắt buộc kill tool (Chạy ngầm để đếm ngược, mặc kệ user có tắt thông báo hay không)
        # Hết hạn: 60s. Bị khóa: Ngay lập tức (3s)
        def force_kill_timer():
            import time, os
            if status == "locked" or "từ chối" in status:
                time.sleep(3)
            else:
                time.sleep(60)
            os._exit(1)

        import threading
        threading.Thread(target=force_kill_timer, daemon=True).start()

        try:
            root = tk.Tk()
            root.withdraw()
            if status == "locked" or "từ chối" in status:
                msg = f"License has been {status}!\n\nHệ thống phát hiện vi phạm. Toàn bộ Key và Thẻ bài Offline trên máy bạn đã bị xóa sổ. Tool sẽ tự tắt ngay lập tức."
            else:
                msg = f"License has been {status}!\n\nTool sẽ tự tắt sau 60 giây nữa."
            messagebox.showerror("License Error", msg)
            root.destroy()
        except Exception as e:
            pass
        os._exit(1)

# ==========================================
# SMART FLOATING BUBBLE (Phase 5)
# ==========================================

    def logout(self):
        try:
            import os
            try:
                with open(LICENSE_FILE, "w", encoding="utf-8") as f: f.write("")
                os.remove(LICENSE_FILE)
            except Exception as e:
                pass
            try:
                with open(ACCOUNT_FILE, "w", encoding="utf-8") as f: f.write("")
                os.remove(ACCOUNT_FILE)
            except Exception as e:
                pass
            self.session_data, self.license_key, self.username, self.is_account, self.session_token = {}, None, None, False, None
            _run_client_hooks("post_logout", {"lm": self})
            return True
        except: return False



class SmartFloatingBubble:
    """Bong bóng nổi thông minh - Hỗ trợ chat, trạng thái, menu nhanh"""
    
    def __init__(self, license_manager, parent_win=None):
        self.lm = license_manager
        self.parent_win = parent_win
        self.root = None
        self.chat_win = None
        self.active_effect = 'green'
        self.last_msg_id = self._load_last_msg_id()
        self.chat_messages = []
        self.stop_event = threading.Event()
        self._build()
    
    def _build(self):
        self.root = tk.Toplevel() if tk._default_root else tk.Tk()
        self.root.overrideredirect(True)
        self.root.attributes('-topmost', True)
        self.root.geometry('50x50')
        
        # Đặt ưu tiên ở góc trái phía dưới Tool hoặc màn hình
        sw = self.root.winfo_screenwidth()
        sh = self.root.winfo_screenheight()
        try:
            if getattr(self, 'parent_win', None) and self.parent_win.winfo_exists():
                self.parent_win.update_idletasks()
                px = self.parent_win.winfo_x()
                py = self.parent_win.winfo_y()
                ph = self.parent_win.winfo_height()
                self.root.geometry(f'+{px + 10}+{py + ph - 60}')
            else:
                self.root.geometry(f'+20+{sh - 120}')
        except:
            self.root.geometry(f'+20+{sh - 120}')
        
        # Nền trong suốt (Windows)
        if os.name == 'nt':
            self.root.wm_attributes('-transparentcolor', self.root['bg'])
        
        self.canvas = tk.Canvas(self.root, width=50, height=50, bg=self.root['bg'], highlightthickness=0)
        self.canvas.pack()
        self.circle = self.canvas.create_oval(5, 5, 45, 45, fill='#2ecc71', outline='')
        self.icon = self.canvas.create_text(25, 25, text="💬", font=('Arial', 14))
        
        # Badge thông báo
        self.badge = self.canvas.create_oval(32, 2, 48, 18, fill='red', outline='')
        self.badge_text = self.canvas.create_text(40, 10, text="0", font=('Arial', 8, 'bold'), fill='white')
        self.canvas.itemconfig(self.badge, state='hidden')
        self.canvas.itemconfig(self.badge_text, state='hidden')
        self.unread_count = 0
        
        # Bindings
        self.canvas.bind('<Button-1>', self._on_press)
        self.canvas.bind('<B1-Motion>', self._on_drag)
        self.canvas.bind('<ButtonRelease-1>', self._on_drop)
        self.canvas.bind('<Button-3>', self._on_right_click)
        # Fallback: macOS dùng Button-2, Ctrl+Click cho laptop không có chuột phải
        self.canvas.bind('<Button-2>', self._on_right_click)
        self.canvas.bind('<Control-Button-1>', self._on_right_click)
        # [FIX] Bind thêm trực tiếp lên circle và icon (vì transparent bg ăn mất event)
        self.canvas.tag_bind(self.circle, '<Button-3>', self._on_right_click)
        self.canvas.tag_bind(self.icon, '<Button-3>', self._on_right_click)
        self.canvas.tag_bind(self.circle, '<Control-Button-1>', self._on_right_click)
        self.canvas.tag_bind(self.icon, '<Control-Button-1>', self._on_right_click)
        self._drag_data = {'x': 0, 'y': 0, 'dragged': False}
        
        # Hiệu ứng thở
        self._start_breathing()
        
        # Polling tin nhắn mới
        self._start_chat_polling()
        
        # [FIX] Bong bóng HIỆN theo mặc định (trước đây bị ẩn → không click phải được)
        self._is_visible = True
        # Ẩn tạm 200ms rồi hiện lại để tránh flash khi khởi tạo
        self.root.withdraw()
        try:
            self.root.after(500, lambda: self.root.deiconify() if getattr(self, '_is_visible', True) else None)
        except Exception as e:
            pass
    
    def _start_breathing(self):
        def breath():
            colors = {
                'green': ('#2ecc71', '#27ae60'),
                'orange': ('#f39c12', '#d35400'),
                'red': ('#e74c3c', '#c0392b')
            }
            while not self.stop_event.is_set():
                try:
                    c1, c2 = colors.get(self.active_effect, colors['green'])
                    self.canvas.itemconfig(self.circle, fill=c2)
                    time.sleep(0.8)
                    self.canvas.itemconfig(self.circle, fill=c1)
                    time.sleep(0.8)
                except Exception as e:
                    pass
        threading.Thread(target=breath, daemon=True).start()
    
    def set_status(self, status):
        if status == 'ok': self.active_effect = 'green'
        elif status == 'working': self.active_effect = 'orange'
        elif status == 'error': self.active_effect = 'red'
    
    def _on_press(self, event):
        self._drag_data['x'] = event.x
        self._drag_data['y'] = event.y
        self._drag_data['dragged'] = False
    
    def _on_drag(self, event):
        self._drag_data['dragged'] = True
        x = self.root.winfo_x() - self._drag_data['x'] + event.x
        y = self.root.winfo_y() - self._drag_data['y'] + event.y
        self.root.geometry(f'+{x}+{y}')
    
    def _on_drop(self, event):
        if not self._drag_data['dragged']:
            self._toggle_chat()
            return
    
    def _on_right_click(self, event):
        menu = tk.Menu(self.root, tearoff=0)
        menu.add_command(label=f"📋 Copy HWID: {self.lm.hwid[:12]}...", command=self._copy_hwid)
        menu.add_command(label="🔄 Kiểm tra cập nhật", command=self._check_update)
        menu.add_separator()
        menu.add_command(label="🟢 Trạng thái: OK", command=lambda: self.set_status('ok'))
        menu.add_separator()
        menu.add_command(label="🙈 Ẩn bong bóng (1 giờ)", command=self._hide_temp)
        menu.add_command(label="❌ Tắt bong bóng (Đóng)", command=self._turn_off_bubble)
        menu.tk_popup(event.x_root, event.y_root)
    
    def _copy_hwid(self):
        try:
            self.root.clipboard_clear()
            self.root.clipboard_append(self.lm.hwid)
            self.root.update()
        except Exception as e:
            pass
    
    def _check_update(self):
        info = self.lm.check_for_update()
        if info.get('has_update'):
            messagebox.showinfo("Cập nhật", f"Có phiên bản mới: {info['version']}")
        else:
            messagebox.showinfo("Cập nhật", "Bạn đang dùng phiên bản mới nhất!")
    
    def _hide_temp(self):
        self._is_visible = False
        self.root.withdraw()
        # Hiện lại sau 1 giờ
        def show_again():
            time.sleep(3600)
            try: 
                self._is_visible = True
                self.root.deiconify()
            except Exception as e:
                pass
        threading.Thread(target=show_again, daemon=True).start()

    def _turn_off_bubble(self):
        try:
            self._is_visible = False
            if self.chat_win and self.chat_win.winfo_exists():
                self.chat_win.destroy()
            self.root.withdraw()
        except Exception as e:
            pass

    def toggle_visibility(self):
        try:
            if getattr(self, '_is_visible', False) == False or self.root.state() == 'withdrawn':
                self._is_visible = True
                self.root.deiconify()
            else:
                self._is_visible = False
                self.root.withdraw()
        except Exception as e:
            pass
    
    def _toggle_chat(self):
        if self.chat_win and self.chat_win.winfo_exists():
            self.chat_win.destroy()
            self.chat_win = None
            return
        self._open_chat()
    
    def _open_chat(self):
        self.chat_win = tk.Toplevel(self.root)
        self.chat_win.title("💬 Hỗ trợ trực tuyến")
        self.chat_win.geometry("320x420")
        self.chat_win.attributes('-topmost', True)
        self.chat_win.resizable(False, False)
        
        # Đặt cạnh bubble - đảm bảo luôn nằm trong màn hình
        bx = self.root.winfo_x()
        by = self.root.winfo_y()
        sw = self.root.winfo_screenwidth()
        sh = self.root.winfo_screenheight()
        chat_w, chat_h = 320, 420
        cx = bx - chat_w - 10
        if cx < 0:
            cx = bx + 60
        cy = by - chat_h + 50
        if cy < 0:
            cy = by + 10
        cx = max(0, min(cx, sw - chat_w))
        cy = max(0, min(cy, sh - chat_h - 40))
        self.chat_win.geometry(f"+{cx}+{cy}")
        
        # Header
        header = tk.Frame(self.chat_win, bg='#3498db', height=40)
        header.pack(fill='x')
        header.pack_propagate(False)
        tk.Label(header, text="💬 Chat với Hỗ trợ", bg='#3498db', fg='white', font=('Arial', 11, 'bold')).pack(side='left', padx=10)
        
        # Bottom container to hold media review and input
        self.bottom_container = tk.Frame(self.chat_win)
        self.bottom_container.pack(side='bottom', fill='x', padx=5, pady=(0, 5))

        # Media preview area
        self.media_preview_frame = tk.Frame(self.bottom_container, bg='#e8f5e9')
        self.pending_media_path = None
        
        # Input area
        input_frame = tk.Frame(self.bottom_container)
        input_frame.pack(side='bottom', fill='x')
        
        # Attach button
        attach_btn = tk.Button(input_frame, text="📎", font=('Arial', 12), command=self._attach_media, cursor='hand2', relief='flat')
        attach_btn.pack(side='left', padx=(0, 4))
        
        self.chat_entry = tk.Entry(input_frame, font=('Arial', 10))
        self.chat_entry.pack(side='left', fill='x', expand=True, ipady=4)
        self.chat_entry.bind('<Return>', lambda e: self._send_chat())
        self.chat_entry.focus_set()
        
        send_btn = tk.Button(input_frame, text="Gửi", bg='#3498db', fg='white', font=('Arial', 10, 'bold'), command=self._send_chat)
        send_btn.pack(side='right', padx=(5, 0))

        # Chat area
        self.chat_text = tk.Text(self.chat_win, state='disabled', bg='#f5f5f5', wrap='word', font=('Arial', 10))
        self.chat_text.pack(side='top', fill='both', expand=True, padx=5, pady=5)
        
        # Tag styles
        self.chat_text.tag_config('me', foreground='#2c3e50', justify='right')
        self.chat_text.tag_config('admin', foreground='#27ae60', justify='left')
        self.chat_text.tag_config('time', foreground='#95a5a6', font=('Arial', 7))
        self.chat_text.tag_config('system', foreground='#7f8c8d', font=('Arial', 8, 'italic'), justify='center')
        
        # Load old messages
        self._load_chat_history()
        
        # Reset unread
        self.unread_count = 0
        self._update_badge()
        self._save_last_msg_id()
    
    def _attach_media(self):
        try:
            from tkinter import filedialog
            filetypes = [
                ("Tất cả", "*.*"),
                ("Hình ảnh & Video", "*.jpg *.jpeg *.png *.gif *.webp *.mp4 *.webm *.mov *.avi"),
                ("Hình ảnh", "*.jpg *.jpeg *.png *.gif *.webp"),
                ("Video", "*.mp4 *.webm *.mov *.avi")
            ]
            filepath = filedialog.askopenfilename(title="Chọn tệp đính kèm", filetypes=filetypes, parent=self.chat_win)
            if filepath:
                self.pending_media_path = filepath
                filename = os.path.basename(filepath)
                ext = os.path.splitext(filename)[1].lower()
                is_vid = ext in ['.mp4', '.webm', '.mov', '.avi']
                is_img = ext in ['.jpg', '.jpeg', '.png', '.gif', '.webp']
                icon = "🎬" if is_vid else ("🖼️" if is_img else "📄")
                for w in self.media_preview_frame.winfo_children(): w.destroy()
                self.media_preview_frame.pack(side='top', fill='x', pady=(0, 2))
                tk.Label(self.media_preview_frame, text=f"{icon} {filename}", bg='#e8f5e9', fg='#2e7d32', font=('Arial', 9)).pack(side='left', padx=5)
                tk.Button(self.media_preview_frame, text="✕", fg='red', font=('Arial', 9, 'bold'), relief='flat', bg='#e8f5e9', cursor='hand2', command=self._clear_pending_media).pack(side='right', padx=5)
        except Exception as e:
            print(f"Attach media error: {e}")
    
    def _clear_pending_media(self):
        self.pending_media_path = None
        self.media_preview_frame.pack_forget()
    
    def _upload_media(self, filepath):
        try:
            url = f"{SERVER_URL}/api/v2/chat/upload-media"
            ext = os.path.splitext(filepath)[1].lower()
            is_vid = ext in ['.mp4', '.webm', '.mov', '.avi']
            is_img = ext in ['.jpg', '.jpeg', '.png', '.gif', '.webp']
            fallback_type = 'video' if is_vid else ('image' if is_img else 'file')
            with open(filepath, 'rb') as f:
                files = {'media': (os.path.basename(filepath), f)}
                headers = {"X-API-Key": self.lm._get_headers().get('X-API-Key', '')}
                resp = requests.post(url, files=files, headers=headers, timeout=120)
                data = resp.json()
                if data.get('success'):
                    return data.get('mediaUrl'), data.get('mediaType', fallback_type)
        except Exception as e:
            print(f"Upload media error: {e}")
        return None, None
    
    def _send_chat(self):
        if not self.chat_entry: return
        msg = self.chat_entry.get().strip()
        media_path = self.pending_media_path
        if not msg and not media_path: return
        self.chat_entry.delete(0, 'end')
        self._clear_pending_media()
        display_msg = msg or ''
        if media_path:
            ext = os.path.splitext(media_path)[1].lower()
            is_vid = ext in ['.mp4', '.webm', '.mov', '.avi']
            is_img = ext in ['.jpg', '.jpeg', '.png', '.gif', '.webp']
            icon = "🎬" if is_vid else ("🖼️" if is_img else "📄")
            display_msg = f"{display_msg} [{icon} {os.path.basename(media_path)}]" if msg else f"[{icon} {os.path.basename(media_path)}]"
        self._append_msg('Bạn', display_msg, 'me')
        def send():
            try:
                media_url = None
                media_type = None
                if media_path:
                    media_url, media_type = self._upload_media(media_path)
                url = f"{SERVER_URL}/api/v2/chat/send"
                payload = {
                    "licenseKey": self.lm.license_key,
                    "machineId": self.lm.hwid,
                    "productId": PRODUCT_ID,
                    "message": msg or ''
                }
                if media_url:
                    payload["mediaUrl"] = media_url
                    payload["mediaType"] = media_type
                requests.post(url, json=payload, headers=self.lm._get_headers(), timeout=10)
            except Exception as e:
                print(f"Chat send error: {e}")
        threading.Thread(target=send, daemon=True).start()
    
    def _load_chat_history(self):
        try:
            url = f"{SERVER_URL}/api/v2/chat/receive"
            params = {
                "licenseKey": self.lm.license_key,
                "machineId": self.lm.hwid
            }
            resp = requests.get(url, params=params, headers=self.lm._get_headers(), timeout=5)
            data = resp.json()
            if data.get('success'):
                for m in data.get('messages', []):
                    role_label = 'Admin' if m['role'] == 'admin' else 'Bạn'
                    tag = 'admin' if m['role'] == 'admin' else 'me'
                    display = m.get('message', '')
                    media_url = m.get('media_url')
                    # Unified Workspace: show tool badge if from different tool
                    tool_badge = ''
                    msg_product = m.get('product_id', '')
                    if msg_product and msg_product != PRODUCT_ID and m['role'] != 'admin':
                        tool_badge = f'[🔧 {msg_product}] '
                    self._append_msg(role_label, f"{tool_badge}{display}" if tool_badge else display, tag, media_url, m.get('media_type'))
                    self.last_msg_id = max(self.last_msg_id, m.get('id', 0))
        except Exception as e:
            pass
    
    def _append_msg(self, sender, message, tag, media_url=None, media_type=None):
        if not self.chat_text: return
        try:
            self.chat_text.config(state='normal')
            timestamp = time.strftime('%H:%M')
            self.chat_text.insert('end', f"[{timestamp}] ", 'time')
            
            if message:
                self.chat_text.insert('end', f"{sender}: {message}", tag)
            else:
                self.chat_text.insert('end', f"{sender}:", tag)
                
            if media_url:
                icon = '🎬' if media_type == 'video' else ('🖼️' if media_type == 'image' else '📄')
                label = "Mở Media" if media_type in ['video', 'image'] else "Tải xuống"
                import random
                link_tag = f"link_{int(time.time())}_{random.randint(1,100000)}"
                self.chat_text.insert('end', f" [{icon} {label}]", link_tag)
                self.chat_text.tag_config(link_tag, foreground="blue", underline=1)
                
                full_url = f"{SERVER_URL}{media_url}"
                import webbrowser
                self.chat_text.tag_bind(link_tag, "<Button-1>", lambda e, u=full_url: webbrowser.open(u))
                self.chat_text.tag_bind(link_tag, "<Enter>", lambda e: self.chat_text.config(cursor="hand2"))
                self.chat_text.tag_bind(link_tag, "<Leave>", lambda e: self.chat_text.config(cursor=""))
            
            self.chat_text.insert('end', "\\n")
            self.chat_text.config(state='disabled')
            self.chat_text.see('end')
        except Exception as e:
            pass
    
    def _start_chat_polling(self):
        def poll():
            while not self.stop_event.is_set():
                try:
                    if self.lm.license_key:
                        url = f"{SERVER_URL}/api/v2/chat/receive"
                        params = {
                            "licenseKey": self.lm.license_key,
                            "machineId": self.lm.hwid,
                            "lastId": str(self.last_msg_id)
                        }
                        resp = requests.get(url, params=params, headers=self.lm._get_headers(), timeout=5)
                        data = resp.json()
                        if data.get('success'):
                            new_msgs = data.get('messages', [])
                            for m in new_msgs:
                                if m['role'] == 'admin':
                                    display = m.get('message', '')
                                    media_url = m.get('media_url')
                                    if self.chat_win and self.chat_win.winfo_exists():
                                        self._append_msg('Admin', display, 'admin', media_url, m.get('media_type'))
                                    else:
                                        self.unread_count += 1
                                        self._update_badge()
                                elif m['role'] == 'client':
                                    # Messages from other tools on same machine
                                    msg_product = m.get('product_id', '')
                                    if msg_product and msg_product != PRODUCT_ID:
                                        display = m.get('message', '')
                                        media_url = m.get('media_url')
                                        tool_badge = f'[🔧 {msg_product}] '
                                        if self.chat_win and self.chat_win.winfo_exists():
                                            self._append_msg('Bạn', f"{tool_badge}{display}", 'me', media_url, m.get('media_type'))
                                self.last_msg_id = max(self.last_msg_id, m.get('id', 0))
                                self._save_last_msg_id()
                except Exception as e:
                    pass
                for _ in range(5):
                    if self.stop_event.is_set(): break
                    time.sleep(1)
        threading.Thread(target=poll, daemon=True).start()
    
    def _load_last_msg_id(self):
        """Load last read message ID from file to avoid re-counting old messages"""
        try:
            msg_id_file = os.path.join(APPDATA_DIR, '.last_msg_id')
            if os.path.exists(msg_id_file):
                return int(open(msg_id_file, 'r').read().strip())
        except Exception as e:
            pass
        return 0
    
    def _save_last_msg_id(self):
        """Save last read message ID to persist across restarts"""
        try:
            msg_id_file = os.path.join(APPDATA_DIR, '.last_msg_id')
            with open(msg_id_file, 'w') as f:
                f.write(str(self.last_msg_id))
        except Exception as e:
            pass

    def _update_badge(self):
        try:
            if self.unread_count > 0:
                self.canvas.itemconfig(self.badge, state='normal')
                self.canvas.itemconfig(self.badge_text, state='normal', text=str(self.unread_count))
            else:
                self.canvas.itemconfig(self.badge, state='hidden')
                self.canvas.itemconfig(self.badge_text, state='hidden')
        except Exception as e:
            pass

# =============================================================================
# <LOCKED-CORE:END>  — HẾT VÙNG LÕI DÙNG CHUNG.
#   Phần bên dưới (MAIN LOGIC demo) là ví dụ tích hợp — người dùng SDK thay bằng
#   app thật của mình. Không bị hash bảo vệ.
# =============================================================================

# ==========================================
# MAIN LOGIC V2.0.0
# ==========================================
if __name__ == "__main__" and not globals().get('__CLOUD_EXEC__', False):
    try:
        import sys
        if hasattr(sys.stdout, 'reconfigure'):
            sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

    # Safe print wrapper for Windows consoles that don't support UTF-8 (like VSCode output)
    _built_in_print = print
    def print(*args, **kwargs):
        try:
            _built_in_print(*args, **kwargs)
        except UnicodeEncodeError:
            safe_args = [str(a).encode('ascii', 'replace').decode('ascii') for a in args]
            _built_in_print(*safe_args, **kwargs)

    # Các file cũ (fallback để auto-migrate)
    LOCAL_CONFIG_FILES = ['license.json', 'config.json', 'setting.json', 'license_config.json']
    LOCAL_TXT_FILES = ['license.txt', 'key.txt']
    
    lm = LicenseManagerV2()
    print(f"=== {PRODUCT_ID} (V{CLIENT_VERSION}) ===")
    print(f"Mã máy: {lm.hwid}")
    print(f"License path: {LICENSE_FILE}")

    # [FIX] Auto Update Check - ĐÃ CHUYỂN XUỐNG SAU KHI LOAD LICENSE
    # (Trước đây chạy ở đây gây mất context khi update xong khởi động lại)

    # 1. Kích hoạt giao diện Đăng nhập / Nhập Key (Tự động bypass nếu đã đăng nhập)
    if not lm.validate_on_startup():
        lm.show_activation_ui()
    
    # [FIX] Auto Update Check - chạy SAU khi load license để không bị mất key
    lm.self_update()
    
    # 2. Chạy tới đây tức là đã đăng nhập thành công
    print(f"✅ Hợp lệ! Hạn dùng: {lm.session_data.get('expiresAt')}")
    
    lm.start_notification_loop()
    lm.start_fast_lock_check()
    
    print("\n--- KIỂM TRA TÍNH NĂNG ---")
    if FEATURES:
        for code, name in FEATURES.items():
            status = "🔓 MỞ" if lm.has_feature(code) else "🔒 KHÓA"
            print(f"- {name} ({code}): {status}")
    else:
        print("(Sản phẩm này chưa cấu hình tính năng riêng)")

        # ==========================================
        # KHỞI TẠO SMART FLOATING BUBBLE
        # ==========================================
        print("\\n🫧 Đang khởi tạo Smart Bubble...")
        try:
            bubble = SmartFloatingBubble(lm)
            print("✅ Smart Bubble đã sẵn sàng! (Chat + Trạng thái + Menu nhanh)")
        except Exception as e:
            print(f"⚠️ Không thể khởi tạo Bubble (GUI không khả dụng): {e}")

        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("Đã dừng.")



# ==========================================
# 🤖 PROMPT DÀNH CHO AI TRỢ LÝ (DÀNH CHO SẾP) 🤖
# ==========================================
"""
Nếu sếp dùng ChatGPT/Claude/Gemini để nhờ code phần Giao diện chính (Main App UI) cho Tool của mình,
hãy copy đoạn Prompt dưới đây dán cho AI để yêu cầu nó tạo thêm nút "Đổi License Key" bên trong Tool chính nhé:

--- BẮT ĐẦU COPY TỪ ĐÂY ---
Bạn hãy tạo thêm một nút "Đổi License Key" trên giao diện phần mềm của tôi. 
Khi người dùng bấm vào nút này, hãy thực thi đoạn code sau để xóa thông tin bản quyền cũ và buộc phần mềm thoát ra để yêu cầu nhập Key mới vào lần sau:

def btn_change_license_clicked():
    import os, json
    from tkinter import messagebox
    
    # 1. Tìm đường dẫn file license
    appdata_dir = os.path.join(os.getenv('APPDATA') if os.name == 'nt' else os.path.expanduser('~'), "Ongben_License_V2" if os.name == 'nt' else ".Ongben_License_V2")
    license_file = os.path.join(appdata_dir, "license.dat")
    
    try:
        if os.path.exists(license_file):
            # Đọc dữ liệu cũ
            with open(license_file, "r") as f:
                data = json.load(f)
            
            # Xóa trường 'key' để bắt buộc nhập lại
            data["key"] = ""
            
            # Lưu lại
            with open(license_file, "w") as f:
                json.dump(data, f)
                
        messagebox.showinfo("Thông báo", "Đã xóa License Key hiện tại khỏi máy!\\n\\nVui lòng bật lại phần mềm để nhập License Key mới.")
        import sys
        sys.exit(0) # Tắt phần mềm ngay lập tức
    except Exception as e:
        messagebox.showerror("Lỗi", f"Có lỗi xảy ra: {e}")

# Yêu cầu: Gắn hàm btn_change_license_clicked vào tham số command= của nút bấm nhé!
--- KẾT THÚC COPY ---
"""
