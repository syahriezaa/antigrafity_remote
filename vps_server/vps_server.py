import os
import json
import httpx
import asyncio
import secrets
from typing import Set, Dict, Any, List
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends, Header
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Antigravity VPS Remote Bridge")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BRIDGE_PASSWORD = os.getenv("BRIDGE_PASSWORD", "antigravity_secret_123")
ACTIVE_TOKENS: Set[str] = set()

# Multi-Desktop Daemon registry: device_name -> WebSocket
active_desktop_daemons: Dict[str, WebSocket] = {}
active_web_clients: Set[WebSocket] = set()

# Webhook Config File
WEBHOOK_CONFIG_FILE = os.path.expanduser(r"~\.gemini\antigravity\remote_bridge_webhook.json")

class LoginRequest(BaseModel):
    password: str

class WebhookConfig(BaseModel):
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""
    whatsapp_webhook_url: str = ""
    pushover_user_key: str = ""
    pushover_api_token: str = ""
    enable_auto_notify: bool = True

class NotifyRequest(BaseModel):
    title: str
    message: str
    target: str = "all"

@app.post("/api/login")
async def login(req: LoginRequest):
    if req.password == BRIDGE_PASSWORD:
        token = secrets.token_hex(24)
        ACTIVE_TOKENS.add(token)
        return {"success": True, "token": token}
    raise HTTPException(status_code=401, detail="Invalid Bridge Password")

@app.get("/api/status")
async def get_status():
    return {
        "vps_status": "online",
        "desktop_daemon_connected": len(active_desktop_daemons) > 0,
        "active_daemons": list(active_desktop_daemons.keys()),
        "active_clients": len(active_web_clients),
        "requires_auth": True
    }

@app.get("/api/daemons")
async def list_daemons():
    daemons_list = []
    for name in active_desktop_daemons.keys():
        daemons_list.append({"device_name": name, "status": "online"})
    return {"daemons": daemons_list}

@app.get("/api/projects")
async def get_projects():
    app_data_dir = os.path.expanduser(r"~\.gemini\antigravity")
    default_dir = os.path.join(app_data_dir, "scratch")
    
    projects = []
    if os.path.exists(default_dir):
        try:
            for item in os.listdir(default_dir):
                full_path = os.path.join(default_dir, item)
                if os.path.isdir(full_path):
                    projects.append({"name": item, "path": full_path})
        except Exception:
            pass

    return {
        "default": default_dir,
        "projects": projects
    }

@app.get("/api/transcripts")
async def get_transcripts():
    brain_dir = os.path.expanduser(r"~\.gemini\antigravity\brain")
    results = []
    if not os.path.exists(brain_dir):
        return results

    import glob
    pattern = os.path.join(brain_dir, "*", ".system_generated", "logs", "transcript.jsonl")
    log_files = glob.glob(pattern)

    for log_file in log_files:
        try:
            conv_id = log_file.split(os.sep)[-4]
            mtime = os.path.getmtime(log_file)
            with open(log_file, "r", encoding="utf-8") as f:
                lines = [l.strip() for l in f if l.strip()]
                results.append({
                    "conversation_id": conv_id,
                    "log_file": log_file,
                    "total_steps": len(lines),
                    "mtime": mtime
                })
        except Exception:
            continue

    results.sort(key=lambda x: x["mtime"], reverse=True)
    return results[:20]

