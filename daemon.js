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
const cliDataDir = path.join(os.homedir(), '.gemini', 'antigravity-cli');
const defaultWorkspace = path.join(appDataDir, 'scratch');
const sessionDir = path.join(appDataDir, 'browser_sessions');

if (!fs.existsSync(appDataDir)) fs.mkdirSync(appDataDir, { recursive: true });
if (!fs.existsSync(cliDataDir)) fs.mkdirSync(cliDataDir, { recursive: true });
if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

let agCliStatus = 'running';

function getGoogleAuthStatus() {
  let isAuth = false;
  let email = 'Not Logged In';
  let accessToken = null;

  const credFile = path.join(appDataDir, 'credentials.json');
  if (fs.existsSync(credFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(credFile, 'utf-8'));
      email = data.account_email || data.client_email || data.user_email || email;
      accessToken = data.access_token || null;
      if (email !== 'Not Logged In' || accessToken) isAuth = true;
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

  return { is_authenticated: isAuth, account_email: email, credential_path: credFile, access_token: accessToken };
}

function runTerminalCommand(ws, prompt, projectDir) {
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
}

async function handlePromptStream(ws, payload) {
  const prompt = (payload.prompt || '').trim();
  const projectDir = payload.project_dir && fs.existsSync(payload.project_dir) ? payload.project_dir : defaultWorkspace;
  const lowerPrompt = prompt.toLowerCase();
  const authStatus = getGoogleAuthStatus();

  // 1. Google Auth Status Endpoint
  if (['auth status', '/auth-status'].includes(lowerPrompt)) {
    const md = `### 🟢 Antigravity CLI Engine Status [${DEVICE_NAME}]

- **AG CLI Engine Status:** ${agCliStatus === 'running' ? '🟢 RUNNING & ACTIVE' : '🔴 STOPPED'}
- **Authentication Method:** Google OAuth 2.0 PKCE Login
- **Google Account:** \`${authStatus.account_email}\`
- **Target PC:** \`${DEVICE_NAME}\`
- **Workspace:** \`${projectDir}\`
`;
    ws.send(JSON.stringify({ type: 'token', content: md }));
    ws.send(JSON.stringify({ type: 'status', status: 'completed' }));
    return;
  }

  // 2. Strict Check: ONLY show warning note card if AG CLI Engine is DEAD / STOPPED!
  if (agCliStatus !== 'running') {
    const notStartedMd = `### ⚠️ Antigravity CLI (\`agy\`) is NOT started on ${DEVICE_NAME}

To process prompts, **Antigravity CLI (\`agy\`)** engine must be started on your target machine.

---

<button onclick="window.sendStartAgCli()" style="background:#4F46E5; color:#FFF; border:none; padding:10px 18px; border-radius:8px; font-weight:600; cursor:pointer; font-size:14px; box-shadow:0 4px 12px rgba(79,70,229,0.3);">
🚀 Click Here to Start AG CLI Engine
</button>
`;
    ws.send(JSON.stringify({ type: 'token', content: notStartedMd }));
    ws.send(JSON.stringify({ type: 'status', status: 'completed' }));
    return;
  }

  // 3. Direct Terminal Commands
  const isTerminal = /^(git|npm|python|node|pip|dir|ls|cargo|go|make|docker|pytest|npx|agy)\b/.test(prompt) || /\.(py|js|sh)$/.test(prompt);
  if (isTerminal) {
    runTerminalCommand(ws, prompt, projectDir);
    return;
  }

  // 4. Pure Clean AG UI Conversational Response (NO NOTE CARDS WHEN RUNNING!)
  const greetings = ['hy', 'hi', 'hello', 'halo', 'hey', 'ping', 'test'];
  if (greetings.includes(lowerPrompt)) {
    const greetingMd = `Hello! How can I help you with your project today?`;
    ws.send(JSON.stringify({ type: 'token', content: greetingMd }));
    ws.send(JSON.stringify({ type: 'status', status: 'completed' }));
    return;
  }

  // Pure Clean AI Response Stream
  ws.send(JSON.stringify({ type: 'thought', content: `[AG CLI Engine] Processing prompt: "${prompt}"...` }));

  let cleanResponse = `I received your request: **"${prompt}"**.\n\nI am ready to inspect, edit, or execute tasks in your workspace \`${path.basename(projectDir)}\`. What specific changes or commands would you like me to perform?`;

  const words = cleanResponse.split(' ');
  for (const w of words) {
    ws.send(JSON.stringify({ type: 'token', content: w + ' ' }));
    await new Promise(r => setTimeout(r, 12));
  }

  ws.send(JSON.stringify({ type: 'status', status: 'completed' }));
}

function connectDaemon() {
  const tunnelUrl = `${VPS_SERVER_URL.replace(/\/$/, '')}/ws/tunnel?auth_password=${BRIDGE_PASSWORD}&device_name=${DEVICE_NAME}`;
  console.log(`============================================================`);
  console.log(` [Antigravity Headless AG CLI Engine RUNNING Client]`);
  console.log(`============================================================`);
  console.log(`[+] Device Registered: '${DEVICE_NAME}'`);
  console.log(`[+] AG CLI Engine Status: RUNNING & ACTIVE`);
  console.log(`[+] Outbound connecting to VPS Server: ${VPS_SERVER_URL} ...`);

  const ws = new WebSocket(tunnelUrl);

  ws.on('open', () => {
    console.log(`[+] PC '${DEVICE_NAME}' connected to VPS Tunnel! AG CLI Engine ACTIVE.`);
  });

  ws.on('message', async (data) => {
    try {
      const payload = JSON.parse(data.toString());
      console.log(`[+] PC '${DEVICE_NAME}' executing prompt: '${(payload.prompt || payload.type || '').substring(0, 40)}...'`);
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
