import sys
import os
import subprocess
import webbrowser

# Add current directory to Python path
project_root = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, project_root)

def check_and_install_dependencies():
    required_packages = ["fastapi", "uvicorn", "websockets", "httpx"]
    missing = []
    
    for pkg in required_packages:
        try:
            __import__(pkg)
        except ImportError:
            missing.append(pkg)
            
    if missing:
        print(f"Installing missing dependencies: {', '.join(missing)}...")
        req_file = os.path.join(project_root, "backend", "requirements.txt")
        subprocess.run([sys.executable, "-m", "pip", "install", "-r", req_file], check=True)

if __name__ == "__main__":
    print("=" * 60)
    print(" [Antigravity Remote Bridge Launcher]")
    print("=" * 60)
    
    check_and_install_dependencies()

    import uvicorn
    from backend.server import app

    host = "0.0.0.0"
    port = 8000

    print(f"\n[+] Server starting on http://localhost:{port}")
    print(f"[+] Access locally at: http://localhost:{port}")
    print(f"[+] To access remotely on phone/outside Wi-Fi, run: ngrok http {port}\n")

    try:
        webbrowser.open(f"http://localhost:{port}")
    except Exception:
        pass

    uvicorn.run(app, host=host, port=port, log_level="info")
