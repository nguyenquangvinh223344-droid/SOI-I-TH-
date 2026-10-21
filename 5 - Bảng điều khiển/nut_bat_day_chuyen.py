# -*- coding: utf-8 -*-
"""NÚT BẬT DÂY CHUYỀN TỪ XA.
Chương trình rất nhẹ, tự chạy cùng Windows (Task Scheduler) và luôn chờ sẵn trên laptop.
Điện thoại mở trang của nó, bấm "Bật dây chuyền" -> laptop chạy chay_bang_dieu_khien.bat (bảng điều khiển + mở Chrome với 2 app).
- Chỉ nghe trên 127.0.0.1 (không lộ ra mạng nhà); điện thoại vào qua Tailscale (tailscale serve) bằng địa chỉ https.
- Dùng CHUNG mật khẩu với bảng điều khiển (mat_khau.txt). Sai mật khẩu thì không làm gì.
- Bảng điều khiển đang chạy rồi thì bấm cũng KHÔNG bật thêm bản thứ hai.
"""
import json
import os
import socket
import subprocess
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
PORT = int(os.environ.get("NUT_PORT") or 8801)
PANEL_PORT = int(os.environ.get("NUT_PANEL_PORT") or 8800)
BAT = Path(os.environ.get("NUT_BAT") or (HERE / "chay_bang_dieu_khien.bat"))
KEY = (HERE / "mat_khau.txt").read_text(encoding="utf-8").strip()
LOG = HERE / "nut_bat_day_chuyen.log"
_last_start = [0.0]


def log(msg):
    try:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(time.strftime("%d/%m %H:%M:%S ") + msg + "\n")
        if LOG.stat().st_size > 200000:
            LOG.write_text("", encoding="utf-8")
    except OSError:
        pass


def panel_up():
    try:
        with socket.create_connection(("127.0.0.1", PANEL_PORT), timeout=1.5):
            return True
    except OSError:
        return False


