require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8000;
const BRIDGE_PASSWORD = process.env.BRIDGE_PASSWORD || 'antigravity_secret_123';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';

const ACTIVE_TOKENS = new Set();

// Multi-PC Registry: device_name -> WebSocket
const activeDaemons = new Map();
const activeWebClients = new Set();

function getRedirectUri(req) {
  if (process.env.GOOGLE_REDIRECT_URI) {
    return process.env.GOOGLE_REDIRECT_URI;
  }
  const host = req.headers.host || `localhost:${PORT}`;
  const protocol = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
  return `${protocol}://${host}/api/auth/google/callback`;
}

// Password Login Endpoint
app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (password === BRIDGE_PASSWORD) {
    const token = crypto.randomBytes(24).toString('hex');
    ACTIVE_TOKENS.add(token);
    return res.json({ success: true, token });
  }
  return res.status(401).json({ detail: 'Invalid Bridge Password' });
});

// Dynamic Google OAuth 2.0 Initiator Endpoint
app.get('/api/auth/google', (req, res) => {
  if (!GOOGLE_CLIENT_ID) {
    return res.status(400).send(`
      <h2>⚠️ Google OAuth Client ID Not Configured</h2>
      <p>Please set <code>GOOGLE_CLIENT_ID</code> in your <code>.env</code> file or environment variables.</p>
    `);
  }

  const redirectUri = getRedirectUri(req);
  const scope = encodeURIComponent('openid email profile');
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&access_type=offline&prompt=consent`;

  res.redirect(authUrl);
});

// Dynamic Google OAuth 2.0 Callback Endpoint
app.get('/api/auth/google/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.status(400).send('OAuth Code missing');
  }

  try {
    const redirectUri = getRedirectUri(req);

    const params = new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    });

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });

    const tokenData = await tokenResponse.json();
    let userEmail = 'Authenticated Google User';

    if (tokenData.access_token) {
      const profileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      const profile = await profileResponse.json();
      userEmail = profile.email || userEmail;
    }

    // Broadcast authenticated user email to target PC daemon
    for (const daemonWs of activeDaemons.values()) {
      if (daemonWs.readyState === 1) {
        daemonWs.send(JSON.stringify({
          prompt: `git config --global user.email "${userEmail}"`,
          project_dir: '',
          direct_mode: true
        }));
      }
    }

    res.send(`
      <html>
        <body style="font-family:sans-serif; text-align:center; padding:50px; background:#F8FAFC;">
          <h2 style="color:#10B981;">🟢 Google Authentication Successful!</h2>
          <p>Logged in as: <strong>${userEmail}</strong></p>
          <p>Credentials applied to target PC. You can close this window now.</p>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'google_auth_success', email: '${userEmail}' }, '*');
              setTimeout(() => window.close(), 2000);
            }
          </script>
        </body>
      </html>
    `);

  } catch (e) {
    res.status(500).send(`Server OAuth Exception: ${e.message}`);
  }
});

// System Status Endpoint
app.get('/api/status', (req, res) => {
  const redirectUri = getRedirectUri(req);

  res.json({
    vps_status: 'online',
    runtime: 'Node.js Express',
    google_client_id: GOOGLE_CLIENT_ID,
    google_oauth_configured: Boolean(GOOGLE_CLIENT_ID),
    active_redirect_uri: redirectUri,
    desktop_daemon_connected: activeDaemons.size > 0,
    active_daemons: Array.from(activeDaemons.keys()),
    active_clients: activeWebClients.size,
    requires_auth: true
  });
});

// List Connected PC Daemons Endpoint
app.get('/api/daemons', (req, res) => {
  const daemons = Array.from(activeDaemons.keys()).map(name => ({
    device_name: name,
    status: 'online'
  }));
  res.json({ daemons });
});

// Projects Workspace Endpoint
app.get('/api/projects', (req, res) => {
  const homeDir = process.env.USERPROFILE || process.env.HOME || '';
  const defaultDir = path.join(homeDir, '.gemini', 'antigravity', 'scratch');
  const projects = [];

  if (fs.existsSync(defaultDir)) {
    try {
      const items = fs.readdirSync(defaultDir);
      for (const item of items) {
        const fullPath = path.join(defaultDir, item);
        if (fs.statSync(fullPath).isDirectory()) {
          projects.push({ name: item, path: fullPath });
        }
      }
    } catch (e) {}
  }

  res.json({ default: defaultDir, projects });
});

// Recent Transcripts Log Scanner Endpoint
app.get('/api/transcripts', (req, res) => {
  const homeDir = process.env.USERPROFILE || process.env.HOME || '';
  const brainDir = path.join(homeDir, '.gemini', 'antigravity', 'brain');
  const results = [];

  if (fs.existsSync(brainDir)) {
    try {
      const convFolders = fs.readdirSync(brainDir);
      for (const folder of convFolders) {
        const logFile = path.join(brainDir, folder, '.system_generated', 'logs', 'transcript.jsonl');
        if (fs.existsSync(logFile)) {
          const stats = fs.statSync(logFile);
          const content = fs.readFileSync(logFile, 'utf-8');
          const lines = content.split('\n').filter(l => l.trim());
          results.push({
            conversation_id: folder,
            log_file: logFile,
            total_steps: lines.length,
            mtime: stats.mtimeMs / 1000
          });
        }
      }
    } catch (e) {}
  }

  results.sort((a, b) => b.mtime - a.mtime);
  res.json(results.slice(0, 20));
});

// Load Specific Session Details Endpoint
app.get('/api/session/:id', (req, res) => {
  const convId = req.params.id;
  const homeDir = process.env.USERPROFILE || process.env.HOME || '';
  const logFile = path.join(homeDir, '.gemini', 'antigravity', 'brain', convId, '.system_generated', 'logs', 'transcript.jsonl');

  if (!fs.existsSync(logFile)) {
    return res.status(404).json({ error: 'Session log not found' });
  }

  const messages = [];
  const thoughts = [];
  const toolCalls = [];

  try {
    const lines = fs.readFileSync(logFile, 'utf-8').split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        const step = JSON.parse(line);
        const type = step.type || '';
        const content = step.content || '';

        if (type === 'USER_INPUT') {
          messages.push({ role: 'user', text: content });
        } else if (type === 'PLANNER_RESPONSE' || step.tool_calls) {
          if (content) messages.push({ role: 'agent', text: content });
          if (step.tool_calls) {
            for (const tc of step.tool_calls) {
              toolCalls.push({ name: tc.name || 'tool', args: tc.args || {} });
            }
          }
        } else if (type.toLowerCase().includes('thought')) {
          thoughts.push(content);
        }
      } catch (e) {}
    }
    return res.json({ conversation_id: convId, messages, thoughts, tool_calls: toolCalls });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// Serve Frontend Static Web UI Assets
const frontendDir = path.join(__dirname, 'frontend');
if (fs.existsSync(frontendDir)) {
  app.use('/static', express.static(frontendDir));
  app.get('/', (req, res) => {
    res.sendFile(path.join(frontendDir, 'index.html'));
  });
}

// WebSocket Server Integration
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const urlObj = new URL(request.url, `http://${request.headers.host}`);
  const pathname = urlObj.pathname;

  wss.handleUpgrade(request, socket, head, (ws) => {
    if (pathname === '/ws/tunnel') {
      handleDaemonTunnel(ws, urlObj.searchParams);
    } else if (pathname === '/ws/chat') {
      handleWebClientChat(ws, urlObj.searchParams);
    } else {
      ws.close();
    }
  });
});

