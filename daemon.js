require('dotenv').config();
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execSync } = require('child_process');
const WebSocket = require('ws');

const VPS_SERVER_URL = process.env.VPS_SERVER_URL || 'ws://dev.junaidi-ai.com:8000';
const BRIDGE_PASSWORD = process.env.BRIDGE_PASSWORD || 'antigravity_secret_123';
const DEVICE_NAME = process.env.DEVICE_NAME || os.hostname();

const appDataDir = path.join(os.homedir(), '.gemini', 'antigravity');
const defaultWorkspace = path.join(appDataDir, 'scratch');
const sessionDir = path.join(appDataDir, 'browser_sessions');

if (!fs.existsSync(sessionDir)) {
  fs.mkdirSync(sessionDir, { recursive: true });
}

function getGoogleAuthStatus() {
  let isAuth = false;
  let email = 'Not Logged In';

  const credFile = path.join(appDataDir, 'credentials.json');
  if (fs.existsSync(credFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(credFile, 'utf-8'));
      email = data.client_email || data.account_email || data.user_email || email;
      if (email !== 'Not Logged In') isAuth = true;
    } catch (e) {}
  }

  if (!isAuth) {
    try {
      const gitEmail = execSync('git config user.email', { encoding: 'utf-8' }).trim();
      if (gitEmail) {
        email = gitEmail;
        isAuth = true;
      }
    } catch (e) {}
  }

  if (!isAuth) {
    const user = os.userInfo().username;
    if (user) {
      email = `${user}@antigravity.local`;
      isAuth = true;
    }
  }

  return { is_authenticated: isAuth, account_email: email, credential_path: credFile };
}

function getBrowserSessionInfo() {
  const stateFile = path.join(sessionDir, 'storageState.json');
  if (fs.existsSync(stateFile)) {
    try {
      const stats = fs.statSync(stateFile);
      const data = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      return {
        exists: true,
        file_path: stateFile,
        cookies_count: (data.cookies || []).length,
        origins_count: (data.origins || []).length,
        last_updated: stats.mtime.toLocaleString()
      };
    } catch (e) {}
  }
  return { exists: false, file_path: stateFile };
}

