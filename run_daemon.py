import os
import sys
import socket
import asyncio
from desktop_daemon.desktop_daemon import DesktopDaemonClient

if __name__ == "__main__":
    vps_url = os.getenv("VPS_SERVER_URL", "ws://localhost:8000")
    password = os.getenv("BRIDGE_PASSWORD", "antigravity_secret_123")
    device_name = os.getenv("DEVICE_NAME", socket.gethostname())

    client = DesktopDaemonClient(vps_url, password, device_name)
    try:
        asyncio.run(client.connect_and_listen())
    except KeyboardInterrupt:
        print("\n[+] Desktop Daemon stopped.")
