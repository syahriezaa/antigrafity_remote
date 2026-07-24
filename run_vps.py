import os
import uvicorn

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    host = os.getenv("VPS_HOST", "0.0.0.0")
    print(f"============================================================")
    print(f" [Antigravity VPS Remote Server Launcher]")
    print(f"============================================================")
    print(f"[+] Server starting on http://{host}:{port}")
    print(f"[+] Password Security Active. Host on VPS or public domain!")
    print(f"============================================================")
    uvicorn.run("vps_server.vps_server:app", host=host, port=port, reload=False)