def start_panel():
    if panel_up():
        return "da_chay"
    if time.time() - _last_start[0] < 20:
        return "dang_bat"        # vừa bấm xong, đang khởi động: không bật chồng
    _last_start[0] = time.time()
    if os.environ.get("NUT_BAT"):   # chế độ thử nghiệm: chạy thẳng file được chỉ định
        subprocess.Popen(["cmd", "/c", "start", "", "/min", str(BAT)], cwd=str(BAT.parent), creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    else:
        # bật qua một tác vụ Windows RIÊNG ("QV Chay day chuyen") để dây chuyền sống độc lập với chương trình nút này
        # (nút này tắt/khởi động lại thì dây chuyền KHÔNG bị tắt theo). Cửa sổ đen thu nhỏ như bấm đúp "Dây chuyền".
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        # lần chạy trước (nếu còn treo ở màn hình "nhấn phím bất kỳ" sau khi dây chuyền sập) phải kết thúc trước, kẻo lệnh chạy mới bị bỏ qua
        subprocess.run(["schtasks", "/end", "/tn", "QV Chay day chuyen"], capture_output=True, text=True, creationflags=flags)
        time.sleep(1.5)
        r = subprocess.run(["schtasks", "/run", "/tn", "QV Chay day chuyen"], capture_output=True, text=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if r.returncode != 0:
            raise RuntimeError("không chạy được tác vụ: " + (r.stderr or r.stdout or "").strip()[:100])
    log("đã bấm Bật dây chuyền -> chạy " + BAT.name)
    return "da_bat"


PAGE = """<!doctype html><html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Bật dây chuyền">
<link rel="apple-touch-icon" href="/icon.png"><title>Bật dây chuyền</title>
<style>
:root{--bg:#f4f1fb;--card:#fff;--txt:#2a2540;--dim:#7a7490;--sel:#6b58a8;--on:#fff;--ok:#1f9d6b;--bad:#c0392b;--line:#e3dff0}
@media(prefers-color-scheme:dark){:root{--bg:#1b1d1f;--card:#26292c;--txt:#e9ecee;--dim:#98a0a6;--sel:#8d7bd0;--on:#14111f;--ok:#3fcf9b;--bad:#ff7a6b;--line:#363a3e}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:16px/1.45 -apple-system,system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px}
.c{width:100%;max-width:420px;background:var(--card);border:1px solid var(--line);border-radius:22px;padding:26px 20px;text-align:center}
h1{font-size:19px;margin:0 0 4px}.s{color:var(--dim);font-size:14px;margin:0 0 18px;min-height:20px}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--dim);margin-right:6px}.up .dot{background:var(--ok)}
button,a.b{display:flex;align-items:center;justify-content:center;width:100%;min-height:56px;border-radius:16px;border:0;font:inherit;font-size:17px;font-weight:700;cursor:pointer;text-decoration:none;margin-top:12px}
#go{background:var(--sel);color:var(--on)}#go:disabled{opacity:.5}a.b{background:var(--ok);color:#fff;display:none}.m{font-size:13px;color:var(--dim);margin-top:14px}
</style></head><body><div class="c" id="c"><h1>Dây chuyền tự động làm video</h1>
<p class="s" id="s"><span class="dot"></span><span id="st">Đang kiểm tra…</span></p>
<button id="go">Bật dây chuyền</button><a class="b" id="open" href="#">Mở bảng điều khiển</a>
<p class="m" id="m">Laptop phải đang bật (chưa ngủ).</p></div>
<script>
let KEY=new URLSearchParams(location.search).get('key')||''; try{ if(KEY) localStorage.setItem('nb_key',KEY); else KEY=localStorage.getItem('nb_key')||''; }catch(e){}
const $=(s)=>document.querySelector(s); let busy=false;
async function call(p,post){ try{ const r=await fetch(p,{method:post?'POST':'GET',headers:{'X-Key':KEY}}); if(r.status===401) return {err:'Sai hoặc thiếu mật khẩu (mở link có ?key=…)'}; return await r.json(); }catch(e){ return {err:'Không nối được với laptop (laptop tắt, ngủ, hoặc Tailscale chưa Connected)'}; } }
function show(j){ const up=!!j.up; $('#c').classList.toggle('up',up); $('#st').textContent=j.err?j.err:up?'Dây chuyền đang chạy':busy?'Đang bật… (khoảng 10-30 giây)':'Dây chuyền đang tắt'; $('#go').style.display=up?'none':'flex'; $('#go').disabled=busy||!!j.err&&!j.up;
  const o=$('#open'); o.style.display=up?'flex':'none'; o.href=location.protocol+'//'+location.hostname+'/?key='+encodeURIComponent(KEY); if(up) busy=false; }
async function tick(){ show(await call('/api/status')); }
$('#go').onclick=async()=>{ busy=true; $('#go').disabled=true; $('#st').textContent='Đang bật…'; const j=await call('/api/start',true); if(j.err){busy=false;} show(j.err?j:{up:j.up}); };
tick(); setInterval(tick,2500); document.addEventListener('visibilitychange',()=>{ if(!document.hidden) tick(); }); window.addEventListener('online',tick);
if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
</script></body></html>"""


SW = """const C='nb-v1';
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(['/','/icon.png'])).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url); if(e.request.method!=='GET'||u.pathname.indexOf('/api/')===0||u.pathname==='/sw.js') return;
  const k=(u.pathname==='/'||u.pathname==='/index.html')?'/':u.pathname;
  e.respondWith(fetch(e.request).then(r=>{ if(r.ok){ const cp=r.clone(); caches.open(C).then(c=>c.put(k,cp)); } return r; }).catch(()=>caches.match(k)));
});"""


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        b = body if isinstance(body, bytes) else body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(b)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(b)

    def _authed(self):
        return (self.headers.get("X-Key") or "") == KEY

    def do_GET(self):
        p = self.path.split("?")[0]
        if p in ("/", "/index.html"):
            return self._send(200, PAGE, "text/html; charset=utf-8")
        if p == "/sw.js":
            return self._send(200, SW, "text/javascript; charset=utf-8")
        if p == "/icon.png":
            f = HERE / "icon.png"
            return self._send(200, f.read_bytes(), "image/png") if f.is_file() else self._send(404, b"")
        if p == "/api/status":
            if not self._authed():
                return self._send(401, json.dumps({"err": "sai mật khẩu"}))
            return self._send(200, json.dumps({"up": panel_up()}))
        self._send(404, b"")

    def do_POST(self):
        if self.path.split("?")[0] == "/api/start":
            if not self._authed():
                return self._send(401, json.dumps({"err": "sai mật khẩu"}))
            try:
                r = start_panel()
            except Exception as e:
                log("lỗi bật: %s" % e)
                return self._send(200, json.dumps({"err": "Không bật được: " + str(e)[:120], "up": False}))
            return self._send(200, json.dumps({"ok": True, "result": r, "up": panel_up()}))
        self._send(404, b"")


TS_EXE = r"C:/Program Files/Tailscale/tailscale.exe"


def ts_watch():
    """Giữ Tailscale của laptop luôn BẬT: lỡ bị tắt/ngắt (bấm nhầm Disconnect, mở máy chưa nối) thì tự bật lại, để điện thoại luôn vào được."""
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        subprocess.run([TS_EXE, "set", "--unattended"], capture_output=True, timeout=20, creationflags=flags)
    except Exception:
        pass
    while True:
        try:
            r = subprocess.run([TS_EXE, "status", "--json"], capture_output=True, text=True, timeout=20, creationflags=flags)
            st = (json.loads(r.stdout or "{}").get("BackendState") or "")
            if st in ("Stopped", "NoState"):
                subprocess.run([TS_EXE, "up"], capture_output=True, timeout=40, creationflags=flags)
                log("Tailscale đang tắt (%s) nên đã tự bật lại" % st)
        except Exception as e:
            log("canh Tailscale lỗi nhẹ: %s" % str(e)[:100])
        time.sleep(30)


if __name__ == "__main__":
    import threading
    threading.Thread(target=ts_watch, daemon=True).start()
    try:
        srv = ThreadingHTTPServer(("127.0.0.1", PORT), H)
    except OSError as e:
        log("không mở được cổng %d: %s" % (PORT, e))
        sys.exit(0)   # đã có bản khác đang chạy
    log("nút bật dây chuyền đang chờ ở cổng %d" % PORT)
    srv.serve_forever()
