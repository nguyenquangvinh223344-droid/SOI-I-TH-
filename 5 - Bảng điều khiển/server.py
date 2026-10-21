# -*- coding: utf-8 -*-
"""
CHƯƠNG TRÌNH CHẠY NGẦM CỦA BẢNG ĐIỀU KHIỂN (dây chuyền tự động làm video)

- Quản lý thư mục THẬT "KHO ẢNH SẢN PHẨM" trên laptop. Bảng điều khiển (trang web) chỉ là cửa sổ nhìn vào đây:
  tạo thư mục, chuyển, đổi tên, thêm ảnh... đều làm THẬT trên ổ cứng; làm trong File Explorer thì bảng điều khiển thấy ngay.
- Quy ước: thư mục có file "_sp.json" là MỘT SẢN PHẨM (chứa các ảnh cùng một mã). Thư mục không có file đó là THƯ MỤC PHÂN LOẠI.
  Ảnh thả thẳng vào thư mục phân loại là "ảnh lẻ" (chưa thuộc sản phẩm nào).
- Xóa = chuyển vào "_THÙNG RÁC" (không xóa vĩnh viễn).
- Không cần cài thêm gì (chỉ dùng Python có sẵn; nếu máy có thư viện Pillow thì ảnh xem trước nhỏ gọn hơn).
- Chạy: double-click chay_bang_dieu_khien.bat. Mở địa chỉ in ra trong cửa sổ (kèm mật khẩu ?key=…).
"""
import hashlib
import io
import json
import mimetypes
import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time
import uuid
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse

HERE = Path(__file__).resolve().parent
CFG = {}
try:
    CFG = json.loads((HERE / "cau_hinh.json").read_text(encoding="utf-8"))
except Exception:
    pass
ROOT = Path(os.environ.get("KHO_DIR") or CFG.get("kho") or (HERE.parent / "KHO ẢNH SẢN PHẨM")).resolve()
PORT = int(os.environ.get("PORT") or CFG.get("port") or 8800)
IMG_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}
VID_EXT = {".mp4", ".mov", ".webm", ".m4v"}
MC_URL = (CFG.get("motion_url") or "http://127.0.0.1:8765").rstrip("/")  # chương trình Motion Control (để hỏi giá ước tính)
TRASH = "_THÙNG RÁC"
THUMBS = "_thumbs"

# Cấu trúc thư mục (2026-10-16). Mọi file của chương trình nằm gọn trong "_HE_THONG" (ẩn).
SYSD = "_HE_THONG"
D_SP = "1 - ẢNH SẢN PHẨM"
D_CAN = D_SP + "/1 - ẢNH SẢN PHẨM CẦN SẾP XỬ LÍ"
D_DONE = D_SP + "/2 - ĐÃ XỬ LÍ RỒI SẾP EI!!"
D_OUT = "2 - ĐÃ PHỐI ĐỒ XONG"
# 2 đường song song: ảnh 1 người ("1 MODEL") và ảnh 2 người ("2 MODEL"), mỗi đường có đủ 3 thư mục
N_NEW, N_VID, N_USED = "1 - MỚI PHỐI LUÔN SẾP!!", "2 - CHỜ LÀM VIDEO NÈ SẾP", "3 - ĐÃ LÀM VIDEO RỒI SẾP"
D_OUT1 = D_OUT + "/1 MODEL"
D_OUT2 = D_OUT + "/2 MODEL"
D_NEW1, D_VID1, D_USED1 = D_OUT1 + "/" + N_NEW, D_OUT1 + "/" + N_VID, D_OUT1 + "/" + N_USED
D_NEW2, D_VID2, D_USED2 = D_OUT2 + "/" + N_NEW, D_OUT2 + "/" + N_VID, D_OUT2 + "/" + N_USED
D_NEW, D_VID, D_USED = D_NEW1, D_VID1, D_USED1  # tên cũ = đường 1 người (để các chỗ cũ và tên đường dẫn cũ vẫn hiểu)
LANES = {"1": (D_NEW1, D_VID1, D_USED1), "2": (D_NEW2, D_VID2, D_USED2)}
D_MODEL = "3 - KHO MODEL"
D_MPICK = D_MODEL + "/1 - LẤY MODEL NÀY"
D_MPICK1 = D_MPICK + "/1 MODEL"  # ảnh model 1 người (kéo thẳng ảnh vào đây)
D_MPICK2 = D_MPICK + "/2 MODEL"  # ảnh model 2 người
D_MALL = D_MODEL + "/2 - TOÀN BỘ ẢNH MODEL"
D_SHARP = D_MODEL + "/3 - ẢNH ĐÃ LÀM NÉT"       # làm nét ảnh bằng RunningHub
D_SHARP_OLD = D_SHARP + "/OLD"  # ảnh gốc sếp tải lên, chờ làm nét
D_SHARP_NEW = D_SHARP + "/NEW"  # ảnh đã làm nét, để so sánh


def lane_of(v):
    return "2" if str(v).strip() in ("2", "2p", "2P") else "1"
# tên cũ (bản trước khi đánh số) vẫn được hiểu để tiện ích / hàng phối cũ không hỏng
LEGACY = [("ẢNH SẢN PHẨM/ẢNH SẢN PHẨM CẦN SẾP XỬ LÍ", D_CAN), ("ẢNH SẢN PHẨM/ĐÃ XỬ LÍ RỒI SẾP EI!!", D_DONE),
          ("ĐÃ PHỐI ĐỒ XONG/MỚI PHỐI LUÔN SẾP!!", D_NEW), ("ĐÃ PHỐI ĐỒ XONG/CHỜ LÀM VIDEO NÈ SẾP", D_VID),
          ("ĐÃ PHỐI ĐỒ XONG/ĐÃ LÀM VIDEO RỒI SẾP", D_USED), ("KHO MODEL/LẤY MODEL NÀY", D_MPICK),
          ("KHO MODEL/TOÀN BỘ ẢNH MODEL", D_MALL), ("CHỜ XỬ LÝ", D_CAN),
          ("ẢNH SẢN PHẨM", D_SP), ("ĐÃ PHỐI ĐỒ XONG", D_OUT), ("KHO MODEL", D_MODEL),
          # bố cục ngày 16/10 (3 thư mục nằm thẳng trong ĐÃ PHỐI ĐỒ XONG) -> đường 1 MODEL
          (D_OUT + "/" + N_NEW, D_NEW1), (D_OUT + "/" + N_VID, D_VID1), (D_OUT + "/" + N_USED, D_USED1)]
D_VMAU = "4 - KHO VIDEO MẪU"
D_VMAU1 = D_VMAU + "/1 - VIDEO MẪU"  # video nhảy sếp ưng, tải từ tiện ích về (tab VIDEO chọn từ đây)
D_VMAU2 = D_VMAU + "/2 - VIDEO MOTION CONTROL ĐÃ XONG"  # video kết quả Motion Control (tab KẾT QUẢ VIDEO xem ở đây)
D_POSTED = D_VMAU + "/3 - ĐÃ ĐĂNG"  # video đã đăng (bấm "Đã đăng" ở tab KẾT QUẢ thì video từ D_VMAU2 sang đây)
LAYOUT = [D_SP, D_CAN, D_DONE, D_OUT, D_OUT1, D_OUT2, D_NEW1, D_VID1, D_USED1, D_NEW2, D_VID2, D_USED2, D_MODEL, D_MPICK, D_MPICK1, D_MPICK2, D_MALL, D_SHARP, D_SHARP_OLD, D_SHARP_NEW, D_VMAU, D_VMAU1, D_VMAU2, D_POSTED]
OLD_CAN = "CHỜ XỬ LÝ"  # tên cũ, vẫn hiểu để tiện ích cũ không hỏng

ROOT.mkdir(parents=True, exist_ok=True)
SYSP = ROOT / SYSD
APP_URL = CFG.get("app_url") or "https://gemini.google.com/u/1/app/81c0bc24825d272c"  # trang Canvas chứa App Phối Đồ mới nhất
LAUNCH_ID = str(int(time.time() * 1000))  # đổi mỗi lần bật bảng điều khiển: tiện ích thấy đổi thì tự làm mới các trang

KEYFILE = HERE / "mat_khau.txt"
if not KEYFILE.exists():
    KEYFILE.write_text(secrets.token_urlsafe(9), encoding="utf-8")
KEY = KEYFILE.read_text(encoding="utf-8").strip()

try:
    from PIL import Image  # chỉ để làm ảnh xem trước nhỏ, không bắt buộc
except Exception:
    Image = None


# ---------------------------------------------------------------- tiện ích
class ApiError(Exception):
    pass


def nat_key(s):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", s)]


def safe(rel):
    """Đổi đường dẫn tương đối (dùng dấu /) thành Path an toàn bên trong kho."""
    rel = (rel or "").replace("\\", "/").strip("/")
    parts = [p for p in rel.split("/") if p]
    if any(p in ("..", ".") for p in parts):
        raise ApiError("đường dẫn không hợp lệ")
    joined = "/".join(parts)
    for old, new in LEGACY:
        if joined == old or joined.startswith(old + "/"):
            parts = new.split("/") + [x for x in joined[len(old):].split("/") if x]
            break
    p = (ROOT.joinpath(*parts)).resolve() if parts else ROOT
    if p != ROOT and ROOT not in p.parents:
        raise ApiError("đường dẫn nằm ngoài kho")
    return p


def rel_of(p):
    r = p.resolve().relative_to(ROOT)
    return "/".join(r.parts)


def clean_name(n):
    n = re.sub(r'[<>:"/\\|?*\x00-\x1f]', " ", str(n or "")).strip().strip(".")
    n = re.sub(r"\s+", " ", n)
    if not n or n.startswith("_"):
        raise ApiError("tên không hợp lệ (không để trống, không bắt đầu bằng dấu _)")
    return n[:120]


def is_product(p):
    return (p / "_sp.json").is_file()


def read_sp(p):
    try:
        return json.loads((p / "_sp.json").read_text(encoding="utf-8"))
    except Exception:
        return {}


def write_sp(p, d):
    (p / "_sp.json").write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")


def images_in(p):
    try:
        return sorted([f.name for f in p.iterdir() if f.is_file() and f.suffix.lower() in IMG_EXT], key=nat_key)
    except Exception:
        return []


def unique_dest(dest_dir, name):
    d = dest_dir / name
    if not d.exists():
        return d
    stem, suf = (d.stem, d.suffix) if d.is_file() else (d.name, "")
    i = 2
    while True:
        c = dest_dir / f"{stem} ({i}){suf}"
        if not c.exists():
            return c
        i += 1


def _hide(p):
    try:
        import ctypes
        ctypes.windll.kernel32.SetFileAttributesW(str(p), 0x2)
    except Exception:
        pass


def ensure_layout():
    """Tạo đủ thư mục mới và dời dữ liệu cũ vào đúng chỗ (an toàn khi chạy nhiều lần)."""
    SYSP.mkdir(exist_ok=True)
    try:
        (SYSP / "_viec_cho.json").unlink()  # mỗi lần bật lại bảng điều khiển: bỏ các việc phối còn nằm chờ từ lần trước
    except OSError:
        pass

    def _ren(old, new):
        if not old.is_dir():
            return
        if new.exists():
            for c in list(old.iterdir()):
                shutil.move(str(c), str(unique_dest(new, c.name)))
            try:
                old.rmdir()
            except OSError:
                pass
        else:
            try:
                old.rename(new)
            except OSError:
                # Có chương trình đang giữ thư mục (File Explorer, VS Code...) nên không đổi tên được:
                # tạo thư mục mới rồi chuyển từng thư mục con sang. Thư mục cũ (rỗng) còn lại, sếp xóa sau khi đóng chương trình đang giữ.
                try:
                    new.mkdir(parents=True, exist_ok=True)
                    for c in list(old.iterdir()):
                        shutil.move(str(c), str(unique_dest(new, c.name)))
                    print("Ghi chú: thư mục", old.name, "đang bị chương trình khác giữ nên đã chuyển nội dung sang", new.name,
                          "- thư mục cũ rỗng, sếp xóa tay sau cũng được.")
                except OSError as e:
                    print("KHÔNG chuyển được thư mục", old.name, "-", e)
                    print("Hãy đóng các cửa sổ File Explorer / VS Code đang mở thư mục kho, rồi bật lại bảng điều khiển.")
                    sys.exit(1)
    for o, n in (("ẢNH SẢN PHẨM", D_SP), ("ĐÃ PHỐI ĐỒ XONG", D_OUT), ("KHO MODEL", D_MODEL)):
        _ren(ROOT / o, ROOT / n)
    for r in (D_OUT1, D_OUT2, D_MPICK1, D_MPICK2):  # tạo sẵn thư mục cha của 2 đường trước khi dời
        (ROOT / r).mkdir(parents=True, exist_ok=True)
    for old, new in LEGACY[:7]:
        po, pn = old.split("/"), new.split("/")
        _ren(ROOT / pn[0] / po[1], ROOT / new)
    (ROOT / D_VMAU).mkdir(parents=True, exist_ok=True)
    _ren(ROOT / "ĐÃ ĐĂNG", ROOT / D_POSTED)  # thư mục "ĐÃ ĐĂNG" cũ nằm ở gốc kho -> vào 4 - KHO VIDEO MẪU / 3 - ĐÃ ĐĂNG
    for r in LAYOUT:
        (ROOT / r).mkdir(parents=True, exist_ok=True)
    # 3 thư mục cũ nằm thẳng trong ĐÃ PHỐI ĐỒ XONG -> vào 1 MODEL
    for nm, new in ((N_NEW, D_NEW1), (N_VID, D_VID1), (N_USED, D_USED1)):
        _ren(ROOT / D_OUT / nm, ROOT / new)
    # ảnh model cũ nằm thẳng (hoặc trong thư mục kiểu sản phẩm) trong LẤY MODEL NÀY -> ảnh để thẳng trong 1 MODEL
    mb, md = ROOT.joinpath(*D_MPICK.split("/")), ROOT / D_MPICK1
    try:
        for c in list(mb.iterdir()):
            if c.name in ("1 MODEL", "2 MODEL") or c.name.startswith(("_", ".")):
                continue
            if c.is_file() and c.suffix.lower() in IMG_EXT:
                shutil.move(str(c), str(unique_dest(md, c.name)))
            elif c.is_dir():
                left = []
                for root, dirs, files in os.walk(c):
                    for f in files:
                        fp = Path(root) / f
                        if fp.suffix.lower() in IMG_EXT and not f.startswith("."):
                            shutil.move(str(fp), str(unique_dest(md, f)))
                        elif f != "_sp.json":
                            left.append(fp)
                if not left:
                    shutil.rmtree(c, ignore_errors=True)  # chỉ còn _sp.json hoặc thư mục rỗng
    except OSError as e:
        print("Ghi chú: chưa dời hết ảnh model cũ vào 1 MODEL (", e, ")")
    old = ROOT / OLD_CAN
    if old.is_dir():
        for c in list(old.iterdir()):
            shutil.move(str(c), str(unique_dest(ROOT / D_CAN, c.name)))
        try:
            old.rmdir()
        except OSError:
            pass
    oldr = ROOT / "_KẾT QUẢ"
    if oldr.is_dir():
        for pdir in list(oldr.iterdir()):
            if pdir.is_dir():
                for f in list(pdir.iterdir()):
                    m = re.match(r"^(\d+)(\.(?:png|jpe?g|webp))$", f.name, re.I)
                    if f.is_file() and m:
                        shutil.move(str(f), str(unique_dest(ROOT / D_NEW, "%s__%s%s" % (pdir.name, m.group(1), m.group(2).lower()))))
        shutil.rmtree(oldr, ignore_errors=True)
    for c in list(ROOT.iterdir()):
        if c.name == SYSD or not c.name.startswith("_"):
            continue
        if c.name == "_nhan":
            shutil.rmtree(c, ignore_errors=True)
            continue
        dest = SYSP / c.name
        if not dest.exists():
            shutil.move(str(c), str(dest))
    for dead in ("_ket_qua.json", "_nhan_state.json", "_phoi_cfg.json"):
        try:
            (SYSP / dead).unlink()
        except OSError:
            pass
    for jn in ("_hang_phoi.json", "_phien.json", "_link_cho.json"):
        f = SYSP / jn
        if f.is_file():
            t = f.read_text(encoding="utf-8")
            t2 = t
            for old, new in LEGACY:
                t2 = t2.replace('"' + old + "/", '"' + new + "/")
            if t2 != t:
                f.write_text(t2, encoding="utf-8")
    _hide(SYSP)


def count_imgs(d, limit=5000):
    n = 0
    for root, dirs, files in os.walk(d):
        dirs[:] = [x for x in dirs if not x.startswith("_")]
        n += sum(1 for f in files if Path(f).suffix.lower() in IMG_EXT)
        if n >= limit:
            break
    return n


def count_vids(d, limit=5000):
    n = 0
    for root, dirs, files in os.walk(d):
        dirs[:] = [x for x in dirs if not x.startswith("_")]
        n += sum(1 for f in files if Path(f).suffix.lower() in VID_EXT and not f.startswith("."))
        if n >= limit:
            break
    return n


def count_products(d, limit=2000):
    n = 0
    for root, dirs, files in os.walk(d):
        dirs[:] = [x for x in dirs if not x.startswith("_")]
        if "_sp.json" in files:
            n += 1
            dirs[:] = []
        if n >= limit:
            break
    return n


def sha_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


# ---------------------------------------------------------------- các lệnh
def canvas_alive():
    """Có khung App Phối Đồ đang hỏi việc trong 6 giây gần đây không (vòng hỏi cập nhật mỗi 0,3 giây nên 6 giây là đủ chắc)."""
    return bool(_canvas_seen[0]) and time.time() - _canvas_seen[0] < 6


NOT_CONNECTED = "CHƯA NỐI: tiện ích chưa nối xong với app Phối Đồ. Đợi dòng báo xanh \"Đã nối app Phối Đồ\" (mở/F5 bản App Phối Đồ mới nhất, thường mất vài giây) rồi bấm lại."


# ---------------- bật / theo dõi Motion Control (+ ComfyUI nếu sếp muốn) cùng lúc với bảng điều khiển
MC_DIR = Path(CFG.get("motion_dir") or (HERE.parent.parent / "Tự Động Làm Video Motion Control" / "Code Chính"))
MC_PY = CFG.get("motion_python") or r"D:\ĐỂ CLAUDE TỰ DỌN DẸP\ElevenLabsVoiceApp\.venv\Scripts\python.exe"
COMFY_DIR = Path(CFG.get("comfy_dir") or r"D:\ĐỂ CLAUDE TỰ DỌN DẸP\ComfyUI")
COMFY_PY = CFG.get("comfy_python") or str(COMFY_DIR / "venv" / "Scripts" / "python.exe")
START_COMFY = bool(CFG.get("bat_comfyui", False))  # đặt true trong cau_hinh.json nếu muốn bật kèm ComfyUI (làm nét ảnh)
_mc_cache = {"t": 0.0, "mc": False, "comfy": False}


def _port_open(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.4):
            return True
    except OSError:
        return False


def mc_state():
    """Motion Control đã SẴN SÀNG chưa (không chỉ mở cổng mà phải trả lời được). Lưu tạm 2 giây cho nhẹ."""
    now = time.time()
    if now - _mc_cache["t"] < 2:
        return _mc_cache
    ready = False
    if _port_open(8765):
        try:
            with urllib.request.urlopen(MC_URL + "/api/estimate?duration=10&quality=lite", timeout=1.5) as r:
                ready = r.status == 200
        except Exception:
            ready = False
    _mc_cache.update({"t": now, "mc": ready, "comfy": _port_open(8188)})
    return _mc_cache


