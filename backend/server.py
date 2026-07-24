import os
import json
import httpx
import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel
from typing import Optional, Dict, Any

from backend.antigravity_service import AntigravityService, HAS_SDK

app = FastAPI(title="Antigravity Remote Bridge", version="1.2.0")

service = AntigravityService()

webhook_config: Dict[str, Any] = {
    "telegram_bot_token": "",
    "telegram_chat_id": "",
    "whatsapp_webhook_url": "",
    "pushover_user_key": "",
    "pushover_api_token": "",
    "enable_auto_notify": True
}

class WebhookConfigModel(BaseModel):
    telegram_bot_token: Optional[str] = ""
    telegram_chat_id: Optional[str] = ""
    whatsapp_webhook_url: Optional[str] = ""
    pushover_user_key: Optional[str] = ""
    pushover_api_token: Optional[str] = ""
    enable_auto_notify: Optional[bool] = True

class NotifyRequest(BaseModel):
    title: str
    message: str
    target: Optional[str] = "all"

frontend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))
app.mount("/static", StaticFiles(directory=frontend_dir), name="static")

@app.get("/", response_class=HTMLResponse)
async def get_index():
    index_path = os.path.join(frontend_dir, "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse("<h2>Frontend Not Found</h2>", status_code=404)

@app.get("/api/status")
async def get_status():
    return {
        "status": "online",
        "has_sdk": HAS_SDK,
        "default_workspace": service.default_workspace,
        "brain_dir": service.brain_dir,
        "webhook_configured": bool(
            webhook_config["telegram_bot_token"] or 
            webhook_config["whatsapp_webhook_url"] or 
            webhook_config["pushover_user_key"]
        )
    }

@app.get("/api/projects")
async def list_projects():
    scratch_dir = service.default_workspace
    projects = []
    if os.path.exists(scratch_dir):
        for entry in os.listdir(scratch_dir):
            full_path = os.path.join(scratch_dir, entry)
            if os.path.isdir(full_path):
                projects.append({
                    "name": entry,
                    "path": full_path
                })
    return {"default": scratch_dir, "projects": projects}

@app.get("/api/transcripts")
async def get_transcripts(limit: int = 15):
    return service.get_recent_transcripts(limit=limit)

@app.get("/api/session/{conversation_id}")
async def get_session(conversation_id: str):
    data = service.get_session_details(conversation_id)
    if "error" in data:
        raise HTTPException(status_code=404, detail=data["error"])
    return data

@app.get("/api/webhook/config")
async def get_webhook_config():
    masked = webhook_config.copy()
    if masked["telegram_bot_token"]:
        masked["telegram_bot_token"] = masked["telegram_bot_token"][:6] + "..." + masked["telegram_bot_token"][-4:]
    return masked

@app.post("/api/webhook/config")
async def save_webhook_config(config: WebhookConfigModel):
    global webhook_config
    data = config.dict()
    for k, v in data.items():
        if v is not None:
            if k == "telegram_bot_token" and "..." in v:
                continue
            webhook_config[k] = v
    return {"status": "saved", "config": await get_webhook_config()}

@app.post("/api/webhook/notify")
async def send_notification(req: NotifyRequest):
    results = {}
    async with httpx.AsyncClient(timeout=10.0) as client:
        if (req.target in ["telegram", "all"]) and webhook_config["telegram_bot_token"] and webhook_config["telegram_chat_id"]:
            try:
                tg_url = f"https://api.telegram.org/bot{webhook_config['telegram_bot_token']}/sendMessage"
                payload = {
                    "chat_id": webhook_config["telegram_chat_id"],
                    "text": f"🚀 *{req.title}*\n\n{req.message}",
                    "parse_mode": "Markdown"
                }
                res = await client.post(tg_url, json=payload)
                results["telegram"] = res.status_code == 200
            except Exception as e:
                results["telegram_error"] = str(e)

        if (req.target in ["whatsapp", "all"]) and webhook_config["whatsapp_webhook_url"]:
            try:
                payload = {"title": req.title, "message": req.message}
                res = await client.post(webhook_config["whatsapp_webhook_url"], json=payload)
                results["whatsapp"] = res.status_code in [200, 201, 202]
            except Exception as e:
                results["whatsapp_error"] = str(e)

        if (req.target in ["pushover", "all"]) and webhook_config["pushover_user_key"] and webhook_config["pushover_api_token"]:
            try:
                po_url = "https://api.pushover.net/1/messages.json"
                payload = {
                    "token": webhook_config["pushover_api_token"],
                    "user": webhook_config["pushover_user_key"],
                    "title": req.title,
                    "message": req.message
                }
                res = await client.post(po_url, data=payload)
                results["pushover"] = res.status_code == 200
            except Exception as e:
                results["pushover_error"] = str(e)

    return {"status": "dispatched", "results": results}

@app.websocket("/ws/chat")
async def websocket_chat(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            raw_data = await websocket.receive_text()
            project_dir = None
            direct_mode = True
            
            try:
                payload = json.loads(raw_data)
                prompt = payload.get("prompt", "").strip()
                project_dir = payload.get("project_dir", None)
                direct_mode = payload.get("direct_mode", True)
            except Exception:
                prompt = raw_data.strip()

            if not prompt:
                continue

            full_response_text = ""
            async for event in service.chat_stream(prompt, project_dir=project_dir, direct_mode=direct_mode):
                if event["type"] == "token":
                    full_response_text += event["content"]
                await websocket.send_text(json.dumps(event))

            if webhook_config["enable_auto_notify"] and (
                webhook_config["telegram_bot_token"] or 
                webhook_config["whatsapp_webhook_url"] or 
                webhook_config["pushover_user_key"]
            ):
                summary = full_response_text[:300] + ("..." if len(full_response_text) > 300 else "")
                asyncio.create_task(
                    send_notification(NotifyRequest(
                        title="Antigravity Response Complete",
                        message=f"Prompt: {prompt[:100]}\n\nOutput: {summary}"
                    ))
                )

    except WebSocketDisconnect:
        pass
    except Exception as e:
        await websocket.send_text(json.dumps({"type": "error", "content": str(e)}))