// Outbound Desktop Daemon Tunnel Handler
function handleDaemonTunnel(ws, searchParams) {
  const password = searchParams.get('auth_password');
  const deviceName = searchParams.get('device_name') || `Desktop-PC-${crypto.randomBytes(2).toString('hex')}`;

  if (password !== BRIDGE_PASSWORD) {
    ws.send(JSON.stringify({ type: 'error', content: 'Unauthorized Desktop Daemon Password' }));
    ws.close(4001, 'Unauthorized');
    return;
  }

  activeDaemons.set(deviceName, ws);
  console.log(`[Express VPS Server] Multi-PC Tunnel connected: '${deviceName}'`);

  ws.on('message', (data) => {
    const msgStr = data.toString();
    for (const client of activeWebClients) {
      if (client.readyState === 1) {
        client.send(msgStr);
      }
    }
  });

  ws.on('close', () => {
    activeDaemons.delete(deviceName);
    console.log(`[Express VPS Server] Multi-PC Tunnel disconnected: '${deviceName}'`);
  });
}

// Web Client UI Chat Handler
function handleWebClientChat(ws, searchParams) {
  activeWebClients.add(ws);
  console.log(`[Express VPS Server] Web UI Client connected!`);

  ws.on('message', (data) => {
    try {
      const payload = JSON.parse(data.toString());
      const targetDevice = payload.target_device;

      let targetWs = null;
      if (targetDevice && activeDaemons.has(targetDevice)) {
        targetWs = activeDaemons.get(targetDevice);
      } else if (activeDaemons.size > 0) {
        targetWs = activeDaemons.values().next().value;
      }

      if (targetWs && targetWs.readyState === 1) {
        targetWs.send(data.toString());
      } else {
        ws.send(JSON.stringify({
          type: 'error',
          content: '⚠️ No Desktop PC Daemon is currently online. Run `npm run daemon` on your target PC.'
        }));
      }
    } catch (e) {}
  });

  ws.on('close', () => {
    activeWebClients.delete(ws);
    console.log('[Express VPS Server] Web UI Client disconnected.');
  });
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`============================================================`);
  console.log(` [Antigravity Express + Node.js VPS Server Running]`);
  console.log(`============================================================`);
  console.log(`[+] Web UI & REST API listening on http://0.0.0.0:${PORT}`);
  console.log(`[+] Google Client ID: ${GOOGLE_CLIENT_ID || 'Configured via .env'}`);
  console.log(`============================================================`);
});