def _spawn_min(cmd, cwd):
    import subprocess
    si = subprocess.STARTUPINFO()
    si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    si.wShowWindow = 6  # SW_MINIMIZE: chạy ở cửa sổ nhỏ dưới thanh tác vụ
    subprocess.Popen(cmd, cwd=str(cwd), creationflags=subprocess.CREATE_NEW_CONSOLE, startupinfo=si)


def ensure_motion_control():
    """Bảng điều khiển bật lên thì bật luôn Motion Control (nếu chưa chạy). Chạy nền, không làm chậm bảng điều khiển."""
    try:
        if not _port_open(8765):
            if (MC_DIR / "server.py").is_file() and os.path.isfile(MC_PY):
                _spawn_min([MC_PY, "server.py"], MC_DIR)
                print(" Đang bật Motion Control (cửa sổ nhỏ dưới thanh tác vụ)…")
            else:
                print(" (Không tìm thấy Motion Control để tự bật:", MC_DIR, ")")
        if START_COMFY and not _port_open(8188):
            if (COMFY_DIR / "main.py").is_file() and os.path.isfile(COMFY_PY):
                _spawn_min([COMFY_PY, "main.py"], COMFY_DIR)
                print(" Đang bật ComfyUI (làm nét ảnh)…")
    except Exception as e:
        print(" (Không tự bật được Motion Control:", e, ")")


def _ui_ver():
    try:
        return int((HERE / "bang_dieu_khien.html").stat().st_mtime)
    except OSError:
        return 0


def ext_ver():
    """Dấu phiên bản của thư mục tiện ích: đổi khi có file tiện ích bị sửa (để tiện ích tự tải lại chính nó)."""
    d = HERE.parent.parent / "Nghiên Cứu Đối Thủ" / "Code Chính"
    m = 0
    try:
        for f in d.iterdir():
            if f.is_file() and f.suffix.lower() in (".js", ".json", ".html", ".css"):
                m = max(m, int(f.stat().st_mtime))
    except OSError:
        pass
    return m


def api_launch(q, body):
    return {"ok": True, "launch": LAUNCH_ID, "ext_ver": ext_ver(), "app_url": APP_URL, "chrome_at": _chrome_at[0], "now": time.time(), "panel_url": "http://localhost:%d/?key=%s" % (PORT, KEY)}


_local_ping = [0.0]
_ext_seen = [0.0]   # lần cuối tiện ích Chrome gọi về (khoLaunchCheck mỗi vòng): tiện ích còn sống thì Chrome của sếp đang chạy


def chrome_profile_dir():
    """Profile Chrome có cài tiện ích (nhiều profile thì mở nhầm cái khác). Ưu tiên cấu hình tay "chrome_profile" trong cau_hinh.json,
    rồi tới profile có tiện ích mà sếp dùng gần nhất."""
    try:
        if CFG.get("chrome_profile"):
            return str(CFG["chrome_profile"])
        ud = Path(os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\User Data"))
        ls = json.loads((ud / "Local State").read_text(encoding="utf-8"))
        info = (ls.get("profile") or {}).get("info_cache") or {}
        have = []
        for name in info:
            for fn in ("Preferences", "Secure Preferences"):
                p = ud / name / fn
                if p.is_file() and "Nghiên Cứu Đối Thủ" in p.read_text(encoding="utf-8", errors="ignore"):
                    have.append(name)
                    break
        if not have:
            return None
        have.sort(key=lambda n: -float((info.get(n) or {}).get("active_time") or 0))
        return have[0]
    except Exception:
        return None


def chrome_launch(urls):
    """Mở các trang trong ĐÚNG profile Chrome của sếp (không mở nhầm Chrome profile khác)."""
    exe = _chrome_exe()
    prof = chrome_profile_dir()
    if exe:
        cmd = [exe] + (["--profile-directory=" + prof] if prof else []) + list(urls)
        subprocess.Popen(cmd)
        return prof or "(mặc định)"
    for u in urls:
        os.startfile(u)
    return "(trình duyệt mặc định)"
_chrome_at = [0.0]   # lúc dây chuyền tự mở Chrome với CẢ 2 trang (để tiện ích khỏi mở trùng)


def restore_chrome_windows():
    """Cửa sổ Chrome đang thu nhỏ (nút _) thì phóng lên ngay từ phía máy chủ (Windows), không phụ thuộc tiện ích đang ngủ hay thức. Trả về số cửa sổ đã phóng."""
    try:
        import ctypes
        from ctypes import wintypes
        user32, kernel32 = ctypes.windll.user32, ctypes.windll.kernel32
        done = []
        PROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

        def image(pid):
            h = kernel32.OpenProcess(0x1000, False, pid)
            if not h:
                return ""
            try:
                buf = ctypes.create_unicode_buffer(520)
                sz = wintypes.DWORD(520)
                return buf.value.lower() if kernel32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(sz)) else ""
            finally:
                kernel32.CloseHandle(h)

        def cb(hwnd, _l):
            if user32.IsWindowVisible(hwnd) and user32.IsIconic(hwnd):
                cls = ctypes.create_unicode_buffer(64)
                user32.GetClassNameW(hwnd, cls, 64)
                if cls.value == "Chrome_WidgetWin_1":
                    pid = wintypes.DWORD()
                    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                    title = ctypes.create_unicode_buffer(256)
                    user32.GetWindowTextW(hwnd, title, 256)
                    if title.value and image(pid.value).endswith("\\chrome.exe"):
                        user32.ShowWindow(hwnd, 9)   # SW_RESTORE
                        done.append(hwnd)
            return True

        user32.EnumWindows(PROC(cb), 0)
        if done:
            try:   # nhấn nhẹ phím Alt để Windows cho phép đưa cửa sổ ra trước
                user32.keybd_event(0x12, 0, 0, 0)
                user32.keybd_event(0x12, 0, 2, 0)
                user32.SetForegroundWindow(done[0])
            except Exception:
                pass
        return len(done)
    except Exception as e:
        print(" (Không phóng được cửa sổ Chrome:", e, ")")
        return 0


_pages_want = {}   # tên trang -> {"url", "focus", "t"}: trang cần tiện ích MỞ hoặc ĐƯA LÊN (đã có tab đó rồi thì chỉ đưa lên, không mở thêm tab)


def request_pages(items):
    """items: [(tên, url, đưa_lên_trước)]. Tiện ích còn sống thì nhờ tiện ích: nó tìm tab đang có (kể cả cửa sổ thu nhỏ / bị che / bị treo nền), có thì phóng lên, chưa có mới mở đúng 1 tab.
    Tiện ích không báo về (Chrome đã tắt) thì bật Chrome đúng profile với các trang đó."""
    now = time.time()
    if now - _ext_seen[0] >= 45:
        chrome_launch([u for _n, u, _f in items])
        return "launch"
    for n, u, f in items:
        _pages_want[n] = {"url": u, "focus": bool(f), "t": now}
    return "ext"


def chrome_running():
    try:
        out = subprocess.run(["tasklist", "/FI", "IMAGENAME eq chrome.exe"], capture_output=True, text=True, timeout=10).stdout
        return "chrome.exe" in out.lower()
    except Exception:
        return False


def open_chrome_if_needed():
    """Bật dây chuyền: mở TRANG CÒN THIẾU trong đúng profile Chrome có tiện ích: bảng điều khiển nếu chưa có trang nào mở trên laptop,
    App Phối Đồ nếu chưa có tab app nào đang nối. Đã có rồi thì không mở thêm (khỏi trùng tab)."""
    try:
        # Chrome đang chạy mà tiện ích chưa kịp báo về (vừa bật lại bảng điều khiển): đợi tiện ích báo (tối đa ~22 giây) rồi mới xét trang nào thiếu, để khỏi mở trùng tab đã có.
        if time.time() - _ext_seen[0] >= 45 and chrome_running():
            for _ in range(22):
                if time.time() - _ext_seen[0] < 45:
                    break
                time.sleep(1)
        items = []
        if time.time() - _local_ping[0] >= 12:
            items.append(("panel", "http://localhost:%d/?key=%s" % (PORT, KEY), False))
        if not canvas_alive():
            items.append(("app", APP_URL, False))
        if not items:
            print(" Bảng điều khiển và App Phối Đồ đã mở sẵn, không mở thêm.")
            return
        if len(items) == 2 and time.time() - _ext_seen[0] >= 45:
            _chrome_at[0] = time.time()
        how = request_pages(items)
        print(" Cần %d trang (%s): %s." % (len(items), ", ".join(n for n, _u, _f in items), "đã bật Chrome mở các trang" if how == "launch" else "nhờ tiện ích mở trang còn thiếu, tab đã có thì giữ nguyên"))
    except Exception as e:
        print(" (Không tự mở được Chrome:", e, ")")


_app_open_at = [0.0]   # lần cuối tự mở tab App Phối Đồ vì có lệnh phối mà chưa có app nào đang nối


def ensure_app_tab():
    """Có lệnh phối đồ mà CHƯA có tab App Phối Đồ nào đang nối thì tự mở tab đó (đúng profile Chrome KÊNH DÉP). Đã có sẵn thì không mở thêm."""
    try:
        now = time.time()
        if canvas_alive():
            return
        restore_chrome_windows()   # Chrome đang thu nhỏ (nút _) thì phóng lên trước
        if now - _app_open_at[0] < 60 or now - _chrome_at[0] < 45:   # vừa mở xong, đang chờ app nối: đừng mở trùng
            return
        _app_open_at[0] = now
        how = request_pages([("app", APP_URL, True)])
        print(" Có lệnh phối đồ mà chưa thấy App Phối Đồ: %s." % ("đã bật Chrome mở app" if how == "launch" else "nhờ tiện ích đưa tab app lên (chưa có tab thì mở đúng 1 tab)"))
    except Exception as e:
        print(" (Không tự mở được App Phối Đồ:", e, ")")


_ext_log = []


def api_ext_log(q, body):
    """Tiện ích ghi lại việc nó vừa làm với cửa sổ Chrome (để biết vì sao Chrome không bật lên). Xem lại: GET /api/ext_log."""
    if body and body.get("msg"):
        _ext_log.append(time.strftime("%H:%M:%S ") + str(body["msg"])[:300])
        del _ext_log[:-60]
        return {"ok": True}
    return {"ok": True, "log": list(_ext_log)}