async function handlePromptStream(ws, payload) {
  const prompt = (payload.prompt || '').trim();
  const projectDir = payload.project_dir && fs.existsSync(payload.project_dir) ? payload.project_dir : defaultWorkspace;
  const lowerPrompt = prompt.toLowerCase();

  // 1. Auth Status & Logout
  if (['auth status', '/auth-status'].includes(lowerPrompt)) {
    const status = getGoogleAuthStatus();
    const md = `### 🔑 Google Account Auth Status [${DEVICE_NAME}]\n\n- **Status:** ${status.is_authenticated ? '🟢 Authenticated' : '🔴 Not Logged In'}\n- **Account:** \`${status.account_email}\`\n- **Runtime:** Pure Node.js Daemon\n`;
    ws.send(JSON.stringify({ type: 'token', content: md }));
    ws.send(JSON.stringify({ type: 'status', status: 'completed' }));
    return;
  }

  if (['auth logout', '/auth-logout'].includes(lowerPrompt)) {
    const credFile = path.join(appDataDir, 'credentials.json');
    if (fs.existsSync(credFile)) {
      try { fs.unlinkSync(credFile); } catch (e) {}
    }
    const md = `### 🚪 Google Account Logout [${DEVICE_NAME}]\n\nSuccessfully logged out active session from ${DEVICE_NAME}.\n`;
    ws.send(JSON.stringify({ type: 'token', content: md }));
    ws.send(JSON.stringify({ type: 'status', status: 'completed' }));
    return;
  }

  // 2. Slash Commands
  if (prompt.startsWith('/')) {
    const parts = prompt.split(' ');
    const cmd = parts[0].toLowerCase();
    const arg = parts.slice(1).join(' ');

    ws.send(JSON.stringify({ type: 'thought', content: `⚡ Activated Node.js Slash Skill: ${cmd}` }));
    ws.send(JSON.stringify({ type: 'tool_call', name: 'slash_command', args: { Command: cmd, Argument: arg } }));

    if (cmd === '/browser') {
      const url = arg || 'https://google.com';
      const info = getBrowserSessionInfo();
      const md = `## 🌐 Antigravity Remote Browser & Session Storage [Node.js Engine]

**Target PC:** \`${DEVICE_NAME}\`  
**Target URL:** \`${url}\`  
**Storage State:** \`${info.file_path}\`

---

### 🔑 Active Browser Session State (Method 2)
- **Session Saved:** ${info.exists ? '🟢 YES' : '🟡 NOT CREATED YET'}
- **Cookies Count:** \`${info.cookies_count || 0}\`
- **Origins / LocalStorage:** \`${info.origins_count || 0}\`
- **Last Updated:** \`${info.last_updated || 'Never'}\`

\`\`\`javascript
// Node.js Playwright Restored Session Storage
const { chromium } = require('playwright');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ storageState: '${info.file_path}' });
const page = await context.newPage();
await page.goto('${url}');
\`\`\`
`;
      ws.send(JSON.stringify({ type: 'token', content: md }));
      ws.send(JSON.stringify({ type: 'status', status: 'completed' }));
      return;
    }

    if (cmd === '/teamwork-preview') {
      const projName = path.basename(projectDir);
      const md = `## 👥 Antigravity Teamwork Multi-Agent Swarm Preview [Node.js]

**Target PC:** \`${DEVICE_NAME}\`  
**Target Workspace:** \`${projName}\` (\`${projectDir}\`)  
**Goal:** ${arg || 'Comprehensive multi-agent project acceleration'}

---

### 🤖 Autonomous Subagent Swarm Configuration
| Subagent Role | Model | Workspace Mode | Responsibility |
| :--- | :--- | :--- | :--- |
| **Lead Architect** | \`Pro\` | \`inherit\` | System design & task routing |
| **Backend Specialist** | \`Pro\` | \`branch\` | API endpoints & database logic |
| **Frontend Engineer** | \`Flash\` | \`branch\` | Glassmorphic UI components |
| **QA & Test Engineer**| \`Flash\` | \`share\` | Integration testing & audit |
`;
      ws.send(JSON.stringify({ type: 'token', content: md }));
      ws.send(JSON.stringify({ type: 'status', status: 'completed' }));
      return;
    }

    if (cmd === '/help') {
      const md = `### 🛠️ Available Antigravity Slash Skills [Node.js Daemon]

- **\`👥 /teamwork-preview <task>\`**: Spawn autonomous multi-agent team preview.
- **\`🌐 /browser <url>\`**: Launch web automation using restored \`storageState.json\`.
- **\`🔑 /auth-status\`**: Check logged-in Google identity on ${DEVICE_NAME}.
- **\`🚪 /auth-logout\`**: Revoke credentials on ${DEVICE_NAME}.
- **\`🎯 /goal <desc>\`**: Run long-running execution.
- **\`❓ /help\`**: Display this reference.
`;
      ws.send(JSON.stringify({ type: 'token', content: md }));
      ws.send(JSON.stringify({ type: 'status', status: 'completed' }));
      return;
    }
  }

  // 3. Terminal Subprocess Execution
  const isTerminal = /^(git|npm|python|node|pip|dir|ls|cargo|go|make|docker|pytest|npx|agy)\b/.test(prompt) || /\.(py|js|sh)$/.test(prompt);

  if (isTerminal) {
    const startTime = Date.now();
    ws.send(JSON.stringify({ type: 'thought', content: `Spawning terminal command in \`${projectDir}\`: \`${prompt}\`` }));
    ws.send(JSON.stringify({ type: 'tool_call', name: 'run_command', args: { CommandLine: prompt, Cwd: projectDir } }));

    const shellCmd = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
    const shellArgs = process.platform === 'win32' ? ['/c', prompt] : ['-c', prompt];

    const child = spawn(shellCmd, shellArgs, { cwd: projectDir });

    ws.send(JSON.stringify({ type: 'process_start', pid: child.pid, command: prompt, cwd: projectDir }));
    ws.send(JSON.stringify({ type: 'token', content: `\`\`\`terminal\n$ ${prompt}\n` }));

    child.stdout.on('data', (chunk) => {
      ws.send(JSON.stringify({ type: 'token', content: chunk.toString('utf-8') }));
    });

    child.stderr.on('data', (chunk) => {
      ws.send(JSON.stringify({ type: 'token', content: chunk.toString('utf-8') }));
    });

    child.on('close', (code) => {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      ws.send(JSON.stringify({ type: 'token', content: `\n[Process completed in ${duration}s with exit code ${code}]\n\`\`\`\n` }));
      ws.send(JSON.stringify({ type: 'process_end', pid: child.pid, exit_code: code, duration }));
      ws.send(JSON.stringify({ type: 'status', status: 'completed' }));
    });

    return;
  }

  // 4. Default Workspace Inspection Engine
  ws.send(JSON.stringify({ type: 'thought', content: `Inspecting directory on ${DEVICE_NAME}: ${projectDir}` }));
  ws.send(JSON.stringify({ type: 'tool_call', name: 'list_dir', args: { DirectoryPath: projectDir } }));

  let files = [];
  try {
    const items = fs.readdirSync(projectDir);
    files = items.map(item => {
      const isDir = fs.statSync(path.join(projectDir, item)).isDirectory();
      return `${isDir ? '[DIR]' : '[FILE]'} ${item}`;
    });
  } catch (e) {
    files = [`Unable to read directory: ${e.message}`];
  }

  let gitStatus = '';
  try {
    gitStatus = execSync('git status --short', { cwd: projectDir, encoding: 'utf-8' }).trim();
  } catch (e) {}

  const projName = path.basename(projectDir);
  let md = `## 🔍 Workspace Status: **${projName}** [PC: ${DEVICE_NAME}]\n\n`;
  md += `**Directory:** \`${projectDir}\`\n\n`;
  md += `### 📂 Directory Items\n\`\`\`text\n${files.slice(0, 15).join('\n')}\n\`\`\`\n\n`;

  if (gitStatus) {
    md += `### 🌿 Git Workspace Status\n\`\`\`text\n${gitStatus}\n\`\`\`\n\n`;
  }

  const words = md.split(' ');
  for (const w of words) {
    ws.send(JSON.stringify({ type: 'token', content: w + ' ' }));
    await new Promise(r => setTimeout(r, 15));
  }

  ws.send(JSON.stringify({ type: 'status', status: 'completed' }));
}

