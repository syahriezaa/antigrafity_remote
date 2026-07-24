import os
import sys
import json
import socket
import asyncio
import websockets
from typing import Dict, Any

# Ensure backend modules are imported
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(os.path.join(BASE_DIR, "backend"))

from antigravity_service import AntigravityService

VPS_SERVER_URL = os.getenv("VPS_SERVER_URL", "ws://localhost:8000")
BRIDGE_PASSWORD = os.getenv("BRIDGE_PASSWORD", "antigravity_secret_123")
DEVICE_NAME = os.getenv("DEVICE_NAME", socket.gethostname())

class DesktopDaemonClient:
    def __init__(self, server_url: str, password: str, device_name: str):
        self.server_url = server_url.rstrip("/")
        self.password = password
        self.device_name = device_name
        self.service = AntigravityService()

    async def connect_and_listen(self):
        tunnel_url = f"{self.server_url}/ws/tunnel?auth_password={self.password}&device_name={self.device_name}"
        print(f"============================================================")
        print(f" [Antigravity Local Desktop Daemon Client]")
        print(f"============================================================")
        print(f"[+] Device Name Registered: '{self.device_name}'")
        print(f"[+] Outbound connecting to VPS Server: {self.server_url} ...")

        while True:
            try:
                async with websockets.connect(tunnel_url) as ws:
                    print(f"[+] PC '{self.device_name}' connected to VPS Tunnel! Ready for remote commands.")
                    
                    while True:
                        msg_str = await ws.recv()
                        try:
                            payload = json.loads(msg_str)

                            # Handle Special Auth Actions
                            action = payload.get("action")
                            if action == "get_auth_status":
                                status = self.service.get_google_auth_status()
                                await ws.send(json.dumps({"type": "auth_status", "data": status, "device_name": self.device_name}))
                                continue

                            elif action == "auth_logout":
                                res = self.service.google_auth_logout()
                                await ws.send(json.dumps({"type": "auth_logout_result", "data": res, "device_name": self.device_name}))
                                continue

                            prompt = payload.get("prompt", "")
                            project_dir = payload.get("project_dir", None)
                            direct_mode = payload.get("direct_mode", True)

                            print(f"[+] PC '{self.device_name}' executing remote prompt: '{prompt[:40]}...'")

                            async for event in self.service.chat_stream(prompt, project_dir, direct_mode):
                                await ws.send(json.dumps(event))

                        except json.JSONDecodeError:
                            continue
                        except Exception as ex:
                            await ws.send(json.dumps({"type": "error", "content": str(ex)}))

            except (websockets.exceptions.ConnectionClosedError, ConnectionRefusedError, OSError) as e:
                print(f"[!] Tunnel disconnected ({e}). Retrying in 5 seconds...")
                await asyncio.sleep(5)

if __name__ == "__main__":
    client = DesktopDaemonClient(VPS_SERVER_URL, BRIDGE_PASSWORD, DEVICE_NAME)
    try:
        asyncio.run(client.connect_and_listen())
    except KeyboardInterrupt:
        print("\n[+] Desktop Daemon stopped.")