def _kill_port(port):
    """Tắt tiến trình đang nghe ở cổng này (dùng để bật lại Motion Control)."""
    try:
        out = subprocess.run(["netstat", "-ano", "-p", "tcp"], capture_output=True, text=True, timeout=15, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).stdout
        for ln in out.splitlines():
            parts = ln.split()
            if len(parts) >= 5 and parts[3] == "LISTENING" and parts[1].endswith(":%d" % port):
                subprocess.run(["taskkill", "/F", "/PID", parts[4]], capture_output=True, timeout=15, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                return True
    except Exception:
        pass
    return False


def api_fix(q, body):
    """Bấm 2 lần vào nút trạng thái ở bảng điều khiển để kích hoạt lại từ xa.
    what = app (App Phối Đồ) | ext (Chrome có tiện ích) | mc (Motion Control) | all (khởi động lại toàn bộ)."""
    what = str((body or {}).get("what") or (q.get("what") or [""])[0])
    if what == "app":
        n = restore_chrome_windows()
        _app_open_at[0] = 0
        how = request_pages([("app", APP_URL, True)])
        return {"ok": True, "msg": ("Đã phóng Chrome lên. " if n else "") + ("Đã bật Chrome và mở App Phối Đồ." if how == "launch" else "Đã nhờ tiện ích đưa tab App Phối Đồ lên (chưa có tab thì mở đúng 1 tab). Vài giây nữa sẽ sáng.")}
    if what == "ext":
        n = restore_chrome_windows()
        if time.time() - _ext_seen[0] >= 45:
            chrome_launch(["http://localhost:%d/?key=%s" % (PORT, KEY)])
            return {"ok": True, "msg": "Tiện ích chưa báo về: đã bật Chrome (profile KÊNH DÉP). Vài giây nữa sẽ sáng."}
        return {"ok": True, "msg": ("Đã phóng Chrome lên. " if n else "Chrome đang chạy, tiện ích còn báo về. ") + "Nếu vẫn chưa sáng thì bấm 2 lần vào Phối đồ."}
    if what == "mc":
        if _port_open(8765):
            _kill_port(8765)
            for _ in range(10):
                if not _port_open(8765):
                    break
                time.sleep(0.5)
        threading.Thread(target=ensure_motion_control, daemon=True).start()
        return {"ok": True, "msg": "Đang bật lại Motion Control (khoảng 10 giây)."}
    if what == "all":
        r = subprocess.run(["schtasks", "/run", "/tn", "QV Khoi dong lai"], capture_output=True, text=True, timeout=20, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if r.returncode != 0:
            raise ApiError("Chưa có tác vụ khởi động lại trên laptop (QV Khoi dong lai).")
        return {"ok": True, "msg": "Đang khởi động lại toàn bộ. Khoảng 20 đến 30 giây nữa bảng điều khiển tự nối lại."}
    raise ApiError("không rõ cần kích hoạt gì")


def api_app_open(q, body):
    """Tiện ích hỏi: có trang nào cần mở / đưa lên không? Làm xong thì báo done để xóa khỏi hàng."""
    now = time.time()
    if body and body.get("want"):   # yêu cầu mở / đưa lên trang từ bên ngoài (dùng để thử): [{"name","url","focus"}]
        for w in body["want"]:
            _pages_want[str(w.get("name") or "x")] = {"url": str(w.get("url") or ""), "focus": bool(w.get("focus")), "t": now}
        return {"ok": True}
    if body and body.get("done"):
        for n in body.get("done"):
            _pages_want.pop(str(n), None)
        return {"ok": True}
    for n in [k for k, v in _pages_want.items() if now - v.get("t", 0) >= 90]:
        _pages_want.pop(n, None)
    return {"ok": True, "pages": [{"name": n, "url": v["url"], "focus": v["focus"]} for n, v in _pages_want.items()]}


def api_ping(q, body):
    total = count_products(ROOT, 100000)
    return {"ok": True, "kho": str(ROOT), "san_pham": total, "pillow": bool(Image), "ui": _ui_ver(), "canvas_alive": canvas_alive(), "mc_ready": mc_state()["mc"], "comfy_ready": mc_state()["comfy"], "comfy_wanted": START_COMFY, "canvas_ago": int(time.time() - _canvas_seen[0]) if _canvas_seen[0] else None}


def walk_products(p):
    """Mọi sản phẩm nằm dưới thư mục p (kể cả trong các thư mục con), theo thứ tự tên."""
    try:
        subs = sorted([x for x in p.iterdir() if x.is_dir() and not x.name.startswith("_")], key=lambda x: nat_key(x.name))
    except OSError:
        return
    for d in subs:
        if is_product(d):
            yield d
        else:
            yield from walk_products(d)


def api_tree(q, body):
    rel = (q.get("path") or [""])[0]
    p = safe(rel)
    if not p.is_dir():
        raise ApiError("thư mục không tồn tại")
    if is_product(p):
        raise ApiError("đây là sản phẩm, không phải thư mục phân loại")
    folders, products = [], []
    for d in sorted([x for x in p.iterdir() if x.is_dir() and not x.name.startswith("_")], key=lambda x: nat_key(x.name)):
        if is_product(d):
            sp = read_sp(d)
            imgs = images_in(d)
            chon = [c for c in sp.get("chon", []) if c in imgs]
            products.append({"name": d.name, "rel": rel_of(d), "n": len(imgs), "thumb": (chon or imgs or [None])[0],
                             "state": sp.get("state", "new"), "chon": len(chon) if "chon" in sp else (1 if imgs else 0)})
        else:
            folders.append({"name": d.name, "rel": rel_of(d), "count": count_products(d), "nimg": count_imgs(d), "nvid": count_vids(d)})
    # Số sản phẩm theo trạng thái trong CẢ thư mục này (gồm thư mục con) để chip Mới / Đã phối... đếm đúng; deep=1 thì trả luôn danh sách sản phẩm của cả nhánh (kèm thư mục chứa nó)
    deep = (q.get("deep") or ["0"])[0] == "1"
    counts = {"all": 0, "new": 0, "pick": 0, "park": 0, "used": 0, "drop": 0}
    deep_products = []
    for d in walk_products(p):
        sp = read_sp(d)
        stt = sp.get("state", "new")
        counts["all"] += 1
        counts[stt] = counts.get(stt, 0) + 1
        if deep:
            imgs = images_in(d)
            chon = [c for c in sp.get("chon", []) if c in imgs]
            deep_products.append({"name": d.name, "rel": rel_of(d), "n": len(imgs), "thumb": (chon or imgs or [None])[0], "state": stt,
                                  "chon": len(chon) if "chon" in sp else (1 if imgs else 0), "where": rel_of(d.parent) if d.parent != ROOT else ""})
    if deep:
        products = deep_products
    loose = images_in(p)
    videos = []
    try:
        _src = jread("_nguon_video.json", {})
        for f in sorted(p.iterdir(), key=lambda x: -x.stat().st_mtime):
            if f.is_file() and f.suffix.lower() in VID_EXT and not f.name.startswith("."):
                videos.append({"name": f.name, "rel": rel_of(f), "size": f.stat().st_size, "t": int(f.stat().st_mtime), "src": _src.get(f.name, "")})
    except OSError:
        pass
    return {"ok": True, "path": rel_of(p) if p != ROOT else "", "name": p.name if p != ROOT else "KHO ẢNH SẢN PHẨM",
            "folders": folders, "products": products, "loose": loose, "videos": videos, "counts": counts, "deep": deep}


def api_product(q, body):
    p = safe((q.get("path") or [""])[0])
    if not is_product(p):
        raise ApiError("không phải sản phẩm")
    sp = read_sp(p)
    imgs = images_in(p)
    chon = sp.get("chon")
    if chon is None:
        chon = imgs[:1]
    return {"ok": True, "name": p.name, "rel": rel_of(p), "images": imgs, "chon": [c for c in chon if c in imgs],
            "state": sp.get("state", "new"), "tu_them": sp.get("tu_them", []), "link": sp.get("link", ""), "dung": sp.get("dung", {})}


def api_alltree(q, body):
    """Cây thư mục phân loại (không gồm sản phẩm) để chọn nơi chuyển đến."""
    def walk(d, depth):
        out = []
        for x in sorted([y for y in d.iterdir() if y.is_dir() and not y.name.startswith("_") and not is_product(y)], key=lambda y: nat_key(y.name)):
            out.append({"name": x.name, "rel": rel_of(x), "depth": depth})
            out += walk(x, depth + 1)
        return out
    return {"ok": True, "folders": walk(ROOT, 0)}


def api_mkdir(q, body):
    parent = safe(body.get("path"))
    if is_product(parent):
        raise ApiError("không tạo thư mục bên trong một sản phẩm")
    d = parent / clean_name(body.get("name"))
    if d.exists():
        raise ApiError("đã có thư mục tên này")
    d.mkdir()
    return {"ok": True, "rel": rel_of(d)}


def api_move(q, body):
    dest = safe(body.get("to"))
    if not dest.is_dir() or is_product(dest):
        raise ApiError("nơi đến phải là thư mục phân loại")
    moved = []
    for r in body.get("items") or []:
        src = safe(r)
        if src == ROOT or not src.exists():
            continue
        if src == dest or src in dest.parents:
            raise ApiError("không thể chuyển một thư mục vào chính nó")
        if src.parent == dest:
            continue
        d = unique_dest(dest, src.name)
        shutil.move(str(src), str(d))
        moved.append(rel_of(d))
    return {"ok": True, "moved": moved}


def api_rename(q, body):
    src = safe(body.get("path"))
    if src == ROOT or not src.exists():
        raise ApiError("không tìm thấy")
    d = src.parent / clean_name(body.get("name"))
    if d.exists():
        raise ApiError("đã có tên này")
    old_rel = rel_of(src)
    src.rename(d)
    try:
        lk = set(jread("_model_lock.json", {}).get("locked") or [])
        if old_rel in lk:
            lk.discard(old_rel)
            lk.add(rel_of(d))
            jwrite("_model_lock.json", {"locked": sorted(lk)})
    except Exception:
        pass
    return {"ok": True, "rel": rel_of(d)}


def _busy_msg(e):
    return ("Windows đang giữ mục này (thường do cửa sổ File Explorer đang mở đúng thư mục đó, hoặc một chương trình đang dùng ảnh trong đó). "
            "Hãy đóng các cửa sổ đó rồi thử lại. Chi tiết: " + str(e)[:80])


def api_delete(q, body):
    """Xóa. hard=true: XÓA HẲN, không lấy lại được. Không có hard: chuyển vào _THÙNG RÁC."""
    hard = bool(body.get("hard"))
    t = SYSP / TRASH
    out = []
    for r in body.get("items") or []:
        src = safe(r)
        if src == ROOT or not src.exists() or src == t or src == SYSP or src.name in (TRASH, THUMBS) or rel_of(src) in LAYOUT:
            continue
        try:
            if hard:
                if src.is_dir():
                    shutil.rmtree(src)
                else:
                    src.unlink()
                out.append(src.name)
            else:
                t.mkdir(exist_ok=True)
                d = unique_dest(t, time.strftime("%Y%m%d-%H%M%S") + "_" + src.name)
                shutil.move(str(src), str(d))
                out.append(d.name)
        except OSError as e:
            raise ApiError(_busy_msg(e))
    return {"ok": True, "deleted": out, "hard": hard}


def api_state(q, body):
    p = safe(body.get("path"))
    if not is_product(p):
        raise ApiError("không phải sản phẩm")
    sp = read_sp(p)
    if "state" in body:
        if body["state"] not in ("new", "pick", "park", "used", "drop"):
            raise ApiError("trạng thái không hợp lệ")
        sp["state"] = body["state"]
    if "chon" in body:
        imgs = images_in(p)
        sp["chon"] = [c for c in body["chon"] if c in imgs]
    write_sp(p, sp)
    return {"ok": True}


def api_group(q, body):
    """Gom ảnh lẻ của một thư mục phân loại thành một sản phẩm mới."""
    p = safe(body.get("path"))
    if is_product(p):
        raise ApiError("đây đã là sản phẩm")
    files = [f for f in (body.get("files") or images_in(p)) if f in images_in(p)]
    if not files:
        raise ApiError("không có ảnh lẻ nào")
    d = unique_dest(p, clean_name(body.get("name") or "Sản phẩm mới"))
    d.mkdir()
    for f in files:
        shutil.move(str(p / f), str(d / f))
    write_sp(d, {"state": "new", "added": int(time.time()), "tu_them": []})
    return {"ok": True, "rel": rel_of(d), "n": len(files)}


def api_newproduct(q, body):
    """Tạo sản phẩm rỗng (dùng khi thêm ảnh bằng tay hoặc khi tiện ích tải ảnh về)."""
    p = safe(body.get("path"))
    if is_product(p):
        raise ApiError("không tạo sản phẩm bên trong sản phẩm")
    d = unique_dest(p, clean_name(body.get("name") or "Sản phẩm mới"))
    d.mkdir()
    write_sp(d, {"state": "new", "added": int(time.time()), "link": body.get("link", ""), "ma": str(body.get("ma", "")), "tu_them": []})
    return {"ok": True, "rel": rel_of(d)}


def api_find(q, body):
    """Tìm sản phẩm đã có trong kho theo mã sản phẩm (để không tải lại)."""
    ma = (q.get("ma") or [""])[0]
    if not ma:
        raise ApiError("thiếu mã")
    for root, dirs, files in os.walk(ROOT):
        dirs[:] = [x for x in dirs if not x.startswith("_")]
        if "_sp.json" in files:
            try:
                sp = json.loads((Path(root) / "_sp.json").read_text(encoding="utf-8"))
            except Exception:
                sp = {}
            if str(sp.get("ma", "")) == ma:
                return {"ok": True, "found": True, "rel": rel_of(Path(root))}
            dirs[:] = []
    return {"ok": True, "found": False}


def api_upload(q, body, raw=None):
    p = safe((q.get("path") or [""])[0])
    if not is_product(p):
        raise ApiError("chỉ thêm ảnh vào sản phẩm")
    name = (q.get("name") or ["anh.jpg"])[0]
    ext = Path(name).suffix.lower()
    if ext not in IMG_EXT:
        raise ApiError("không phải ảnh")
    if not raw:
        raise ApiError("ảnh rỗng")
    h = hashlib.sha256(raw).hexdigest()
    for f in images_in(p):
        if (p / f).stat().st_size == len(raw) and sha_file(p / f) == h:
            return {"ok": True, "dup": True, "file": f}
    nums = [int(Path(f).stem) for f in images_in(p) if Path(f).stem.isdigit()]
    fname = f"{(max(nums) if nums else 0) + 1}{ext}"
    (p / fname).write_bytes(raw)
    sp = read_sp(p)
    sp.setdefault("tu_them", []).append(fname)
    write_sp(p, sp)
    return {"ok": True, "dup": False, "file": fname}


def jfile(name):
    SYSP.mkdir(exist_ok=True)
    return SYSP / name


def heal_rel(rel, name):
    """Sếp kéo sản phẩm sang thư mục khác bằng File Explorer thì đường dẫn cũ hỏng: tìm lại theo mã sản phẩm (số cuối tên)."""
    try:
        if is_product(safe(rel)):
            return rel
    except ApiError:
        pass
    m = re.search(r"(\d{15,22})\s*$", str(name or "")) or re.search(r"(\d{15,22})\s*$", str(rel or ""))
    return find_by_ma(m.group(1)) if m else None


def api_queue(q, body):
    f = jfile("_hang_phoi.json")
    if body is None:
        try:
            qq = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            return {"ok": True, "queue": []}
        changed, out = False, []
        for it in qq:
            nr = heal_rel(it.get("rel"), it.get("name"))
            if not nr:
                changed = True  # sản phẩm đã bị xóa khỏi kho: bỏ khỏi hàng
                continue
            if nr != it.get("rel"):
                it["rel"] = nr
                changed = True
            try:
                have = set(images_in(safe(nr)))
                keep = [x for x in it.get("imgs", []) if x in have]
                if keep != it.get("imgs"):
                    it["imgs"] = keep or images_in(safe(nr))[:1]
                    changed = True
            except ApiError:
                pass
            out.append(it)
        if changed:
            f.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
        return {"ok": True, "queue": out}
    f.write_text(json.dumps(body.get("queue") or [], ensure_ascii=False, indent=1), encoding="utf-8")
    return {"ok": True}


def api_settings(q, body):
    f = jfile("_cai_dat.json")
    if body is None:
        try:
            return {"ok": True, "settings": json.loads(f.read_text(encoding="utf-8"))}
        except Exception:
            return {"ok": True, "settings": None}
    f.write_text(json.dumps(body.get("settings"), ensure_ascii=False, indent=1), encoding="utf-8")
    return {"ok": True}


def _kalo_waiting():
    """Có lệnh quét Kalodata đang chờ tiện ích nhận (đã hết giờ nghỉ giữa 2 kênh) -> cho tiện ích khỏi đợi hết chu kỳ 20 giây."""
    try:
        if any(time.time() - v.get("t", 0) < 90 for v in _pages_want.values()):
            return True   # có trang cần mở / đưa lên
        j = (json.loads(jfile("_kalo.json").read_text(encoding="utf-8")) or {}).get("job") or {}
        if j.get("status") == "wait" and time.time() >= float(j.get("nb") or 0):
            return True
        d = (json.loads(jfile("_doithu.json").read_text(encoding="utf-8")) or {}).get("job") or {}
        return d.get("status") == "wait" or (d.get("status") == "run" and bool(d.get("stop")))
    except Exception:
        return False


def api_links(q, body):
    """Danh sách link chờ tải ảnh. Mỗi link có trạng thái: wait (chờ) / doing (đang tải) / done (xong) / error."""
    f = jfile("_link_cho.json")

    def load():
        try:
            c = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            c = []
        for x in c:
            x.setdefault("status", "wait")
        return c
    cur = load()
    if body is None:
        pend = (q.get("pending") or [""])[0]
        try:
            wait = max(0.0, min(float((q.get("wait") or ["0"])[0] or 0), 25.0))
        except ValueError:
            wait = 0.0
        deadline = time.time() + wait
        while pend and wait and not any(x.get("status") == "wait" for x in cur) and not _kalo_waiting() and time.time() < deadline:
            time.sleep(0.3)  # giữ máy: có link cần tải là trả lời ngay, khỏi đợi chu kỳ 30 giây
            cur = load()
        if pend:
            cur = [x for x in cur if x.get("status") == "wait"]
        return {"ok": True, "links": cur}
    have = {x.get("link") for x in cur}
    for l in body.get("add") or []:
        l = str(l).strip()
        if l and l not in have:
            cur.append({"link": l, "t": int(time.time()), "status": "hold" if body.get("hold") else "wait", "note": ""})
            have.add(l)
    for s in body.get("set") or []:
        for x in cur:
            if x.get("link") == s.get("link"):
                x["status"] = s.get("status", x.get("status"))
                x["note"] = s.get("note", "")
                if s.get("rel") is not None:
                    x["rel"] = s.get("rel")
    if body.get("run_hold"):
        for x in cur:
            if x.get("status") == "hold":
                x["status"] = "wait"
    if body.get("retry"):
        for x in cur:
            if x.get("link") in body["retry"]:
                x["status"], x["note"] = "wait", ""
    if body.get("remove"):  # xóa riêng từng link (bất kỳ trạng thái nào, kể cả lỗi)
        rm = {str(x) for x in body["remove"]}
        cur = [x for x in cur if x.get("link") not in rm]
    if body.get("clear_finished"):  # dọn: bỏ các link đã xong VÀ các link lỗi (giữ link đang chờ / đã lưu / đang tải)
        cur = [x for x in cur if x.get("status") not in ("done", "error")]
    if body.get("clear_done"):
        cur = [x for x in cur if x.get("status") != "done"]
    if body.get("clear"):
        cur = []
    f.write_text(json.dumps(cur, ensure_ascii=False, indent=1), encoding="utf-8")
    return {"ok": True, "links": cur}


KINDS = ("top", "bottom", "dress", "acc")
_res_lock = threading.Lock()
_canvas_seen = [0.0]  # lần cuối tab Canvas (qua tiện ích) hỏi "có việc không"
_canvas_frames = {}  # "tab:khung" -> {tab, area, t}: mỗi khung chứa app (một tab Gemini có thể có 2 khung: bản đang hiện + bản ẩn)
_canvas_tabs = {}  # id tab Chrome -> {title, t}: các tab Canvas đang nối (để thấy nếu có nhiều tab cùng chứa app)


def jread(name, default):
    try:
        return json.loads(jfile(name).read_text(encoding="utf-8"))
    except Exception:
        return default


def jwrite(name, data):
    jfile(name).write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


def add_notice(text):
    with _res_lock:
        n = jread("_thong_bao.json", [])
        n.append({"t": int(time.time()), "text": str(text)[:300]})
        jwrite("_thong_bao.json", n[-40:])


def phoi_settings(s, lane=None):
    """Đổi cài đặt của bảng điều khiển sang đúng dạng mà app Phối Đồ đọc được.
    lane = "1" / "2" / "both" (chọn ở tab Phối đồ): quyết định ô "SET UP CẢ 2" và ô "Số người" của app, để nhãn ảnh và mục 3 luôn khớp."""
    if not s and not lane:
        return None
    s = s or {}
    chips = dict(s.get("chips") or {})
    chips.update(s.get("chk") or {})
    sel = dict(s.get("sel") or {})
    if lane:
        chips["p2Both"] = (lane == "both")
        sel["peopleSelect"] = "2" if lane == "2" else "1"
    out = {"chips": chips, "groups": s.get("groups") or {}, "sel": sel, "texts": {}}
    if s.get("logo") is not None:
        out["logo"] = str(s["logo"])
    return out


def find_by_ma(ma):
    if not ma:
        return None
    for root, dirs, files in os.walk(ROOT):
        dirs[:] = [x for x in dirs if not x.startswith("_")]
        if "_sp.json" in files:
            try:
                sp = json.loads((Path(root) / "_sp.json").read_text(encoding="utf-8"))
            except Exception:
                sp = {}
            if str(sp.get("ma", "")) == str(ma):
                return rel_of(Path(root))
            dirs[:] = []
    return None


def _new_pid(base, phien, k=0):
    """Mã phiên chạy luôn KHÁC mọi mã đã dùng (trước đây lặp lại sau đúng 1000 giây nên bị tưởng là việc cũ đã xong)."""
    n = int(time.time()) + k
    while True:
        pid = base + "%05d" % (n % 100000)
        if pid not in phien:
            return pid
        n += 1


# ---------------- tab VIDEO (chuẩn bị cặp ảnh + video giống Motion Control; CHƯA nối chạy thật)
def vid_default():
    return {"defaults": {"duration": "10", "quality": "lite", "bg": "image", "people": "1"}, "pairs": []}


def _vlist(rel_dir, meta_name=None):
    d = ROOT / rel_dir
    meta = jread(meta_name, {}) if meta_name else {}
    out = []
    try:
        for f in d.iterdir():
            if f.is_file() and f.suffix.lower() in VID_EXT and not f.name.startswith("."):
                st = f.stat()
                out.append({"name": f.name, "rel": rel_of(f), "t": int(st.st_mtime), "size": st.st_size, "meta": meta.get(f.name) or {}})
    except OSError:
        pass
    out.sort(key=lambda x: -x["t"])
    return out


BACKUP_DIR = HERE.parent.parent / "Nghiên Cứu Đối Thủ" / "DỮ LIỆU MỚI NHẤT"


def api_backup_save(q, body, raw=None):
    """Tiện ích Quang Vinh Pro gửi bản sao lưu dữ liệu quét sang đây: ghi đè 1 file duy nhất trong
    Nghiên Cứu Đối Thủ\\DỮ LIỆU MỚI NHẤT (không để rơi vào thư mục Tải xuống của Chrome)."""
    if not raw:
        raise ApiError("dữ liệu rỗng")
    try:
        json.loads(raw.decode("utf-8"))
    except Exception:
        raise ApiError("không phải file json hợp lệ, không ghi đè bản cũ")
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    dest = BACKUP_DIR / "Du Lieu Nghien Cuu Doi Thu.json"
    tmp = BACKUP_DIR / ".dang_ghi.tmp"
    tmp.write_bytes(raw)
    os.replace(str(tmp), str(dest))
    return {"ok": True, "path": str(dest), "size": len(raw)}


# ---------------- CHẠY VIDEO THẬT qua Motion Control + TỰ QUÉT LẠI kết quả (không sửa file nào của Motion Control)
RH_BASE = "https://www.runninghub.ai"
_vj_lock = threading.Lock()
_rh_last = {}  # id việc -> lần cuối hỏi thẳng RunningHub


def _rh_key():
    """Khóa RunningHub đã nằm sẵn trong Motion Control; đọc ra dùng, không chép sang chỗ khác."""
    try:
        return re.search(r'RH_API_KEY\s*=\s*"([^"]+)"', (MC_DIR / "server.py").read_text(encoding="utf-8", errors="replace")).group(1)
    except Exception:
        return ""


def _post_json(url, data, timeout=20):
    req = urllib.request.Request(url, data=json.dumps(data).encode("utf-8"), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def _get_json(url, timeout=8):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def _multipart(fields, files):
    b = "----qv" + secrets.token_hex(8)
    parts = []
    for k, v in fields:
        parts.append(('--%s\r\nContent-Disposition: form-data; name="%s"\r\n\r\n%s\r\n' % (b, k, v)).encode("utf-8"))
    for k, fname, data in files:
        parts.append(('--%s\r\nContent-Disposition: form-data; name="%s"; filename="%s"\r\nContent-Type: application/octet-stream\r\n\r\n' % (b, k, fname)).encode("utf-8") + data + b"\r\n")
    parts.append(("--%s--\r\n" % b).encode())
    return b"".join(parts), "multipart/form-data; boundary=" + b


def vj_read():
    return jread("_video_jobs.json", [])


def vj_update(jid, **kw):
    with _vj_lock:
        lst = vj_read()
        for r in lst:
            if r.get("id") == jid:
                r.update(kw)
                if kw.get("state") in ("working", "trimming", "uploading") and not r.get("t_run"):
                    r["t_run"] = int(time.time())  # mốc bắt đầu chạy thật (không tính thời gian xếp hàng) để vẽ vòng sáng tiến độ
        jwrite("_video_jobs.json", lst)


def vj_add(rec):
    with _vj_lock:
        lst = vj_read()
        lst.append(rec)
        jwrite("_video_jobs.json", lst[-300:])


def _mc_submit(img_path, vid_path, duration, quality, bg, simulate, people="1"):
    """Gửi đúng file gốc (không nén, không đổi) sang Motion Control giống hệt bấm Tạo video bên đó."""
    fields = [("durations", duration), ("qualities", quality), ("bg_sources", bg), ("simulate", "true" if simulate else "false"), ("peoples", people)]
    files = [("images", "anh" + img_path.suffix.lower(), img_path.read_bytes()), ("videos", "vid" + vid_path.suffix.lower(), vid_path.read_bytes())]
    body, ct = _multipart(fields, files)
    req = urllib.request.Request(MC_URL + "/api/generate", data=body, headers={"Content-Type": ct})
    with urllib.request.urlopen(req, timeout=180) as r:
        res = json.loads(r.read().decode("utf-8"))
    if not res.get("jobIds"):
        raise ApiError("Motion Control không nhận việc: " + str(res)[:200])
    return res["jobIds"][0]


def api_video_run(q, body):
    """Nút Tạo video: mỗi cặp ảnh + video đủ cả hai được gửi thẳng sang Motion Control chạy THẬT (tốn tiền RunningHub)."""
    if not mc_state()["mc"]:
        raise ApiError("Motion Control (app tạo video) chưa bật xong, chưa gửi được. Đợi chip Tạo video báo sẵn sàng.")
    simulate = bool(body.get("simulate"))
    sent, errors = [], []
    for p in (body.get("pairs") or [])[:50]:
        pid = str(p.get("id", ""))
        try:
            ip, vp = safe(p.get("img")), safe(p.get("vid"))
            if not ip.is_file() or ip.suffix.lower() not in IMG_EXT:
                raise ApiError("không thấy ảnh của cặp này (có thể đã bị chuyển đi)")
            if not vp.is_file() or vp.suffix.lower() not in VID_EXT:
                raise ApiError("không thấy video của cặp này")
            dur = p.get("duration") if p.get("duration") in ("10", "15", "20") else "10"
            qual = p.get("quality") if p.get("quality") in ("lite", "pro") else "lite"
            bg = p.get("bg") if p.get("bg") in ("image", "video") else "image"
            people = p.get("people") if p.get("people") in ("1", "2") else "1"
            jid = _mc_submit(ip, vp, dur, qual, bg, simulate, people)
            vj_add({"id": jid, "pair": pid, "img_rel": rel_of(ip), "img_name": ip.name, "vid_name": vp.name, "duration": dur, "quality": qual, "bg": bg, "people": people,
                    "sim": simulate, "created": int(time.time()), "state": "queued", "msg": "Đã gửi sang Motion Control, đang xếp hàng", "rh": "", "result_rel": ""})
            sent.append(pid)
        except Exception as e:
            errors.append({"pair": pid, "error": str(e)[:200]})
    return {"ok": True, "sent": sent, "errors": errors}


def _vj_save_result(rec, src_bytes_path=None, data_writer=None):
    d = ROOT / D_VMAU2
    d.mkdir(parents=True, exist_ok=True)
    stem = re.sub(r"[^\w\-]+", "_", Path(rec.get("img_name") or "video").stem)[:40] or "video"
    dest = unique_dest(d, "%s_%s.mp4" % (stem, time.strftime("%d%m_%H%M%S")))
    tmp = d / (".dang_ghi_" + dest.name + ".tmp")
    if src_bytes_path:
        shutil.copyfile(str(src_bytes_path), str(tmp))
    else:
        data_writer(tmp)
    if not tmp.is_file() or tmp.stat().st_size < 1000:
        try:
            tmp.unlink()
        except OSError:
            pass
        raise ApiError("file video rỗng")
    os.replace(str(tmp), str(dest))
    return dest


def _vj_finish(rec, dest):
    """Video đã về kho. Ảnh đã dùng (nếu đang ở CHỜ LÀM VIDEO) chuyển sang ĐÃ LÀM VIDEO RỒI."""
    img_rel = rec.get("img_rel") or ""
    try:
        ip = safe(img_rel)
        for ln in ("1", "2"):
            if ip.is_file() and rel_of(ip).startswith(LANES[ln][1] + "/"):
                ud = ROOT / LANES[ln][2]
                ud.mkdir(parents=True, exist_ok=True)
                nd = unique_dest(ud, ip.name)
                shutil.move(str(ip), str(nd))
                img_rel = rel_of(nd)
                break
    except Exception:
        pass
    vj_update(rec["id"], state="done", msg="Xong, video đã nằm trong kho", result_rel=rel_of(dest), img_rel=img_rel, done_at=int(time.time()))


def _rh_download(rec, task_id):
    key = _rh_key()
    res = _post_json(RH_BASE + "/task/openapi/outputs", {"apiKey": key, "taskId": task_id}, 30)
    if res.get("code") != 0 or not res.get("data"):
        raise RuntimeError("chưa lấy được kết quả: " + str(res)[:150])
    url = urllib.parse.quote(res["data"][0]["fileUrl"], safe=":/?&=%#@+,;~")  # link có ký tự lạ thì mã hóa lại cho tải được

    def writer(tmp):
        zp = tmp.with_suffix(".zip.tmp")
        with urllib.request.urlopen(url, timeout=120) as r, open(zp, "wb") as f:
            shutil.copyfileobj(r, f)
        try:
            import zipfile
            if zipfile.is_zipfile(zp):
                with zipfile.ZipFile(zp) as z:
                    name = next(n for n in z.namelist() if n.lower().endswith(".mp4"))
                    with z.open(name) as s, open(tmp, "wb") as o:
                        shutil.copyfileobj(s, o)
            else:
                shutil.copyfile(str(zp), str(tmp))
        finally:
            try:
                zp.unlink()
            except OSError:
                pass
    return _vj_save_result(rec, data_writer=writer)


def vj_check(rec):
    """Quét lại MỘT việc: hỏi Motion Control, rồi hỏi THẲNG RunningHub (nguồn sự thật). Mất mạng KHÔNG bị tính là lỗi."""
    jid = rec["id"]
    job = None
    try:
        job = _get_json("%s/api/status/%s" % (MC_URL, jid))
    except Exception:
        job = None
    rh = (job or {}).get("rh_task_id") or rec.get("rh") or ""
    if rh and rh != rec.get("rh"):
        vj_update(jid, rh=rh)
        rec["rh"] = rh
    st = (job or {}).get("status")
    if st == "done":
        rv = (job or {}).get("result_video")
        if rv:
            def _w(tmp):  # lấy đúng file gốc Motion Control đã lưu, chép nguyên (không nén)
                with urllib.request.urlopen(MC_URL + quote(rv), timeout=120) as r, open(tmp, "wb") as f:
                    shutil.copyfileobj(r, f)
            try:
                _vj_finish(rec, _vj_save_result(rec, data_writer=_w))
                return
            except Exception as e:
                vj_update(jid, msg="Video đã làm xong nhưng chưa chép vào kho được, đang thử lại (%s)" % str(e)[:80])
                return
    mc_failed = st == "failed"
    if not rh:
        if mc_failed:
            vj_update(jid, state="failed", msg="Lỗi trước khi RunningHub nhận việc (thường chưa tốn tiền): " + str((job or {}).get("error") or "")[:160], final=True)
        elif job is None:
            vj_update(jid, state="checking", msg="Không hỏi được Motion Control (đã tắt hoặc đang khởi động). Em đang thử lại…")
        else:
            lab = {"queued": ("queued", "Đang xếp hàng"), "trimming": ("working", "Đang cắt video"), "uploading": ("working", "Đang tải ảnh + video lên RunningHub")}.get(st, ("working", "Đang xử lý"))
            vj_update(jid, state=lab[0], msg=lab[1])
        return
    now = time.time()
    if now - _rh_last.get(jid, 0) < 6:
        return
    _rh_last[jid] = now
    try:
        status = _post_json(RH_BASE + "/task/openapi/status", {"apiKey": _rh_key(), "taskId": rh}, 15).get("data")
    except Exception:
        vj_update(jid, state="checking", msg="Mất mạng hoặc RunningHub chưa trả lời, em đang quét lại liên tục (chưa tính là lỗi)…")
        return
    if status == "SUCCESS":
        try:
            _vj_finish(rec, _rh_download(rec, rh))
        except Exception as e:
            vj_update(jid, state="checking", msg="RunningHub đã làm xong, đang tải video về (mạng chưa ổn, thử lại): " + str(e)[:80])
    elif status == "FAILED":
        vj_update(jid, state="failed", msg="RunningHub báo làm video thất bại thật (đã quét lại xác nhận).", final=True)
    elif status in ("RUNNING", "QUEUED", "WAITING", "PENDING"):
        vj_update(jid, state="working", msg="RunningHub đang làm video" + (" (Motion Control báo lỗi nhưng RunningHub vẫn đang chạy)" if mc_failed else ""))
    else:
        vj_update(jid, state="checking", msg="Chưa rõ trạng thái từ RunningHub (%s), đang quét lại…" % status)


def vj_watch():
    while True:
        try:
            for rec in vj_read():
                if rec.get("state") in ("done",) or rec.get("final"):
                    continue
                try:
                    vj_check(rec)
                except Exception as e:
                    print(" (quét video lỗi nhẹ:", str(e)[:120], ")")
        except Exception:
            pass
        time.sleep(3)


def api_video_jobs(q, body):
    if body and body.get("do") == "cancel":
        # Dừng các video còn XẾP HÀNG (Motion Control chưa bắt đầu, nên chưa bắn API RunningHub, chưa tốn tiền). Việc đã chạy thì không dừng được.
        want = [body["id"]] if body.get("id") else [r["id"] for r in vj_read() if r.get("state") == "queued" and not r.get("final") and not r.get("rh")]
        pairs, late = [], 0
        for jid in want:
            rec = next((r for r in vj_read() if r.get("id") == jid), None)
            if not rec or rec.get("state") != "queued" or rec.get("rh"):
                late += 1
                continue
            try:
                req = urllib.request.Request("%s/api/cancel/%s" % (MC_URL, jid), data=b"", method="POST")
                with urllib.request.urlopen(req, timeout=15) as r:
                    r.read()
            except urllib.error.HTTPError as e:
                if e.code in (404, 405):  # Motion Control bản cũ chưa có lệnh dừng (404 hoặc 405)
                    raise ApiError("Motion Control chưa có lệnh dừng (cần cập nhật Motion Control một lần), chưa dừng được gì.")
                late += 1  # 409: việc này vừa bắt đầu chạy kịp trước khi dừng
                continue
            except Exception as e:
                raise ApiError("Không gọi được Motion Control để dừng: " + str(e)[:120])
            vj_update(jid, state="cancelled", final=True, msg="Đã dừng khi còn xếp hàng, chưa gửi RunningHub nên không tốn tiền")
            pairs.append(rec.get("pair"))
        return {"ok": True, "stopped": len(pairs), "pairs": pairs, "late": late}
    if body and body.get("do") in ("dismiss", "retry"):
        lst = vj_read()
        rec = next((r for r in lst if r.get("id") == body.get("id")), None)
        if not rec:
            raise ApiError("không thấy việc này")
        if body["do"] == "dismiss":
            if not (rec.get("state") == "done" or rec.get("final")):
                raise ApiError("việc này còn đang chạy, chưa bỏ khỏi danh sách được")
            with _vj_lock:
                jwrite("_video_jobs.json", [r for r in vj_read() if r.get("id") != rec["id"]])
            return {"ok": True}
        if not mc_state()["mc"]:
            raise ApiError("Motion Control chưa bật xong")
        if not rec.get("final"):
            raise ApiError("việc này chưa thất bại thật, chưa làm lại được")
        req = urllib.request.Request("%s/api/retry/%s" % (MC_URL, rec["id"]), data=b"", method="POST")
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                nid = json.loads(r.read().decode("utf-8")).get("jobId")
        except Exception as e:
            raise ApiError("làm lại không được: " + str(e)[:150])
        nr = dict(rec)
        nr.update({"id": nid, "created": int(time.time()), "state": "queued", "msg": "Làm lại: đã gửi sang Motion Control", "rh": "", "result_rel": "", "final": False})
        nr.pop("done_at", None)
        vj_add(nr)
        with _vj_lock:
            jwrite("_video_jobs.json", [r for r in vj_read() if r.get("id") != rec["id"]])
        return {"ok": True}
    lst = sorted(vj_read(), key=lambda r: -r.get("created", 0))[:80]
    return {"ok": True, "items": lst, "mc_ready": mc_state()["mc"], "now": int(time.time())}


def api_upload_loose(q, body, raw=None):
    """Tải tệp để THẲNG trong thư mục đang mở: ảnh vào kho model, video vào kho video mẫu (không biến thành thư mục sản phẩm)."""
    p = safe((q.get("path") or [""])[0])
    mroot, vroot = ROOT / D_MODEL, ROOT / D_VMAU
    in_m = p == mroot or mroot in p.parents
    in_v = p == vroot or vroot in p.parents
    in_c = p == ROOT / D_CAN   # thư mục "ảnh sản phẩm cần sếp xử lí": tải lên thành ảnh lẻ, sau đó chọn rồi bấm Mới để gom thành thẻ
    if not (in_m or in_v or in_c):
        raise ApiError("chỉ dùng cho kho model (ảnh), kho video mẫu (video) và thư mục ảnh sản phẩm cần xử lí")
    name = (q.get("name") or ["anh.jpg"])[0]
    ext = Path(name).suffix.lower()
    if in_v and ext not in VID_EXT:
        raise ApiError("kho video chỉ nhận video (mp4, mov, webm, m4v)")
    if (in_m or in_c) and ext not in IMG_EXT:
        raise ApiError("không phải ảnh")
    if not raw:
        raise ApiError("tệp rỗng")
    p.mkdir(parents=True, exist_ok=True)
    stem = re.sub(r"[^\w\- ]+", "_", Path(name).stem)[:60] or "model"
    dest = unique_dest(p, stem + ext)
    tmp = p / (".tai_" + dest.name + ".tmp")
    tmp.write_bytes(raw)
    os.replace(str(tmp), str(dest))
    return {"ok": True, "rel": rel_of(dest), "size": len(raw)}


def api_video_mau(q, body):
    return {"ok": True, "items": _vlist(D_VMAU1, "_video_mau.json")}


def api_video_out(q, body):
    return {"ok": True, "items": _vlist(D_VMAU2)}


def api_video_posted(q, body):
    """Bấm "Đã đăng": video từ 2 - VIDEO MOTION CONTROL ĐÃ XONG sang ĐÃ ĐĂNG. undo=True: lùi về chỗ cũ.
    Chỉ chuyển (không xóa), và chỉ chạm file video nằm đúng thư mục nguồn."""
    if (q.get("list") or [""])[0] or body.get("list"):
        return {"ok": True, "items": _vlist(D_POSTED)}
    undo = bool(body.get("undo"))
    src_dir, dst_dir = (ROOT / D_POSTED, ROOT / D_VMAU2) if undo else (ROOT / D_VMAU2, ROOT / D_POSTED)
    dst_dir.mkdir(parents=True, exist_ok=True)
    moved = []
    for rel in body.get("rels") or []:
        f = safe(rel)
        if f.parent != src_dir or not f.is_file() or f.suffix.lower() not in VID_EXT:
            continue
        dest = unique_dest(dst_dir, f.name)
        os.replace(str(f), str(dest))
        moved.append(rel_of(dest))
    if not moved:
        raise ApiError("không có video nào để chuyển (đã chuyển rồi hoặc không tìm thấy)")
    return {"ok": True, "moved": moved}


def api_video_mau_upload(q, body, raw=None):
    """Tiện ích Quang Vinh Pro tải video nhảy sếp ưng về kho: lưu vào 4 - KHO VIDEO MẪU / 1 - VIDEO MẪU."""
    name = (q.get("name") or ["video.mp4"])[0]
    ext = Path(name).suffix.lower()
    if ext not in VID_EXT:
        ext = ".mp4"
    if not raw:
        raise ApiError("tệp rỗng")
    d = ROOT / D_VMAU1
    d.mkdir(parents=True, exist_ok=True)
    stem = re.sub(r"[^\w\-]+", "_", Path(name).stem)[:60] or "video"
    old = d / (stem + ext)
    if old.exists() and old.stat().st_size == len(raw):  # video này đã có trong kho
        return {"ok": True, "dup": True, "rel": rel_of(old), "name": old.name, "size": len(raw)}
    dest = unique_dest(d, stem + ext)
    tmp = d / (".tai_" + dest.name + ".tmp")
    tmp.write_bytes(raw)
    os.replace(str(tmp), str(dest))
    meta = {}
    raw_meta = (q.get("meta") or ["{}"])[0]
    try:
        meta = json.loads(raw_meta)
    except Exception:
        try:
            meta = json.loads(urllib.parse.unquote(raw_meta))
        except Exception:
            meta = {}
    with _res_lock:
        m = jread("_video_mau.json", {})
        m[dest.name] = {k: str(meta.get(k, ""))[:300] for k in ("channel", "desc", "views", "link")}
        jwrite("_video_mau.json", m)
    return {"ok": True, "rel": rel_of(dest), "name": dest.name, "size": len(raw)}


def api_video(q, body):
    if body is not None:
        c = body.get("cfg") or {}
        df = c.get("defaults") or {}
        out = vid_default()
        out["defaults"] = {"duration": df.get("duration") if df.get("duration") in ("10", "15", "20") else "10",
                           "quality": df.get("quality") if df.get("quality") in ("lite", "pro") else "lite",
                           "bg": df.get("bg") if df.get("bg") in ("image", "video") else "image",
                           "people": df.get("people") if df.get("people") in ("1", "2") else "1"}
        for p in (c.get("pairs") or [])[:300]:
            out["pairs"].append({"id": str(p.get("id", ""))[:20], "img": str(p.get("img") or "")[:400], "vid": str(p.get("vid") or "")[:400],
                                 "duration": p.get("duration") if p.get("duration") in ("10", "15", "20") else None,
                                 "quality": p.get("quality") if p.get("quality") in ("lite", "pro") else None,
                                 "bg": p.get("bg") if p.get("bg") in ("image", "video") else None,
                                 "people": p.get("people") if p.get("people") in ("1", "2") else None})
        jwrite("_video.json", out)
        return {"ok": True}
    cfg = jread("_video.json", vid_default())
    ready = []
    for ln in ("1", "2"):
        try:
            for f in (ROOT / LANES[ln][1]).iterdir():
                if f.is_file() and f.suffix.lower() in IMG_EXT and not f.name.startswith("."):
                    ready.append({"name": f.name, "rel": rel_of(f), "t": int(f.stat().st_mtime), "size": f.stat().st_size, "people": int(ln)})
        except OSError:
            pass
    ready.sort(key=lambda x: -x["t"])
    return {"ok": True, "cfg": cfg, "ready": ready}


def api_video_upload(q, body, raw=None):
    """Tải ảnh / video từ máy (hoặc điện thoại) lên để dùng cho một cặp. Lưu trong _HE_THONG\\video_tai_len."""
    kind = (q.get("kind") or ["vid"])[0]
    name = (q.get("name") or ["tep"])[0]
    ext = Path(name).suffix.lower()
    if kind == "img" and ext not in IMG_EXT:
        raise ApiError("không phải ảnh")
    if kind != "img" and ext not in VID_EXT:
        raise ApiError("không phải video (nhận mp4, mov, webm, m4v)")
    if not raw:
        raise ApiError("tệp rỗng")
    d = SYSP / "video_tai_len"
    d.mkdir(parents=True, exist_ok=True)
    stem = re.sub(r"[^\w\-]+", "_", Path(name).stem)[:40] or "tep"
    dest = unique_dest(d, "%d_%s%s" % (int(time.time()), stem, ext))
    dest.write_bytes(raw)
    return {"ok": True, "rel": rel_of(dest), "size": len(raw)}


_bal_cache = [0.0, None]


def api_rh_balance(q, body):
    """Số RH còn lại thật trong tài khoản RunningHub (chỉ ĐỌC, không tốn tiền). Hỏi Motion Control trước (có luôn số tiền Việt), không được thì hỏi thẳng RunningHub."""
    if time.time() - _bal_cache[0] < 20 and _bal_cache[1]:
        return _bal_cache[1]
    out = {"ok": True, "rh": None, "vnd": None}
    try:
        d = _get_json(MC_URL + "/api/balance")
        if d.get("remain_rh") is not None:
            out["rh"], out["vnd"] = int(d["remain_rh"]), d.get("remain_vnd")
    except Exception:
        pass
    if out["rh"] is None:
        try:
            d = _post_json(RH_BASE + "/uc/openapi/accountStatus", {"apiKey": _rh_key()}, 10).get("data") or {}
            out["rh"] = int(d.get("remainCoins", 0))
        except Exception:
            pass
    if out["rh"] is not None:
        _bal_cache[0], _bal_cache[1] = time.time(), out
    return out


def api_estimate(q, body):
    """Hỏi Motion Control (nếu đang chạy) giá ước tính một video. Không chạy thì trả null."""
    dur = (q.get("duration") or ["10"])[0]
    qual = (q.get("quality") or ["lite"])[0]
    try:
        with urllib.request.urlopen("%s/api/estimate?duration=%s&quality=%s" % (MC_URL, quote(dur), quote(qual)), timeout=2) as r:
            return {"ok": True, "vnd": json.loads(r.read().decode("utf-8")).get("cost_vnd")}
    except Exception:
        return {"ok": True, "vnd": None}


def _locked_set():
    try:
        return set(jread("_model_lock.json", {}).get("locked") or [])
    except Exception:
        return set()


def model_entries_all(lane="1"):
    """Ảnh model của đường 1 người ("1"), 2 người ("2") hoặc cả hai ("both"), KỂ CẢ ảnh đang khóa. Mỗi ảnh kèm số người và trạng thái khóa."""
    lk = _locked_set()
    out = []
    for pl, d in (("1", D_MPICK1), ("2", D_MPICK2)):
        if lane not in (pl, "both"):
            continue
        base = ROOT.joinpath(*d.split("/"))
        for root, dirs, files in os.walk(base):
            dirs[:] = sorted([x for x in dirs if not x.startswith("_")], key=nat_key)
            for f in sorted(files, key=nat_key):
                if Path(f).suffix.lower() in IMG_EXT and not f.startswith("."):
                    rl = rel_of(Path(root) / f)
                    out.append({"rel": rl, "people": int(pl), "locked": rl in lk})
    return out


def model_entries(lane="1"):
    """Chỉ model đang MỞ khóa: đây là danh sách mà nút PHỐI ĐỒ NGAY được phép dùng (ổ khóa đóng = không dùng)."""
    return [e for e in model_entries_all(lane) if not e["locked"]]


def model_files(lane="1"):
    return [e["rel"] for e in model_entries(lane)]


def api_models(q, body):
    a1, a2 = model_entries_all("1"), model_entries_all("2")
    n1, n2 = sum(1 for e in a1 if not e["locked"]), sum(1 for e in a2 if not e["locked"])
    return {"ok": True, "n": n1 + n2, "n1": n1, "n2": n2, "t1": len(a1), "t2": len(a2)}


def api_model_all(q, body):
    """Danh sách model trong 1 MODEL / 2 MODEL (kèm ổ khóa) để hiện ở tab Phối đồ."""
    lane = (q.get("lane") or ["both"])[0]
    return {"ok": True, "items": model_entries_all(lane if lane in ("1", "2", "both") else "both")}


def api_model_store(q, body):
    """Toàn bộ ảnh trong "2 - TOÀN BỘ ẢNH MODEL" (kể cả thư mục con): cái kho để sếp chọn model sao chép sang 1 MODEL / 2 MODEL."""
    base = ROOT.joinpath(*D_MALL.split("/"))
    out = []
    for root, dirs, files in os.walk(base):
        dirs[:] = sorted([x for x in dirs if not x.startswith("_")], key=nat_key)
        for f in sorted(files, key=nat_key):
            if Path(f).suffix.lower() in IMG_EXT and not f.startswith("."):
                out.append({"rel": rel_of(Path(root) / f), "name": f})
    return {"ok": True, "items": out}


def api_model_lock(q, body):
    st = jread("_model_lock.json", {})
    lk = set(st.get("locked") or [])
    if body is None:
        return {"ok": True, "locked": sorted(lk)}
    for rel, v in (body.get("set") or {}).items():
        rel = str(rel)
        if not (rel + "/").startswith(D_MPICK + "/"):
            continue
        if v:
            lk.add(rel)
        else:
            lk.discard(rel)
    jwrite("_model_lock.json", {"locked": sorted(lk)})
    return {"ok": True, "locked": sorted(lk)}


def api_model_copy(q, body):
    """Sao chép (KHÔNG di chuyển) ảnh từ "2 - TOÀN BỘ ẢNH MODEL" sang 1 MODEL hoặc 2 MODEL, giữ nguyên file gốc 100% (không nén, không đổi gì)."""
    to = str(body.get("to") or "")
    if not ((to + "/").startswith(D_MPICK1 + "/") or (to + "/").startswith(D_MPICK2 + "/")):
        raise ApiError("Chỉ sao chép vào 1 MODEL hoặc 2 MODEL")
    dst = safe(to)
    dst.mkdir(parents=True, exist_ok=True)
    n = 0
    for rel in (body.get("from") or [])[:500]:
        src = safe(rel)
        if not rel_of(src).startswith(D_MALL + "/") or not src.is_file() or src.suffix.lower() not in IMG_EXT:
            continue
        shutil.copy2(str(src), str(unique_dest(dst, src.name)))
        n += 1
    return {"ok": True, "copied": n}


def api_phoi(q, body):
    """Bấm PHỐI ĐỒ NGAY: xếp một "đợt việc" (ảnh sản phẩm + cài đặt + model). Tiện ích Chrome trong tab Canvas
    hỏi mỗi 1-2 giây, thấy việc là tự thả ảnh vào app Phối Đồ rồi app chạy."""
    items = body.get("queue") or []
    if not items:
        raise ApiError("hàng phối đang trống")
    if not canvas_alive():
        raise ApiError(NOT_CONNECTED)
    models = None
    lane = body.get("lane") if body.get("lane") in ("1", "2", "both") else "1"
    if body.get("use_model"):
        models = model_entries(lane)
        if not models and model_entries_all(lane):
            raise ApiError("Tất cả model đang bị khóa. Bấm 2 lần vào nút 1 MODEL / 2 MODEL để mở khóa ít nhất một model, hoặc tắt nút dùng model.")
        if not models:
            where = {"1": "1 MODEL (ảnh 1 người)", "2": "2 MODEL (ảnh 2 người)", "both": "1 MODEL hoặc 2 MODEL"}[lane]
            raise ApiError("Thư mục KHO MODEL › LẤY MODEL NÀY › %s đang trống. Kéo ảnh model vào đó, hoặc tắt nút dùng model trong kho." % where)
    stamp = int(time.time()) % 1000
    jobs, n_img = [], 0
    phien = jread("_phien.json", {})
    for k, it in enumerate(items):
        rel0 = heal_rel(it.get("rel"), it.get("name"))
        if not rel0:
            raise ApiError("không tìm thấy sản phẩm \"%s\" trong kho (đã xóa?)" % (it.get("name") or it.get("rel")))
        p = safe(rel0)
        kind = it.get("kind") if it.get("kind") in KINDS else "top"
        ma_full = str(read_sp(p).get("ma", ""))
        ma = re.sub(r"\D", "", ma_full)[-19:]
        pid = _new_pid(ma if len(ma) >= 10 else str(int(time.time())), phien, k)
        files = ["%s/%s" % (rel_of(p), f) for f in (it.get("imgs") or []) if (p / f).is_file() and (p / f).suffix.lower() in IMG_EXT]
        if not files:
            raise ApiError("sản phẩm \"%s\" không có ảnh nào để gửi" % p.name)
        jobs.append({"pid": pid, "kind": kind, "name": p.name, "files": files})
        phien[pid] = {"rel": rel_of(p), "name": p.name, "kind": kind, "ma": ma_full, "imgs": [f.split("/")[-1] for f in files]}
        n_img += len(files)
    jwrite("_phien.json", phien)
    st = body.get("settings") or {}
    batch = {"bid": "%d%03d" % (int(time.time()), stamp), "t": int(time.time()), "status": "wait", "jobs": jobs, "models": models,
             "settings": phoi_settings(st, lane if body.get("use_model") else None), "once": bool(st) and st.get("mode", "always") != "always", "session": str(body.get("session", ""))[:40]}
    with _res_lock:
        qq = [b for b in jread("_viec_cho.json", []) if time.time() - b.get("t", 0) < 6 * 3600][-20:]
        qq.append(batch)
        jwrite("_viec_cho.json", qq)
    ensure_app_tab()
    alive = canvas_alive()
    return {"ok": True, "products": len(jobs), "images": n_img, "models": len(models or []), "canvas_alive": alive, "jobs": [j["pid"] for j in jobs]}


def api_job_next(q, body):
    """Tiện ích trong tab Canvas hỏi: có việc mới không? Nếu chưa có thì giữ máy tối đa `wait` giây, có việc là trả ngay."""
    try:
        wait = max(0.0, min(float((q.get("wait") or ["0"])[0] or 0), 25.0))
    except ValueError:
        wait = 0.0
    tab = (q.get("tab") or [""])[0]
    title = (q.get("title") or [""])[0][:60]
    fr = (q.get("fr") or [""])[0]
    try:
        area = int(float((q.get("area") or ["0"])[0] or 0))
    except ValueError:
        area = 0
    fkey = tab + ":" + fr
    deadline = time.time() + wait
    while True:
        _canvas_seen[0] = time.time()
        if tab:
            _canvas_tabs[tab] = {"title": title, "t": time.time()}
        if fr != "":
            _canvas_frames[fkey] = {"tab": tab, "area": area, "t": time.time()}
            alive = {k: v for k, v in _canvas_frames.items() if time.time() - v["t"] < 15}
            best = max(alive, key=lambda k: (alive[k]["area"], k)) if alive else fkey
            if best != fkey:  # khung này nhỏ hơn / đang ẩn: để khung đang hiện nhận việc
                if time.time() >= deadline:
                    return {"ok": True, "batch": None}
                time.sleep(0.3)
                continue
        got = None
        with _res_lock:
            qq = jread("_viec_cho.json", [])
            for b in qq:
                if b.get("status") == "wait" and time.time() - b.get("t", 0) > 300:
                    b["status"] = "expired"  # việc cũ quá 5 phút thì bỏ, tránh chạy ồ ạt khi tab Canvas nối lại muộn
            for b in qq:
                tg = b.get("target")
                if tg and tg != tab:  # việc tạo lại dành riêng cho 1 tab: tab khác bỏ qua, trừ khi tab đó đã biến mất
                    seen = _canvas_tabs.get(tg)
                    if seen and time.time() - seen["t"] < 15:
                        continue
                if b.get("status") == "wait":
                    b["status"] = "doing"
                    b["t_doing"] = int(time.time())
                    b["tab"] = tab
                    jwrite("_viec_cho.json", qq)
                    got = b
                    break
        if got:
            if tab:
                add_notice("Tab Chrome số %s (%s) vừa nhận việc phối đồ." % (tab, title))  # ngoài khóa: add_notice cũng cần khóa này
            return {"ok": True, "batch": got}
        if time.time() >= deadline:
            return {"ok": True, "batch": None}
        time.sleep(0.3)


def api_job_done(q, body):
    with _res_lock:
        qq = jread("_viec_cho.json", [])
        for b in qq:
            if b.get("bid") == body.get("bid"):
                b["status"] = "sent" if body.get("ok") else "error"
                b["note"] = str(body.get("note", ""))[:200]
        jwrite("_viec_cho.json", qq)
    return {"ok": True}


def _pid_done():
    d = jread("_pid_done.json", {})
    if isinstance(d, list):  # bản cũ lưu danh sách
        d = {k: 0 for k in d}
    return d


def api_notice(q, body):
    text = str(body.get("text", ""))
    add_notice(text)
    if text.startswith("📥"):
        with _res_lock:
            a = jread("_pid_ack.json", {})
            for pidx in re.findall(r"\d{10,25}", text):
                a[pidx] = int(time.time())
            jwrite("_pid_ack.json", dict(sorted(a.items(), key=lambda kv: kv[1])[-300:]))
    m = re.search(r"(?:✅|⚠️|❌) Mã (\d+)", text)
    if m:
        with _res_lock:
            d = _pid_done()
            d[m.group(1)] = int(time.time())
            jwrite("_pid_done.json", dict(sorted(d.items(), key=lambda kv: kv[1])[-300:]))
    return {"ok": True}


def _bump_usage(rec):
    """Một đợt phối của sản phẩm vừa có ảnh kết quả đầu tiên về: mỗi ảnh nguồn đã gửi được tính thêm 1 lần "đã dùng thành công".
    Lưu ngay trong _sp.json của sản phẩm (đi theo thư mục khi chuyển / đổi tên)."""
    try:
        pp = safe(rec.get("rel", ""))
        if not is_product(pp):
            return
        sp = read_sp(pp)
        dung = dict(sp.get("dung") or {})
        for f in rec.get("imgs") or []:
            dung[f] = int(dung.get(f, 0)) + 1
        sp["dung"] = dung
        if sp.get("state", "new") in ("new", "pick"):  # đã có ảnh phối thành công về tab Duyệt -> nhãn "Đã phối" (Bỏ / Cất giữ nguyên)
            sp["state"] = "used"
        write_sp(pp, sp)
    except Exception:
        pass


def api_receive(q, body, raw=None):
    """Tiện ích đưa ảnh phối xong (nguyên bản) từ app Phối Đồ về thư mục MỚI PHỐI LUÔN SẾP!!"""
    pid = re.sub(r"\D", "", (q.get("pid") or [""])[0])
    try:
        idx = int((q.get("idx") or ["1"])[0])
    except ValueError:
        idx = 1
    ext = (q.get("ext") or [".png"])[0].lower()
    if ext not in (".png", ".jpg", ".jpeg", ".webp"):
        ext = ".png"
    if not pid or not raw:
        raise ApiError("thiếu mã hoặc ảnh rỗng")
    sha = (q.get("sha") or [""])[0]
    if sha and hashlib.sha256(raw).hexdigest()[:8] != sha:
        raise ApiError("ảnh nhận về bị lỗi (không khớp mã kiểm tra)")
    d = ROOT / LANES[lane_of((q.get("people") or ["1"])[0])][0]
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / (".nhan_%s_%d.tmp" % (pid, idx))
    tmp.write_bytes(raw)
    final = d / ("%s__%d%s" % (pid, idx, ext))
    os.replace(str(tmp), str(final))
    tab = (q.get("tab") or [""])[0]
    with _res_lock:
        ph = jread("_phien.json", {})
        rec = ph.get(pid)
        if rec is not None:
            changed = False
            if tab:  # nhớ tab Canvas nào đã tạo ảnh này, để "Tạo lại" gửi đúng tab đó (đúng thẻ còn nằm trong app đó)
                rec["tab"] = tab
                changed = True
            if rec.get("imgs") and not rec.get("counted"):  # ảnh kết quả đầu tiên của đợt đã về: tính 1 lần dùng cho từng ảnh nguồn (chỉ tính 1 lần / đợt)
                _bump_usage(rec)
                rec["counted"] = True
                changed = True
            if changed:
                jwrite("_phien.json", ph)
    def _warm(fp=final):   # tạo sẵn bản 300px và 1400px (điện thoại xem ở 2 cỡ này) để mở ảnh là nét ngay, không đợi laptop xử lý ảnh gốc
        try:
            sp = safe(rel_of(fp))
            for w in (300, 1400):
                thumb_bytes(sp, w)
        except Exception:
            pass
    threading.Thread(target=_warm, daemon=True).start()
    return {"ok": True, "file": final.name, "size": len(raw)}


def prod_thumb(pr):
    try:
        if pr:
            pp = safe(pr)
            if is_product(pp):
                ims = images_in(pp)
                ch = [c for c in (read_sp(pp).get("chon") or []) if c in ims]
                if ch or ims:
                    return rel_of(pp) + "/" + (ch or ims)[0]
    except ApiError:
        pass
    return ""


def count_results(pid, lane=None):
    n = 0
    for d in (LANES["1"] + LANES["2"] if lane is None else LANES[lane]):
        try:
            n += sum(1 for f in (ROOT / d).iterdir() if f.name.startswith(pid + "__") and f.suffix.lower() in IMG_EXT)
        except OSError:
            pass
    return n


def count_new(lane):
    try:
        return sum(1 for f in (ROOT / LANES[lane][0]).iterdir() if f.is_file() and not f.name.startswith(".") and f.suffix.lower() in IMG_EXT)
    except OSError:
        return 0


def scan_new(lane="1"):
    d = ROOT / LANES[lane][0]
    items, now = [], time.time()
    phien = jread("_phien.json", {})
    try:
        files = sorted(d.iterdir(), key=lambda x: nat_key(x.name))
    except Exception:
        files = []
    for f in files:
        if not f.is_file() or f.name.startswith(".") or f.suffix.lower() not in IMG_EXT:
            continue
        st = f.stat()
        if now - st.st_mtime < 1.0:
            continue
        m = re.match(r"^(\d+)__(\d+)", f.stem)
        pid, idx = (m.group(1), int(m.group(2))) if m else ("", 0)
        ph = phien.get(pid, {})
        thumb = ""
        pr = ph.get("rel", "")
        if pr:
            try:
                pp = safe(pr)
                if is_product(pp):
                    ims = images_in(pp)
                    ch = [c for c in (read_sp(pp).get("chon") or []) if c in ims]
                    if ch or ims:
                        thumb = rel_of(pp) + "/" + (ch or ims)[0]
            except ApiError:
                pass
        items.append({"id": f.name, "rel": rel_of(f), "lane": lane, "name": ph.get("name") or f.stem, "pid": pid, "idx": idx,
                      "kind": ph.get("kind", "top"), "prod": ph.get("rel", ""), "ma": ph.get("ma", ""), "thumb": thumb,
                      "t": int(st.st_mtime), "size": st.st_size})
    items.sort(key=lambda x: -x["t"])
    return items


def api_results(q, body):
    lane = lane_of((q.get("lane") or ["1"])[0])
    waiting = [b for b in jread("_viec_cho.json", []) if b.get("status") in ("wait", "doing") and time.time() - b.get("t", 0) < 3600]
    done_map = _pid_done()
    done = set(done_map)
    acks = jread("_pid_ack.json", {})
    running = []
    phien = jread("_phien.json", {})
    now = time.time()
    alive_now = canvas_alive()
    changed = False
    with _res_lock:
        allb = jread("_viec_cho.json", [])
        for b in allb:
            if b.get("status") not in ("wait", "doing", "sent", "dead") or now - b.get("t", 0) > 20 * 60:
                continue
            deads = b.setdefault("dead", {})
            mods = b.get("models") or []
            try:
                thr = int(((b.get("settings") or {}).get("sel") or {}).get("outfitThreads") or 3)
            except (TypeError, ValueError):
                thr = 3
            thr = max(1, min(thr, 12))
            doing_age = now - b.get("t_doing", b.get("t", 0))
            # ---- số ảnh mong đợi / đã có của từng mã trong đợt, theo đúng thứ tự app phối
            info = []
            for j in b.get("jobs", []):
                nf = max(1, len(j.get("files", [])))
                n2 = sum(1 for e in mods if isinstance(e, dict) and e.get("people") == 2)
                n1 = (len(mods) - n2) if mods else 1
                exp1, exp2 = nf * n1, nf * n2
                exp = exp1 + exp2
                got = count_results(j["pid"])
                got1, got2 = count_results(j["pid"], "1"), count_results(j["pid"], "2")
                fin = j["pid"] in done
                if j.get("redo"):
                    exp, got = 1, (1 if fin else 0)
                    rl = lane_of((j["redo"] or {}).get("lane", "1"))
                    exp1, exp2 = (1, 0) if rl == "1" else (0, 1)
                    got1, got2 = (got, 0) if rl == "1" else (0, got)
                info.append({"j": j, "fin": fin, "exp": exp, "got": exp if fin else min(got, exp), "exp1": exp1, "exp2": exp2,
                             "got1": exp1 if fin else min(got1, exp1), "got2": exp2 if fin else min(got2, exp2)})
            done_total = sum(x["got"] for x in info)
            pos = 0
            for x in info:
                j, pid = x["j"], x["j"]["pid"]
                x["s"], x["e"] = pos, pos + x["exp"]
                pos += x["exp"]
                if x["fin"] or pid in deads:
                    continue
                # ---- việc này có chạy được không? Không thì báo đỏ, mười giây sau tự xóa
                reason = ""
                if b.get("status") == "wait":
                    if not alive_now and now - b.get("t", 0) > (90 if now - _app_open_at[0] < 120 else 25):   # vừa tự mở tab app thì cho thêm thời gian để app nối
                        reason = "Chưa nối được app Phối Đồ (tab Canvas chưa mở hoặc đã mất kết nối)."
                elif pid not in acks and doing_age > 60:
                    reason = "App Phối Đồ không xác nhận đã nhận việc (có thể là bản cũ hoặc bị treo)."
                elif not alive_now and now - _canvas_seen[0] > 30:
                    reason = "App Phối Đồ bị ngắt kết nối giữa chừng (tải lại tiện ích hoặc F5 tab Canvas)."
                elif pid in acks and x["got"] == 0 and doing_age > 600:
                    reason = "Đã nhận việc hơn 10 phút mà chưa ra ảnh nào."
                if reason:
                    deads[pid] = {"t": int(now), "reason": reason}
                    changed = True
            if b.get("status") in ("wait", "doing", "sent") and any(not x["fin"] for x in info) and all(x["fin"] or x["j"]["pid"] in deads for x in info):
                b["status"] = "dead"
                changed = True
            for x in info:
                j, pid = x["j"], x["j"]["pid"]
                fin = x["fin"]
                if fin and now - done_map.get(pid, 0) > 20:
                    continue  # xong hơn 20 giây thì thôi hiện thanh tiến độ
                ph = phien.get(pid, {})
                dd = deads.get(pid)
                if dd and now - dd["t"] > 10:
                    continue  # báo đỏ đủ 10 giây thì tự xóa
                if b.get("status") not in ("wait", "doing", "sent", "dead") and not dd:
                    continue
                fly = 0
                if fin:
                    phase = "done"
                elif dd:
                    phase = "dead"
                elif b.get("status") == "wait":
                    phase = "wait"
                elif pid not in acks:
                    phase = "given"
                else:
                    lo = max(x["s"] + x["got"], done_total)
                    fly = max(0, min(x["e"], done_total + thr) - lo)   # chỉ những ảnh nằm trong "cửa sổ đang chạy" (số luồng của app) mới thật sự xoay
                    phase = "run" if fly > 0 else "wait"
                running.append({"pid": pid, "name": j.get("name", ""), "state": "done" if fin else ("dead" if dd else ("wait" if b.get("status") == "wait" else "run")),
                                "phase": phase, "fly": fly, "reason": (dd or {}).get("reason", ""), "dead_in": max(0, 10 - int(now - dd["t"])) if dd else 0,
                                "since": b.get("t", 0), "ma": ph.get("ma", ""), "prod": ph.get("rel", ""), "thumb": prod_thumb(ph.get("rel", "")),
                                "expected": x["exp"], "got": x["got"], "acked": pid in acks,
                                "exp1": x["exp1"], "exp2": x["exp2"], "got1": x["got1"], "got2": x["got2"],
                                "given_age": int(now - b.get("t_doing", b.get("t", 0))) if b.get("status") != "wait" else 0})
        if changed:
            jwrite("_viec_cho.json", allb)
    return {"ok": True, "running": running, "lane": lane, "items": scan_new(lane), "counts": {"1": count_new("1"), "2": count_new("2")},
            "n_video": len(images_in(ROOT / LANES[lane][1])), "n_used": len(images_in(ROOT / LANES[lane][2])),
            "n_video_all": len(images_in(ROOT / LANES["1"][1])) + len(images_in(ROOT / LANES["2"][1])),
            "notices": jread("_thong_bao.json", [])[-12:], "waiting": len(waiting),
            "tabs": [{"id": k, "title": v["title"]} for k, v in _canvas_tabs.items() if time.time() - v["t"] < 15],
            "frames": len([1 for v in _canvas_frames.values() if time.time() - v["t"] < 15]),
            "canvas_alive": canvas_alive()}


def enqueue_redo(items, settings, use_model, lane="1"):
    """Tạo lại = nhờ app bấm nút "Tạo lại" của ĐÚNG thẻ đó (ảnh mới thay ngay trong ô cũ, cùng sản phẩm + cùng model).
    Nếu app không còn thẻ đó (đã F5...) thì app tự làm như một lần phối mới (kèm sẵn ảnh sản phẩm để dự phòng)."""
    phien = jread("_phien.json", {})
    models = None
    if use_model:
        models = model_entries(lane) or None
    jobs, stamp = [], int(time.time()) % 1000
    for k, it in enumerate(items):
        ph = it["ph"]
        rel = ph.get("rel", "")
        try:
            if not (rel and is_product(safe(rel))):
                rel = find_by_ma(ph.get("ma")) or ""
        except ApiError:
            rel = ""
        files = []
        if rel:
            p = safe(rel)
            ims = images_in(p)
            ch = [c for c in (read_sp(p).get("chon") or []) if c in ims] or ims[:1]
            files = ["%s/%s" % (rel_of(p), f) for f in ch[:1]]
        base = re.sub(r"\D", "", str(ph.get("ma", "")))[-19:]
        if len(base) < 10:
            base = it["pid"][:19]
        rid = _new_pid(base, phien, k)
        phien[rid] = {"rel": rel or ph.get("rel", ""), "name": ph.get("name", ""), "kind": ph.get("kind", "top"), "ma": ph.get("ma", "")}
        jobs.append({"pid": rid, "kind": ph.get("kind", "top"), "name": ph.get("name", ""), "files": files, "redo": {"pid": it["pid"], "idx": it["idx"], "lane": lane}})
    jwrite("_phien.json", phien)
    st = settings or {}
    batch = {"bid": "%d%03d" % (int(time.time()), stamp), "t": int(time.time()), "status": "wait", "jobs": jobs, "models": models,
             "settings": phoi_settings(st, lane if use_model else None), "once": bool(st) and st.get("mode", "always") != "always"}
    tabs = {str(phien.get(it["pid"], {}).get("tab", "")) for it in items} - {""}
    if len(tabs) == 1:
        batch["target"] = tabs.pop()  # chỉ tab Canvas đã tạo ảnh cũ mới nhận việc tạo lại (nó mới có đúng thẻ đó)
    with _res_lock:
        qq = [b for b in jread("_viec_cho.json", []) if time.time() - b.get("t", 0) < 6 * 3600][-20:]
        qq.append(batch)
        jwrite("_viec_cho.json", qq)
    ensure_app_tab()
    return len(jobs)


def api_result_do(q, body):
    """Duyệt (sang CHỜ LÀM VIDEO) / Bỏ (xóa hẳn) / Tạo lại (xóa hẳn + phối lại sản phẩm đó)."""
    act, ids = body.get("action"), body.get("ids") or []
    if act not in ("ok", "drop", "redo"):
        raise ApiError("lệnh không hợp lệ")
    if act == "redo" and not canvas_alive():
        raise ApiError(NOT_CONNECTED)  # kiểm tra TRƯỚC khi xóa ảnh cũ, để không mất ảnh mà không tạo lại được
    lane = lane_of(body.get("lane", "1"))
    dnew, dvid = ROOT / LANES[lane][0], ROOT / LANES[lane][1]
    dvid.mkdir(parents=True, exist_ok=True)
    moved, dropped, redo_items = [], 0, []
    phien = jread("_phien.json", {})
    for name in ids:
        f = dnew / Path(str(name)).name
        if not f.is_file():
            continue
        if act == "ok":
            d = unique_dest(dvid, f.name)
            shutil.move(str(f), str(d))
            moved.append({"from": f.name, "to": d.name})
        else:
            m = re.match(r"^(\d+)__", f.name)
            ph = phien.get(m.group(1), {}) if m else {}
            try:
                f.unlink()
            except OSError as e:
                raise ApiError(_busy_msg(e))
            dropped += 1
            if act == "redo" and ph:
                mi = re.match(r"^(\d+)__(\d+)", f.name)
                redo_items.append({"ph": ph, "pid": m.group(1), "idx": int(mi.group(2)) if mi else 1})
    res = {"ok": True, "moved": moved, "dropped": dropped, "redo": 0}
    if redo_items:
        res["redo"] = enqueue_redo(redo_items, body.get("settings"), body.get("use_model"), lane)
    return res


def api_result_move(q, body):
    """Dùng cho Lùi/Tới: chuyển tên file giữa MỚI PHỐI LUÔN SẾP!! và CHỜ LÀM VIDEO NÈ SẾP."""
    lane = lane_of(body.get("lane", "1"))
    src = ROOT / (LANES[lane][1] if body.get("from") == "vid" else LANES[lane][0])
    dst = ROOT / (LANES[lane][1] if body.get("to") == "vid" else LANES[lane][0])
    dst.mkdir(parents=True, exist_ok=True)
    out = []
    for name in body.get("names") or []:
        f = src / Path(str(name)).name
        if f.is_file():
            d = unique_dest(dst, f.name)
            shutil.move(str(f), str(d))
            out.append({"from": f.name, "to": d.name})
    return {"ok": True, "moved": out}


def _job_stale(job):
    """Lệnh quét treo (tiện ích mất liên lạc / bị tắt giữa chừng) thì tự kết thúc để nút quay về "Chạy ngay", không kẹt chữ "Dừng" mãi.
    Trả về True nếu vừa đánh dấu kết thúc."""
    if not job or job.get("status") not in ("wait", "run"):
        return False
    now = time.time()
    if job.get("stop") and now - job.get("t_stop", now) > 20:
        job["status"], job["msg"] = "error", "Đã dừng"
        return True
    base = max(job.get("t2") or job.get("t") or 0, job.get("nb") or 0)
    if job["status"] == "wait" and now - base > 90:
        job["status"], job["msg"] = "error", "Tiện ích không nhận lệnh (Chrome KÊNH DÉP có đang chạy và đã bật tiện ích chưa?)"
        return True
    if job["status"] == "run" and now - base > 180:
        job["status"], job["msg"] = "error", "Mất liên lạc với tiện ích (3 phút không có tiến độ mới), lệnh đã tự kết thúc. Bấm chạy lại nếu cần."
        return True
    return False


def api_doithu(q, body):
    """Cầu nối panel <-> tiện ích "quét đối thủ theo view": tiện ích đẩy bảng clip (đã thu gọn) và tiến độ về đây, panel bấm "Quét view ngay" thì tiện ích chạy phiên quét."""
    with _res_lock:
        st = jread("_doithu.json", {"rows": [], "av": {}, "at": 0, "job": None})
        if body is None:
            if _job_stale(st.get("job")):
                jwrite("_doithu.json", st)
            out = {"ok": True, "job": st.get("job"), "at": st.get("at", 0), "n": len(st.get("rows") or []), "cfg": st.get("cfg"), "nt": len(st.get("trash") or []), "cmds": st.get("cmds") or []}
            if (q.get("data") or [""])[0]:
                out["rows"], out["av"], out["trash"] = st.get("rows") or [], st.get("av") or {}, st.get("trash") or []
            return out
        job = st.get("job")
        alive = lambda j: j and j.get("status") in ("wait", "run") and time.time() - (j.get("t2") or j.get("t") or 0) < 1800
        if body.get("scan"):
            if alive(job):
                return {"ok": False, "error": "Đang có một phiên quét chạy, đợi xong hoặc bấm Dừng"}
            if not ((st.get("cfg") or {}).get("profiles")):
                return {"ok": False, "error": "Chưa nhập danh sách kênh để quét"}
            threading.Thread(target=ensure_chrome_for_job, daemon=True).start()
            job = {"status": "wait", "msg": "Đang chờ tiện ích nhận lệnh…", "pct": 0, "t": int(time.time()), "set": st.get("cfg")}
        elif body.get("cfg") is not None:  # danh sách kênh + cài đặt quét: lưu ở laptop để điện thoại và máy tính dùng chung
            c = body["cfg"]
            seen, profs = set(), []
            for x in (c.get("profiles") or []):
                u = str(x).strip().lstrip("@")
                if re.fullmatch(r"[\w.]{1,60}", u) and u.lower() not in seen:
                    seen.add(u.lower())
                    profs.append(u)
            ok_d = lambda v: bool(re.fullmatch(r"\d{4}-\d\d-\d\d", str(v or "")))
            st["cfg"] = {"profiles": profs[:300], "days": max(0, min(int(c.get("days") or 0), 365)), "from": str(c.get("from")) if ok_d(c.get("from")) else "", "to": str(c.get("to")) if ok_d(c.get("to")) else "",
                         "thr": max(0, min(int(c.get("thr") or 0), 10**9)), "auto": int(c.get("auto") or 0) if int(c.get("auto") or 0) in (0, 3, 6, 12, 24) else 0}
        elif body.get("stop"):
            if job and job.get("status") in ("wait", "run"):
                job["stop"] = True
                job["t_stop"] = int(time.time())
                job["msg"] = "Đang dừng…"
                if job["status"] == "wait":
                    job["status"] = "error"
                    job["msg"] = "Đã hủy trước khi chạy"
        elif body.get("progress") and job:
            p = body["progress"]
            for k in ("status", "msg", "pct"):
                if k in p:
                    job[k] = p[k]
            job["t2"] = int(time.time())
        elif body.get("put"):
            p = body["put"]
            rows = (p.get("rows") or [])[:2500]
            # lệnh xóa chưa được tiện ích áp dụng thì chưa cho dữ liệu cũ "sống lại"
            gone, chans, nuke = set(), set(), False
            for c in (st.get("cmds") or []):
                if c.get("op") in ("trash", "purge"):
                    gone |= set(c.get("ids") or [])
                elif c.get("op") == "chan":
                    chans.add(c.get("ch"))
                elif c.get("op") == "all":
                    nuke = True
            st["rows"] = [] if nuke else [r for r in rows if r.get("i") not in gone and r.get("ch") not in chans]
            st["av"] = p.get("av") or {}
            st["at"] = int(time.time())
        elif body.get("trash") or body.get("restore") or body.get("purge") or body.get("delchan") or body.get("delall"):
            rows, trash, cmds = st.get("rows") or [], st.get("trash") or [], st.get("cmds") or []
            seq = int(st.get("seq") or 0) + 1
            ids = lambda k: set(str(x) for x in (body.get(k) or {}).get("ids") or [])
            if body.get("trash"):  # đưa clip vào thùng rác (có thể khôi phục)
                g = ids("trash")
                trash = [r for r in rows if r.get("i") in g] + trash
                rows = [r for r in rows if r.get("i") not in g]
                cmds.append({"n": seq, "op": "trash", "ids": sorted(g)})
            elif body.get("restore"):
                g = ids("restore")
                rows = [r for r in trash if r.get("i") in g] + rows
                trash = [r for r in trash if r.get("i") not in g]
                cmds.append({"n": seq, "op": "restore", "ids": sorted(g)})
            elif body.get("purge"):  # xóa vĩnh viễn clip trong thùng rác
                g = ids("purge")
                trash = [r for r in trash if r.get("i") not in g]
                rows = [r for r in rows if r.get("i") not in g]
                cmds.append({"n": seq, "op": "purge", "ids": sorted(g)})
            elif body.get("delchan"):  # xóa vĩnh viễn mọi dữ liệu của riêng một kênh (cả trong thùng rác)
                ch = str(body["delchan"])
                rows = [r for r in rows if r.get("ch") != ch]
                trash = [r for r in trash if r.get("ch") != ch]
                (st.get("av") or {}).pop(ch, None)
                cmds.append({"n": seq, "op": "chan", "ch": ch})
            elif body.get("delall"):  # xóa vĩnh viễn dữ liệu của TẤT CẢ các kênh
                rows, trash, st["av"] = [], [], {}
                cmds = [{"n": seq, "op": "all"}]
            st["rows"], st["trash"], st["cmds"], st["seq"] = rows, trash, cmds[-200:], seq
        elif body.get("ack") is not None:
            st["cmds"] = [c for c in (st.get("cmds") or []) if c.get("n", 0) > int(body["ack"])]
        elif body.get("wipe"):
            st["rows"], st["av"], st["at"], job = [], {}, 0, None
        st["job"] = job
        jwrite("_doithu.json", st)
        return {"ok": True, "job": job}


def _chrome_exe():
    for c in (r"C:\Program Files\Google\Chrome\Application\chrome.exe", r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
              os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe")):
        if os.path.isfile(c):
            return c
    return None


def ensure_chrome_for_job():
    """Sếp bấm Chạy ngay (Kalodata / Quét view): nếu tiện ích Chrome KHÔNG còn báo về (Chrome đã tắt, hoặc chưa mở profile KÊNH DÉP)
    thì bật ngay Chrome đúng profile cố định. Chrome còn chạy (kể cả thu nhỏ bằng nút _) thì tiện ích tự phóng cửa sổ lên và mở tab mới."""
    try:
        restore_chrome_windows()   # Chrome đang thu nhỏ (nút _) thì phóng lên trước
        if time.time() - _ext_seen[0] < 45:
            return
        prof = chrome_launch(["http://localhost:%d/?key=%s" % (PORT, KEY)])
        print(" Tiện ích chưa báo về: đã bật Chrome (profile %s) để nhận lệnh quét." % prof)
    except Exception as e:
        print(" (Không bật được Chrome:", e, ")")


def _knum(t):
    """'₫9,06tr' / '₫10,16k' / '₫1,2tỉ' -> số (đồng). Giống hàm kNum bên bảng điều khiển."""
    t = str(t or "").lower().replace("₫", "").replace(" ", "")
    m = re.match(r"^([\d.,]+)(k|tr|ti|tỉ|tỷ|m|b)?$", t)
    if not m:
        return 0
    n = m.group(1)
    if "," in n and "." in n:
        n = n.replace(".", "").replace(",", ".")
    elif "," in n:
        n = n.replace(",", ".")
    elif n.count(".") > 1:
        n = n.replace(".", "")
    try:
        v = float(n)
    except ValueError:
        return 0
    return v * {"k": 1e3, "tr": 1e6, "m": 1e6, "ti": 1e9, "tỉ": 1e9, "tỷ": 1e9, "b": 1e9}.get(m.group(2) or "", 1)


def _kalo_hist(old_hist, ranges):
    """Lịch sử các lần quét theo từng khoảng ngày: 'first' = mốc Lần đầu (cố định), 'recent' = tối đa 4 lần quét sau đó.
    Mỗi lần chụp: p[id] = [doanh thu, đã bán, hạng], v[id] = [doanh thu, lượt xem, hạng]. Quét lại trong cùng một ngày thì thay bản chụp cùng ngày; dữ liệu y hệt lần trước thì bỏ qua."""
    hist = dict(old_hist or {})
    today = int(time.strftime("%Y%m%d"))
    for rk, rd in (ranges or {}).items():
        if not isinstance(rd, dict):
            continue
        prods = {str(r["id"]): [int(_knum(r.get("rv"))), int(_knum(r.get("sd"))), int(r.get("k") or 0)] for r in (rd.get("products") or []) if isinstance(r, dict) and r.get("id")}
        vids = {str(r["id"]): [int(_knum(r.get("rv"))), int(_knum(r.get("vw"))), int(r.get("k") or 0)] for r in (rd.get("videos") or []) if isinstance(r, dict) and r.get("id")}
        if not prods and not vids:
            continue
        snap = {"t": int(time.time()), "d": today, "dtx": str(rd.get("dtx") or "")[:40], "p": prods, "v": vids}
        h0 = hist.get(rk) or {"first": None, "recent": []}
        rec = list(h0.get("recent") or [])
        last = rec[-1] if rec else h0.get("first")
        same = lambda a, b: a and b and {k: x[0] for k, x in (a.get("p") or {}).items()} == {k: x[0] for k, x in (b.get("p") or {}).items()} and {k: x[0] for k, x in (a.get("v") or {}).items()} == {k: x[0] for k, x in (b.get("v") or {}).items()}
        if not h0.get("first"):
            h0["first"] = snap
        elif same(last, snap):
            pass   # dữ liệu y hệt lần chụp trước: không chụp thêm
        elif last and last.get("d") == today and last.get("dtx") == snap["dtx"]:
            if rec:
                rec[-1] = snap
            else:
                h0["first"] = snap
        else:
            rec.append(snap)
        h0["recent"] = rec[-4:]
        hist[rk] = h0
    return hist


def _rival_av():
    """Ảnh đại diện các kênh đã có ở tab Quét view (khóa không có dấu @)."""
    try:
        return (json.loads(jfile("_doithu.json").read_text(encoding="utf-8")) or {}).get("av") or {}
    except Exception:
        return {}


def api_kalo(q, body):
    """Cầu nối panel <-> tiện ích quét Kalodata. job = lệnh chạy (wait/run/done/error), data = kết quả đã thu gọn theo từng kênh."""
    with _res_lock:
        st = jread("_kalo.json", {"job": None, "data": {}})
        if body is None:
            _j = st.get("job")
            if _j and _j.get("stop") and _j.get("status") in ("wait", "run") and time.time() - float(_j.get("t_stop") or time.time()) > 15:
                _j["status"], _j["msg"] = "done", "Đã dừng (đã ngắt lượt quét; tiện ích nào còn chạy dở sẽ tự thôi ở bước kế)"
                jwrite("_kalo.json", st)
            out = {"ok": True, "job": st.get("job"), "cfg": st.get("cfg")}
            if (q.get("data") or [""])[0]:
                out["data"] = st.get("data") or {}
                rv = _rival_av()   # kênh nào cũng có bên Quét view thì lấy ảnh đại diện bên đó lắp sang, khỏi lấy trên Kalodata
                for _h, _d in out["data"].items():
                    a = rv.get(str(_h).lstrip("@"))
                    if a and isinstance(_d, dict):
                        _d["av"] = a
            else:
                out["chans"] = {h: {"t": (d or {}).get("t", 0), "ranges": sorted(((d or {}).get("ranges") or {}).keys())} for h, d in (st.get("data") or {}).items()}
            return out
        job = st.get("job")
        if body.get("job"):  # panel bấm "Chạy ngay"
            j = body["job"]
            links = [str(x).strip() for x in (j.get("links") or [j.get("link")]) if str(x or "").strip()][:20]
            if not links or any("kalodata.com" not in x for x in links):
                return {"ok": False, "error": "Link không phải của Kalodata"}
            link = links[0]
            if job and job.get("status") in ("wait", "run") and time.time() - (job.get("t2") or job.get("t") or 0) < 150:
                return {"ok": False, "error": "Đang có một lượt quét chạy - đợi xong hoặc bấm Dừng"}
            rg = [x for x in (j.get("ranges") or []) if x in ("Hôm qua", "7 ngày trước", "30 ngày trước")]
            cu = j.get("custom") or None
            if cu:  # Kalodata chỉ cho chọn từ 30 ngày trước tới HÔM QUA (hôm nay chưa có số liệu)
                import datetime as _dt
                try:
                    a, b = _dt.date.fromisoformat(str(cu.get("from"))), _dt.date.fromisoformat(str(cu.get("to")))
                except Exception:
                    return {"ok": False, "error": "Ngày tự chọn không hợp lệ"}
                today = _dt.date.today()
                lo, hi = today - _dt.timedelta(days=30), today - _dt.timedelta(days=1)
                if a > b or a < lo or b > hi:
                    return {"ok": False, "error": "Kalodata chỉ cho chọn từ %s đến %s" % (lo.strftime("%d/%m"), hi.strftime("%d/%m"))}
                cu = {"from": a.isoformat(), "to": b.isoformat()}
            if not rg and not cu:
                rg = ["7 ngày trước"]
            threading.Thread(target=ensure_chrome_for_job, daemon=True).start()
            job = {"link": link, "links": links, "idx": 0, "res": [], "ranges": rg, "custom": cu, "fresh": bool(j.get("fresh", True)), "max": 400,
                   "status": "wait", "msg": "Đang chờ tiện ích nhận lệnh…", "pct": 0, "t": int(time.time())}
        elif body.get("stop"):
            if job and job.get("status") in ("wait", "run") and time.time() - (job.get("t2") or job.get("t") or 0) >= 150:
                job["status"] = "error"
                job["msg"] = "Lượt quét bị treo (tab Kalodata đã đóng?) - đã hủy"
            elif job and job.get("status") in ("wait", "run"):
                job["stop"] = True
                job["t_stop"] = int(time.time())
                job["msg"] = "Đang dừng…"
                if job["status"] == "wait":
                    job["status"] = "error"
                    job["msg"] = "Đã hủy trước khi chạy"
        elif body.get("jobdbg") and job:  # tiện ích gửi ảnh chụp tình trạng trang khi quét bị đứng (để biết vì sao)
            job["dbg"] = body["jobdbg"]
        elif body.get("progress") and job and job.get("stop") and job.get("status") in ("done", "error"):
            pass  # lượt này đã được dừng xong: báo tiến độ muộn của tiện ích không được làm nó "sống lại"
        elif body.get("progress") and job and (body["progress"] or {}).get("stale"):  # Kalodata chưa sang ngày mới: dừng cả đợt (các kênh sau cũng sẽ là ngày cũ)
            job.update({"status": "error", "msg": str(body["progress"].get("msg") or "Kalodata chưa sang ngày mới")[:300], "pct": 100, "stale": True})
            job["t2"] = int(time.time())
        elif body.get("progress") and job:  # tiện ích báo tiến độ
            p = body["progress"]
            n, i = len(job.get("links") or [1]), int(job.get("idx") or 0)
            fin = p.get("status") in ("done", "error")
            if n > 1 and fin and not job.get("stop") and i + 1 < n:  # còn kênh kế tiếp trong hàng quét: nghỉ vài giây (tránh bị nghi ngờ) rồi chuyển kênh
                import random as _rd
                job.setdefault("res", []).append({"i": i, "status": p.get("status"), "msg": str(p.get("msg") or "")[:160]})
                job.update({"idx": i + 1, "link": job["links"][i + 1], "status": "wait", "pct": int((i + 1) * 100 / n), "nb": time.time() + _rd.randint(15, 40),
                            "msg": "Xong kênh %d/%d%s. Nghỉ ít giây rồi sang kênh %d…" % (i + 1, n, " (có lỗi)" if p.get("status") == "error" else "", i + 2)})
            else:
                for k in ("status", "msg", "pct"):
                    if k in p:
                        job[k] = p[k]
                if n > 1:
                    if fin:
                        bad = sum(1 for r in (job.get("res") or []) if r.get("status") == "error") + (1 if p.get("status") == "error" else 0)
                        job["msg"] = "Xong %d kênh%s. %s" % (n, ", %d kênh lỗi" % bad if bad else "", str(p.get("msg") or "")[:200])
                        job["pct"] = 100 if not job.get("stop") else job.get("pct", 0)
                        job["status"] = "done" if bad < n else "error"
                    else:
                        job["msg"] = "Kênh %d/%d · %s" % (i + 1, n, str(p.get("msg") or ""))
                        job["pct"] = int((i + float(p.get("pct") or 0) / 100.0) * 100 / n)
            job["t2"] = int(time.time())
        elif body.get("put"):  # tiện ích gửi kết quả
            p = body["put"]
            h = str(p.get("handle") or "").strip()
            if h:
                old = (st.setdefault("data", {}).get(h) or {})
                rgs = dict(old.get("ranges") or {})
                rgs.update(p.get("ranges") or {})  # giữ các khoảng ngày của lần quét trước, chỉ ghi đè khoảng vừa quét
                st["data"][h] = {"t": int(time.time()), "cid": str(p.get("cid") or old.get("cid") or ""), "av": str(_rival_av().get(h.lstrip("@")) or p.get("av") or old.get("av") or "")[:600], "dbg": json.dumps(p.get("dbg") or {}, ensure_ascii=False)[:6000], "ranges": rgs,
                                 "hist": _kalo_hist(old.get("hist"), p.get("ranges"))}
        elif body.get("clear"):
            job = None
        elif body.get("cfg") is not None:  # danh sách link + cài đặt quét: lưu ở laptop để điện thoại và máy tính dùng chung
            c = body["cfg"]
            links = [{"u": str(x.get("u") or "")[:600]} for x in (c.get("links") or []) if isinstance(x, dict) and "kalodata.com" in str(x.get("u") or "")][:60]
            st["cfg"] = {"links": links, "sel": max(0, min(int(c.get("sel") or 0), max(0, len(links) - 1))),
                         "ranges": [x for x in (c.get("ranges") or []) if x in ("Hôm qua", "7 ngày trước", "30 ngày trước")],
                         "custom": bool(c.get("custom")), "from": str(c.get("from") or "")[:10], "to": str(c.get("to") or "")[:10],
                         "multi": [str(x)[:30] for x in (c.get("multi") or []) if re.fullmatch(r"\d{1,30}", str(x))][:60],
                         "star": {str(k): 1 for k in list((c.get("star") or {}))[:3000] if re.fullmatch(r"\d{1,30}", str(k))},
                         "seen": {str(k): 1 for k in list((c.get("seen") or {}))[:6000] if re.fullmatch(r"\d{1,30}", str(k))}}
        elif body.get("delchan"):  # xóa dữ liệu của RIÊNG một kênh (giữ link trong danh sách)
            (st.get("data") or {}).pop(str(body["delchan"]), None)
        elif body.get("wipe"):  # xóa toàn bộ dữ liệu Kalo đã nhận (giữ nguyên danh sách link trên điện thoại)
            st["data"] = {}
            job = None
        st["job"] = job
        jwrite("_kalo.json", st)
        return {"ok": True, "job": job}


# ---------------------------------------------------------------- tải video TikTok (y như bên Motion Control: yt-dlp)
# Chạy yt-dlp bằng lệnh con (python -m yt_dlp) để bản vừa cập nhật có hiệu lực NGAY, không cần bật lại bảng điều khiển.
_dl_lock = threading.Lock()
_dl_state = {"running": False, "items": [], "ver": "", "upd": ""}


def ytdlp_version():
    try:
        r = subprocess.run([sys.executable, "-m", "yt_dlp", "--version"], capture_output=True, text=True, timeout=30)
        return (r.stdout or "").strip()
    except Exception:
        return ""


def update_ytdlp(force=False):
    """TikTok hay đổi -> yt-dlp (cộng đồng lớn nhất thế giới) cập nhật theo. Tự cập nhật nhiều nhất 1 lần / 2 ngày, hoặc ép khi tải lỗi."""
    st = jread("_ytdlp.json", {})
    if not force and time.time() - st.get("t", 0) < 2 * 86400:
        return st.get("msg", "")
    try:
        r = subprocess.run([sys.executable, "-m", "pip", "install", "-U", "--quiet", "yt-dlp"], capture_output=True, text=True, timeout=180)
        msg = "đã cập nhật yt-dlp" if r.returncode == 0 else "cập nhật yt-dlp lỗi: " + (r.stderr or r.stdout or "")[-120:]
    except Exception as e:
        msg = "cập nhật yt-dlp bỏ qua: %s" % type(e).__name__
    v = ytdlp_version()
    jwrite("_ytdlp.json", {"t": time.time(), "msg": msg, "ver": v})
    _dl_state["ver"], _dl_state["upd"] = v, msg
    return msg


_tikwm_lock = threading.Lock()
_src_lock = threading.Lock()
_canon = {}   # tên file -> link TikTok chuẩn (@kênh/video/id), để bấm 2 lần mở đúng video gốc
_tikwm_last = [0.0]


def _dl_tikwm(url, dest, tag):
    """Tải video TikTok qua tikwm.com (lấy thẳng file mp4, ưu tiên bản HD). Chạy ổn khi yt-dlp chỉ ra âm thanh."""
    last_err = "tikwm không trả lời"
    for _try in range(4):
        with _tikwm_lock:   # tikwm bản miễn phí chỉ cho 1 lệnh mỗi giây
            wait = 1.2 - (time.time() - _tikwm_last[0])
            if wait > 0:
                time.sleep(wait)
            _tikwm_last[0] = time.time()
            req = urllib.request.Request("https://www.tikwm.com/api/?hd=1&url=" + quote(url, safe=""), headers={"User-Agent": "Mozilla/5.0"})
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    d = json.loads(r.read().decode("utf-8", "replace"))
            except Exception as e:
                last_err = "tikwm lỗi mạng: " + str(e)[:80]
                continue
        if d.get("code") != 0:
            last_err = "tikwm: " + str(d.get("msg") or "lỗi")[:100]
            if re.search(r"limit|second", last_err, re.I):
                time.sleep(1.5)
                continue
            raise RuntimeError(last_err)
        x = d.get("data") or {}
        link = x.get("hdplay") or x.get("play")
        if not link:
            if x.get("images"):
                raise RuntimeError("Link này là bài ảnh trượt (slideshow) của TikTok, không có video để tải")
            raise RuntimeError("tikwm không có link video cho bài này")
        if link.startswith("/"):
            link = "https://www.tikwm.com" + link
        slug = re.sub(r"[^A-Za-z0-9_-]+", "_", str(x.get("title") or "").encode("ascii", "ignore").decode())[:40].strip("_") or str(x.get("id") or "tiktok")
        dest.mkdir(parents=True, exist_ok=True)
        out = dest / ("%s_%s.mp4" % (tag, slug))
        tmp = dest / (".tai_" + out.name + ".tmp")
        try:
            with urllib.request.urlopen(urllib.request.Request(link, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://www.tikwm.com/"}), timeout=180) as r, open(tmp, "wb") as f:
                shutil.copyfileobj(r, f)
            if tmp.stat().st_size < 20000:
                raise RuntimeError("file video tải về quá nhỏ, có thể bị lỗi")
            os.replace(str(tmp), str(out))
        finally:
            try:
                if tmp.exists():
                    tmp.unlink()
            except OSError:
                pass
        try:
            au = (x.get("author") or {}).get("unique_id")
            if x.get("id") and au:
                _canon[out.name] = "https://www.tiktok.com/@%s/video/%s" % (au, x.get("id"))
        except Exception:
            pass
        return out.name
    raise RuntimeError(last_err)


def _dl_ytdlp(url, dest, tag):
    cmd = [sys.executable, "-m", "yt_dlp", "--no-warnings", "--no-playlist", "-f", "bestvideo+bestaudio/best", "--merge-output-format", "mp4",
           "--restrict-filenames", "-o", str(dest / (tag + "_%(title).50s.%(ext)s")), "--print", "after_move:filepath", url]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=900, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError(((r.stderr or "").strip().splitlines() or ["lỗi không rõ"])[-1][:200])
    lines = [x for x in (r.stdout or "").strip().splitlines() if x.strip()]
    if not lines:
        raise RuntimeError("tải xong nhưng không thấy tên file")
    f = Path(lines[-1].strip())
    if f.suffix.lower() not in VID_EXT:   # yt-dlp đôi khi chỉ lấy được âm thanh (mp3): không phải video, xóa đi, không tính là xong
        try:
            f.unlink()
        except OSError:
            pass
        raise RuntimeError("chỉ tải được âm thanh, không có video")
    return f.name


def _dl_one(url, dest):
    """Bắt buộc ra VIDEO. Thử tikwm trước (ổn định), không được thì thử yt-dlp. File không phải video thì xóa và báo lỗi."""
    dest.mkdir(parents=True, exist_ok=True)
    tag = uuid.uuid4().hex[:8]
    errs = []
    try:
        return _dl_tikwm(url, dest, tag)
    except RuntimeError as e:
        errs.append(str(e))
        if "slideshow" in str(e):
            raise
    try:
        return _dl_ytdlp(url, dest, tag)
    except Exception as e:
        errs.append(str(e))
    raise RuntimeError(" | ".join(x for x in errs if x)[:200] or "không tải được video")


def _dl_batch(urls, conc):
    dest = ROOT / D_VMAU1
    updated = {"done": False}

    def work(it):
        with _dl_lock:
            it["status"] = "downloading"
        try:
            try:
                name = _dl_one(it["url"], dest)
            except Exception as e1:
                if updated["done"] or not re.search(r"extract|Unsupported|unable|HTTP Error|403|404|JSON|parse", str(e1), re.I):
                    raise
                updated["done"] = True
                update_ytdlp(force=True)   # tải lỗi kiểu "TikTok đổi" -> cập nhật yt-dlp rồi thử lại 1 lần
                name = _dl_one(it["url"], dest)
            with _dl_lock:
                it["status"], it["file"] = "done", name
            try:
                with _src_lock:
                    mp = jread("_nguon_video.json", {})
                    mp[name] = _canon.pop(name, None) or it["url"]
                    jwrite("_nguon_video.json", mp)
            except Exception:
                pass
        except Exception as e:
            with _dl_lock:
                it["status"], it["error"] = "error", str(e)[:200]
    try:
        import concurrent.futures as _cf
        with _cf.ThreadPoolExecutor(max_workers=max(1, conc)) as ex:
            list(ex.map(work, _dl_state["items"]))
    finally:
        with _dl_lock:
            _dl_state["running"] = False


def api_dlvideo(q, body):
    if body is None:
        if not _dl_state["ver"]:
            _dl_state["ver"] = jread("_ytdlp.json", {}).get("ver", "") or ytdlp_version()
        with _dl_lock:
            return {"ok": True, "running": _dl_state["running"], "items": _dl_state["items"], "ver": _dl_state["ver"], "upd": _dl_state["upd"] or jread("_ytdlp.json", {}).get("msg", "")}
    if body.get("clear"):
        with _dl_lock:
            if not _dl_state["running"]:
                _dl_state["items"] = []
        return {"ok": True}
    if body.get("update"):
        threading.Thread(target=lambda: update_ytdlp(force=True), daemon=True).start()
        return {"ok": True}
    urls = [u.strip() for u in (body.get("urls") or []) if str(u).strip()]
    if not urls:
        return {"ok": False, "error": "Chưa dán link nào"}
    seen, uniq = set(), []
    for u in urls:   # link trùng (cùng một video) chỉ tải 1 lần
        m = re.search(r"/video/(\d+)", u)
        k = m.group(1) if m else u.split("?")[0].rstrip("/")
        if k in seen:
            continue
        seen.add(k)
        uniq.append(u)
    urls = uniq
    with _dl_lock:
        if _dl_state["running"]:
            return {"ok": False, "error": "Đang có lượt tải khác chạy, đợi xong đã"}
        _dl_state["running"] = True
        _dl_state["items"] = [{"url": u, "status": "queued", "file": None, "error": None} for u in urls]
    threading.Thread(target=_dl_batch, args=(urls, max(1, min(5, int(body.get("concurrency") or 1)))), daemon=True).start()
    return {"ok": True}


# ---------------------------------------------------------------- LÀM NÉT ẢNH (app RunningHub 2094976224284602369)
# Ảnh tải lên được LƯU VỀ LAPTOP (thư mục OLD) rồi laptop mới gửi lên RunningHub từng ảnh một. Chỉ ảnh sếp bấm "Chạy" / "Làm lại" mới bị gửi (tốn coin).
SHARP_APP = "2094976224284602369"
_sharp_lock = threading.Lock()


def sharp_read():
    return jread("_lamnet.json", [])


def sharp_update(jid, **kw):
    with _sharp_lock:
        lst = sharp_read()
        for r in lst:
            if r.get("id") == jid:
                r.update(kw)
        jwrite("_lamnet.json", lst)


def to_recycle_bin(p):
    """Đưa file vào THÙNG RÁC CỦA WINDOWS (lấy lại được), không xóa hẳn."""
    ps = "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($env:QV_F, 'OnlyErrorDialogs', 'SendToRecycleBin')"
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], env=dict(os.environ, QV_F=str(p)), capture_output=True, text=True, timeout=40, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if Path(p).exists():
        raise ApiError("Không đưa được ảnh vào thùng rác Windows")


def _unlink_retry(p):
    """Windows có lúc còn giữ file (đang tạo ảnh thu nhỏ): thử xóa lại vài lần cho chắc."""
    for _ in range(6):
        try:
            Path(p).unlink()
            return True
        except FileNotFoundError:
            return True
        except OSError:
            time.sleep(0.4)
    return False


def sharp_name(name, fallback):
    n = re.sub(r'[\\/:*?"<>|\r\n\t]+', " ", str(name or "")).strip().strip(".")
    return (n or fallback)[:80]


def api_sharp_upload(q, body, raw=None):
    name = (q.get("name") or ["anh.jpg"])[0]
    ext = Path(name).suffix.lower()
    if ext not in IMG_EXT:
        raise ApiError("Không phải ảnh")
    if not raw:
        raise ApiError("Tệp rỗng")
    d = ROOT / D_SHARP_OLD
    d.mkdir(parents=True, exist_ok=True)
    stem = re.sub(r"[^\w\- ]+", "_", Path(name).stem)[:60] or "anh"
    dest = unique_dest(d, stem + ext)
    tmp = d / (".tai_" + dest.name + ".tmp")
    tmp.write_bytes(raw)
    os.replace(str(tmp), str(dest))
    rec = {"id": uuid.uuid4().hex[:10], "name": dest.stem, "old": rel_of(dest), "new": "", "state": "staged", "msg": "Đã tải lên, chưa chạy", "t": int(time.time())}
    with _sharp_lock:
        lst = sharp_read()
        lst.append(rec)
        jwrite("_lamnet.json", lst)
    return {"ok": True, "job": rec}


def api_sharp(q, body):
    if body is None:
        with _sharp_lock:
            lst = sharp_read()
        for r in lst:  # việc đang chạy mà file ảnh gốc đã mất thì báo lỗi, khỏi kẹt
            if r.get("state") in ("staged", "wait", "run", "error") and not (ROOT / r["old"]).is_file():
                r["state"], r["msg"] = "error", "Không còn thấy ảnh gốc"
        return {"ok": True, "items": lst, "has_key": bool(_rh_key())}
    with _sharp_lock:
        lst = sharp_read()
        byid = {r["id"]: r for r in lst}
        if body.get("run"):  # nút Chạy: tất cả ảnh đã tải lên bắt đầu xếp hàng làm nét
            if not _rh_key():
                raise ApiError("Chưa tìm thấy khóa RunningHub (nằm trong Motion Control)")
            n = 0
            for r in lst:
                if r["state"] == "staged":
                    r["state"], r["msg"], n = "wait", "Đang chờ tới lượt", n + 1
            jwrite("_lamnet.json", lst)
            return {"ok": True, "queued": n}
        r = byid.get(str(body.get("redo") or body.get("approve") or body.get("rm") or ""))
        if not r:
            raise ApiError("Không thấy ảnh này")
        if body.get("rm"):  # bỏ ảnh đã tải lên nhưng CHƯA chạy
            if r["state"] != "staged":
                raise ApiError("Ảnh này đã chạy rồi, không bỏ ở đây được")
            _unlink_retry(ROOT / r["old"])
            jwrite("_lamnet.json", [x for x in lst if x["id"] != r["id"]])
            return {"ok": True}
        if body.get("redo"):  # làm lại: ảnh NEW vào thùng rác Windows, chạy lại từ ảnh OLD
            if r["state"] not in ("done", "error"):
                raise ApiError("Ảnh này đang chạy hoặc đang chờ")
            if r.get("new") and (ROOT / r["new"]).is_file():
                to_recycle_bin(ROOT / r["new"])
            r.update({"new": "", "state": "wait", "msg": "Làm lại, đang chờ tới lượt", "task": ""})
            jwrite("_lamnet.json", lst)
            return {"ok": True}
        # duyệt: ảnh NEW sang "2 - TOÀN BỘ ẢNH MODEL" với tên sếp đặt, ảnh OLD xóa vĩnh viễn
        if r["state"] != "done" or not r.get("new") or not (ROOT / r["new"]).is_file():
            raise ApiError("Ảnh này chưa làm nét xong")
        src = ROOT / r["new"]
        dd = ROOT / D_MALL
        dd.mkdir(parents=True, exist_ok=True)
        dest = unique_dest(dd, sharp_name(body.get("name"), r["name"]) + src.suffix.lower())
        shutil.move(str(src), str(dest))
        _unlink_retry(ROOT / r["old"])
        jwrite("_lamnet.json", [x for x in lst if x["id"] != r["id"]])
        return {"ok": True, "rel": rel_of(dest)}


def _sharp_save_output(job, key, task):
    res = _post_json(RH_BASE + "/task/openapi/outputs", {"apiKey": key, "taskId": task}, 30)
    if res.get("code") != 0 or not res.get("data"):
        raise RuntimeError("chưa lấy được kết quả: " + str(res)[:150])
    url = urllib.parse.quote(res["data"][0]["fileUrl"], safe=":/?&=%#@+,;~")
    d = ROOT / D_SHARP_NEW
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / (".dang_ghi_" + uuid.uuid4().hex[:6] + ".tmp")
    with urllib.request.urlopen(url, timeout=180) as r, open(tmp, "wb") as f:
        shutil.copyfileobj(r, f)
    import zipfile
    ext = Path(urllib.parse.urlparse(url).path).suffix.lower()
    if zipfile.is_zipfile(tmp):
        with zipfile.ZipFile(tmp) as z:
            nm = next((n for n in z.namelist() if Path(n).suffix.lower() in IMG_EXT), None)
            if not nm:
                raise RuntimeError("kết quả nén không có ảnh")
            ext = Path(nm).suffix.lower()
            tmp2 = tmp.with_suffix(".tmp2")
            with z.open(nm) as sfh, open(tmp2, "wb") as o:
                shutil.copyfileobj(sfh, o)
        tmp.unlink()
        tmp = tmp2
    if ext not in IMG_EXT:
        ext = ".png"
    if tmp.stat().st_size < 1000:
        tmp.unlink()
        raise RuntimeError("ảnh kết quả rỗng")
    dest = unique_dest(d, sharp_name(job.get("name"), "anh") + "_net" + ext)
    os.replace(str(tmp), str(dest))
    return rel_of(dest)


def sharp_process(job):
    jid, key = job["id"], _rh_key()
    if not key:
        return sharp_update(jid, state="error", msg="Chưa tìm thấy khóa RunningHub")
    old = ROOT / job["old"]
    if not old.is_file():
        return sharp_update(jid, state="error", msg="Không còn thấy ảnh gốc")
    task = job.get("task") or ""
    if job.get("state") == "wait":
        # ---- CHỖ DUY NHẤT GỌI API TỐN COIN: chỉ chạy với ảnh sếp đã bấm Chạy / Làm lại
        sharp_update(jid, state="run", msg="Đang tải ảnh lên RunningHub", task="", t2=int(time.time()))
        body, ct = _multipart([("apiKey", key), ("fileType", "image")], [("file", "anh" + old.suffix.lower(), old.read_bytes())])
        req = urllib.request.Request(RH_BASE + "/task/openapi/upload", data=body, headers={"Content-Type": ct})
        with urllib.request.urlopen(req, timeout=120) as r:
            up = json.loads(r.read().decode("utf-8"))
        if up.get("code") != 0:
            return sharp_update(jid, state="error", msg="Tải ảnh lên RunningHub lỗi: " + str(up)[:120])
        run = _post_json(RH_BASE + "/task/openapi/ai-app/run", {"webappId": SHARP_APP, "apiKey": key, "nodeInfoList": [
            {"nodeId": "27", "fieldName": "image", "fieldValue": up["data"]["fileName"]}, {"nodeId": "32", "fieldName": "value", "fieldValue": "false"}]}, 60)
        if run.get("code") != 0:
            return sharp_update(jid, state="error", msg="RunningHub không nhận việc: " + str(run)[:140])
        task = run["data"]["taskId"]
        sharp_update(jid, task=task, msg="RunningHub đang làm nét")
    elif not task:
        # server bị tắt đúng lúc đang gửi: không rõ đã bắn lệnh chưa -> KHÔNG tự gửi lại để khỏi tốn coin hai lần
        return sharp_update(jid, state="error", msg="Bị ngắt giữa chừng, không rõ đã gửi chưa. Bấm Làm lại nếu muốn chạy lại (có thể tốn thêm coin).")
    bad = 0
    deadline = time.time() + 1800
    while time.time() < deadline:
        try:
            st = _post_json(RH_BASE + "/task/openapi/status", {"apiKey": key, "taskId": task}, 15).get("data")
            bad = 0
        except Exception:
            bad += 1
            if bad > 20:
                return sharp_update(jid, state="error", msg="Mất mạng quá lâu, chưa lấy được kết quả (việc vẫn có thể đã chạy xong trên RunningHub)")
            time.sleep(5)
            continue
        if st == "SUCCESS":
            try:
                rel = _sharp_save_output(job, key, task)
            except Exception as e:
                bad += 1
                if bad > 6:
                    return sharp_update(jid, state="error", msg="Làm nét xong nhưng chưa tải ảnh về được: " + str(e)[:100])
                time.sleep(5)
                continue
            return sharp_update(jid, new=rel, state="done", msg="Xong")
        if st == "FAILED":
            return sharp_update(jid, state="error", msg="RunningHub báo làm nét thất bại")
        time.sleep(4)
    sharp_update(jid, state="error", msg="Quá thời gian chờ RunningHub (30 phút)")


def sharp_worker():
    while True:
        try:
            job = next((r for r in sharp_read() if r.get("state") in ("wait", "run")), None)
            if not job:
                time.sleep(2)
                continue
            sharp_process(job)
        except Exception as e:
            print(" (làm nét lỗi nhẹ:", str(e)[:120], ")")
            time.sleep(5)


ROUTES = {"ping": api_ping, "alltree": api_alltree, "tree": api_tree, "product": api_product, "mkdir": api_mkdir, "move": api_move, "rename": api_rename,
          "delete": api_delete, "state": api_state, "group": api_group, "newproduct": api_newproduct, "find": api_find, "queue": api_queue,
          "settings": api_settings, "links": api_links, "sharp": api_sharp, "model_all": api_model_all, "model_store": api_model_store, "model_lock": api_model_lock, "model_copy": api_model_copy, "dlvideo": api_dlvideo, "doithu": api_doithu, "kalo": api_kalo, "phoi": api_phoi, "results": api_results, "result_do": api_result_do,
          "result_move": api_result_move, "models": api_models, "launch": api_launch, "video": api_video, "estimate": api_estimate, "rh_balance": api_rh_balance, "app_open": api_app_open, "fix": api_fix, "ext_log": api_ext_log, "video_mau": api_video_mau, "video_out": api_video_out, "video_posted": api_video_posted, "video_run": api_video_run, "video_jobs": api_video_jobs, "job_next": api_job_next, "job_done": api_job_done, "notice": api_notice}


# ---------------------------------------------------------------- máy chủ
def thumb_bytes(p, w):
    if not Image or w <= 0:
        return None
    td = SYSP / THUMBS
    td.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha1(f"{p}|{p.stat().st_mtime_ns}|{w}".encode("utf-8")).hexdigest()
    tf = td / (key + ".jpg")
    if tf.exists():
        return tf.read_bytes()
    try:
        im = Image.open(p)
        im.thumbnail((w, w * 2))
        if im.mode not in ("RGB", "L"):
            im = im.convert("RGB")
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=82)
        tf.write_bytes(buf.getvalue())
        return buf.getvalue()
    except Exception:
        return None


class BigQueueServer(ThreadingHTTPServer):
    """Hàng chờ kết nối dài (mặc định chỉ 5): điện thoại tải cả chục ảnh nhỏ cùng lúc qua Tailscale thì không còn bị lỗi 502 / ảnh hiện dấu ?."""
    request_queue_size = 256
    daemon_threads = True


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, data, ctype="application/json; charset=utf-8", extra=None):
        if isinstance(data, (dict, list)):
            data = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def _auth(self, q):
        k = self.headers.get("X-Key") or (q.get("key") or [""])[0]
        return secrets.compare_digest(k or "", KEY)

    def _api(self, name, q, body, raw=None):
        try:
            if name == "launch":
                _ext_seen[0] = time.time()
            if name == "upload":
                res = api_upload(q, body, raw)
            elif name == "receive":
                res = api_receive(q, body, raw)
            elif name == "video_upload":
                res = api_video_upload(q, body, raw)
            elif name == "video_mau_upload":
                res = api_video_mau_upload(q, body, raw)
            elif name == "backup_save":
                res = api_backup_save(q, body, raw)
            elif name == "upload_loose":
                res = api_upload_loose(q, body, raw)
            elif name == "sharp_upload":
                res = api_sharp_upload(q, body, raw)
            elif name in ROUTES:
                if name == "ping" and self.client_address[0] in ("127.0.0.1", "::1") and not self.headers.get("X-Forwarded-For") and not self.headers.get("Tailscale-User-Login"):
                    _local_ping[0] = time.time()   # một trang bảng điều khiển đang mở TRÊN LAPTOP (không tính điện thoại qua Tailscale)
                res = ROUTES[name](q, body)
            else:
                raise ApiError("lệnh không tồn tại")
            self._send(200, res)
        except ApiError as e:
            self._send(200, {"ok": False, "error": str(e)})
        except Exception as e:  # lỗi bất ngờ: báo rõ cho bảng điều khiển
            self._send(500, {"ok": False, "error": f"lỗi chương trình: {e}"})

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path in ("/", "/index.html"):
            f = HERE / "bang_dieu_khien.html"
            return self._send(200, f.read_bytes(), "text/html; charset=utf-8") if f.exists() else self._send(404, {"ok": False, "error": "thiếu bang_dieu_khien.html"})
        if u.path == "/icon.png":
            f = HERE / "icon.png"
            return self._send(200, f.read_bytes(), "image/png", {"Cache-Control": "max-age=86400"}) if f.exists() else self._send(404, {"ok": False})
        if u.path == "/s3.json":
            f = HERE / "s3.json"
            return self._send(200, f.read_bytes()) if f.exists() else self._send(404, {"ok": False, "error": "thiếu s3.json"})
        if not self._auth(q):
            return self._send(401, {"ok": False, "error": "sai hoặc thiếu mật khẩu (key)"})
        if u.path == "/file":
            try:
                p = safe((q.get("path") or [""])[0])
                if p.is_file() and p.suffix.lower() in VID_EXT:  # video: hỗ trợ Range để xem trước / tua trên điện thoại
                    size = p.stat().st_size
                    start, end, code, extra = 0, size - 1, 200, {"Accept-Ranges": "bytes", "Cache-Control": "max-age=300"}
                    rg = self.headers.get("Range") or ""
                    mm = re.match(r"bytes=(\d*)-(\d*)", rg)
                    if mm and (mm.group(1) or mm.group(2)):
                        a, b = mm.group(1), mm.group(2)
                        start = int(a) if a else max(0, size - int(b))
                        end = int(b) if (a and b) else size - 1
                        end = min(end, size - 1, start + 8 * 1024 * 1024 - 1)
                        code = 206
                        extra["Content-Range"] = "bytes %d-%d/%d" % (start, end, size)
                    with open(p, "rb") as fh:
                        fh.seek(start)
                        data = fh.read(max(0, end - start + 1))
                    if (q.get("dl") or [""])[0]:  # tải về máy / điện thoại đúng tên file, không đổi gì
                        extra["Content-Disposition"] = "attachment; filename*=UTF-8''" + quote(p.name)
                    return self._send(code, data, mimetypes.guess_type(str(p))[0] or "video/mp4", extra)
                if not p.is_file() or p.suffix.lower() not in IMG_EXT:
                    return self._send(404, {"ok": False, "error": "không có ảnh"})
                w = int((q.get("w") or ["0"])[0] or 0)
                tb = thumb_bytes(p, w) if w else None
                if tb:
                    return self._send(200, tb, "image/jpeg", {"Cache-Control": "max-age=3600"})
                ct = mimetypes.guess_type(str(p))[0] or "application/octet-stream"
                return self._send(200, p.read_bytes(), ct, {"Cache-Control": "max-age=300"})
            except ApiError as e:
                return self._send(400, {"ok": False, "error": str(e)})
        if u.path.startswith("/api/"):
            return self._api(u.path[5:], q, None)
        self._send(404, {"ok": False, "error": "không tìm thấy"})

    def do_POST(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if not self._auth(q):
            return self._send(401, {"ok": False, "error": "sai hoặc thiếu mật khẩu (key)"})
        n = int(self.headers.get("Content-Length") or 0)
        data = self.rfile.read(n) if n else b""
        if not u.path.startswith("/api/"):
            return self._send(404, {"ok": False, "error": "không tìm thấy"})
        name = u.path[5:]
        if name in ("upload", "receive", "video_upload", "video_mau_upload", "backup_save", "upload_loose", "sharp_upload"):
            return self._api(name, q, None, data)
        try:
            body = json.loads(data.decode("utf-8")) if data else {}
        except Exception:
            return self._send(400, {"ok": False, "error": "dữ liệu gửi lên không đọc được"})
        self._api(name, q, body)


def local_ips():
    ips = set()
    try:
        for i in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(i[4][0])
    except Exception:
        pass
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ips.add(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    return sorted(i for i in ips if not i.startswith("127."))


if __name__ == "__main__":
    ensure_layout()
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    threading.Thread(target=ensure_motion_control, daemon=True).start()
    threading.Thread(target=sharp_worker, daemon=True).start()   # làm nét ảnh: chỉ chạy ảnh sếp đã bấm Chạy / Làm lại
    threading.Thread(target=update_ytdlp, daemon=True).start()   # TikTok hay đổi: cập nhật yt-dlp theo cộng đồng (tối đa 1 lần / 2 ngày)
    threading.Thread(target=vj_watch, daemon=True).start()
    print("=" * 66)
    print(" BẢNG ĐIỀU KHIỂN - dây chuyền tự động làm video")
    print(" Kho ảnh thật:", ROOT)
    print(" Giữ cửa sổ này mở. Tắt cửa sổ = tắt bảng điều khiển.")
    print(" Mở trên laptop :  http://localhost:%d/?key=%s" % (PORT, KEY))
    for ip in local_ips():
        print(" Mở trên điện thoại (cùng Wi-Fi hoặc Tailscale): http://%s:%d/?key=%s" % (ip, PORT, KEY))
    print("=" * 66)
    threading.Timer(9.0, open_chrome_if_needed).start()   # đợi ~9 giây để biết đã có trang bảng điều khiển nào mở sẵn chưa
    try:
        BigQueueServer(("0.0.0.0", PORT), H).serve_forever()
    except OSError as e:
        print("Không mở được cổng", PORT, "-", e)
        print("Có thể bảng điều khiển đang chạy ở cửa sổ khác.")
        sys.exit(1)