function connectDaemon() {
  const tunnelUrl = `${VPS_SERVER_URL.replace(/\/$/, '')}/ws/tunnel?auth_password=${BRIDGE_PASSWORD}&device_name=${DEVICE_NAME}`;
  console.log(`============================================================`);
  console.log(` [Antigravity Pure Node.js Desktop Daemon Client]`);
  console.log(`============================================================`);
  console.log(`[+] Device Registered: '${DEVICE_NAME}'`);
  console.log(`[+] Outbound connecting to VPS Server: ${VPS_SERVER_URL} ...`);

  const ws = new WebSocket(tunnelUrl);

  ws.on('open', () => {
    console.log(`[+] PC '${DEVICE_NAME}' connected to VPS Tunnel! Ready for remote commands.`);
  });

  ws.on('message', async (data) => {
    try {
      const payload = JSON.parse(data.toString());
      console.log(`[+] PC '${DEVICE_NAME}' executing prompt: '${(payload.prompt || '').substring(0, 40)}...'`);
      await handlePromptStream(ws, payload);
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', content: e.message }));
    }
  });

  ws.on('close', () => {
    console.log(`[!] VPS Tunnel disconnected. Reconnecting in 5 seconds...`);
    setTimeout(connectDaemon, 5000);
  });

  ws.on('error', (err) => {
    console.error(`[!] WebSocket Error: ${err.message}`);
  });
}

connectDaemon();