@app.get("/api/session/{conversation_id}")
async def get_session(conversation_id: str):
    brain_dir = os.path.expanduser(r"~\.gemini\antigravity\brain")
    log_file = os.path.join(brain_dir, conversation_id, ".system_generated", "logs", "transcript.jsonl")

    if not os.path.exists(log_file):
        raise HTTPException(status_code=404, detail="Session not found")

    messages = []
    thoughts = []
    tool_calls = []

    try:
        with open(log_file, "r", encoding="utf-8") as f:
            for line in f:
                line_str = line.strip()
                if not line_str:
                    continue
                try:
                    step = json.loads(line_str)
                    step_type = step.get("type", "")
                    content = step.get("content", "")

                    if step_type == "USER_INPUT":
                        messages.append({"role": "user", "text": content})
                    elif step_type == "PLANNER_RESPONSE" or "tool_calls" in step:
                        if content:
                            messages.append({"role": "agent", "text": content})
                        for tc in step.get("tool_calls", []):
                            tool_name = tc.get("name") or tc.get("function", {}).get("name", "tool")
                            tool_args = tc.get("args") or tc.get("arguments", {})
                            tool_calls.append({"name": tool_name, "args": tool_args})
                    elif "thought" in step_type.lower():
                        thoughts.append(content)
                except Exception:
                    continue
        return {
            "conversation_id": conversation_id,
            "messages": messages,
            "thoughts": thoughts,
            "tool_calls": tool_calls
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/webhook/config")
async def get_webhook_config():
    if os.path.exists(WEBHOOK_CONFIG_FILE):
        try:
            with open(WEBHOOK_CONFIG_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return WebhookConfig().dict()

@app.post("/api/webhook/config")
async def save_webhook_config(config: WebhookConfig):
    os.makedirs(os.path.dirname(WEBHOOK_CONFIG_FILE), exist_ok=True)
    with open(WEBHOOK_CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(config.dict(), f, indent=2)
    return {"success": True}

@app.post("/api/webhook/notify")
async def dispatch_notification(req: NotifyRequest):
    cfg_data = await get_webhook_config()
    results = {}

    async with httpx.AsyncClient(timeout=5.0) as client:
        # Telegram
        if cfg_data.get("telegram_bot_token") and cfg_data.get("telegram_chat_id"):
            try:
                tg_url = f"https://api.telegram.org/bot{cfg_data['telegram_bot_token']}/sendMessage"
                payload = {"chat_id": cfg_data["telegram_chat_id"], "text": f"🤖 Antigravity Notification\n\n*{req.title}*\n{req.message}", "parse_mode": "Markdown"}
                r = await client.post(tg_url, json=payload)
                results["telegram"] = "success" if r.status_code == 200 else f"Failed HTTP {r.status_code}"
            except Exception as e:
                results["telegram"] = f"Error: {str(e)}"

        # WhatsApp Webhook
        if cfg_data.get("whatsapp_webhook_url"):
            try:
                r = await client.post(cfg_data["whatsapp_webhook_url"], json={"event": "antigravity_notify", "title": req.title, "message": req.message})
                results["whatsapp"] = "success" if r.status_code in [200, 201, 202] else f"Failed HTTP {r.status_code}"
            except Exception as e:
                results["whatsapp"] = f"Error: {str(e)}"

    return {"success": True, "results": results}

# Outbound Tunnel for Local Desktop Daemon with Device Registration
@app.websocket("/ws/tunnel")
async def websocket_tunnel(websocket: WebSocket, auth_password: str = None, device_name: str = None):
    await websocket.accept()
    if auth_password != BRIDGE_PASSWORD:
        await websocket.send_json({"type": "error", "content": "Unauthorized Desktop Daemon Password"})
        await websocket.close(code=4001, reason="Unauthorized Desktop Daemon Password")
        return

    device_id = device_name if device_name else f"Desktop-PC-{secrets.token_hex(2)}"
    active_desktop_daemons[device_id] = websocket
    print(f"[VPS Server] Multi-PC Tunnel connected: '{device_id}'")

    try:
        while True:
            data = await websocket.receive_text()
            # Broadcast responses from Desktop Daemon to all connected web UI clients
            for client in list(active_web_clients):
                try:
                    await client.send_text(data)
                except Exception:
                    active_web_clients.discard(client)

    except WebSocketDisconnect:
        if device_id in active_desktop_daemons:
            del active_desktop_daemons[device_id]
        print(f"[VPS Server] Multi-PC Tunnel disconnected: '{device_id}'")

# Client WebSocket for Web UI / Mobile App
@app.websocket("/ws/chat")
async def websocket_chat(websocket: WebSocket, token: str = None):
    await websocket.accept()
    active_web_clients.add(websocket)
    print(f"[VPS Server] Authenticated Web Client connected!")

    try:
        while True:
            data = await websocket.receive_text()
            try:
                payload = json.loads(data)
                target_device = payload.get("target_device", None)

                # Target specific PC daemon if requested, else select first available
                target_ws = None
                if target_device and target_device in active_desktop_daemons:
                    target_ws = active_desktop_daemons[target_device]
                elif active_desktop_daemons:
                    target_ws = next(iter(active_desktop_daemons.values()))

                if target_ws:
                    await target_ws.send_text(data)
                else:
                    await websocket.send_json({
                        "type": "error",
                        "content": "⚠️ No Desktop PC Daemon is currently online. Please run `python run_daemon.py` on your target PC."
                    })

            except json.JSONDecodeError:
                pass

    except WebSocketDisconnect:
        active_web_clients.discard(websocket)
        print("[VPS Server] Web Client disconnected.")

# Serve Frontend Static Assets
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")

if os.path.exists(FRONTEND_DIR):
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

    @app.get("/")
    async def serve_index():
        index_path = os.path.join(FRONTEND_DIR, "index.html")
        with open(index_path, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
