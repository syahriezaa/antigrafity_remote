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

function getAgyExecutablePath() {
  const localAgy = path.join(os.homedir(), 'AppData', 'Local', 'agy', 'bin', 'agy.exe');
  if (fs.existsSync(localAgy)) return localAgy;

  try {
    const wherePath = execSync('where agy', { encoding: 'utf-8' }).trim().split('\n')[0].trim();
    if (wherePath && fs.existsSync(wherePath)) return wherePath;
  } catch (e) {}

  return 'agy';
}

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

function executePureAgCliBinary(ws, prompt, projectDir) {
  const agyExec = getAgyExecutablePath();
  ws.send(JSON.stringify({ type: 'thought', content: `[Pure Official AG CLI Engine] Spawning \`${agyExec} --prompt "${prompt}" --dangerously-skip-permissions\` in ${projectDir}...` }));

  const args = ['--prompt', prompt, '--dangerously-skip-permissions'];
  const child = spawn(agyExec, args, { cwd: projectDir, shell: false });

  child.stdout.on('data', (chunk) => {
    ws.send(JSON.stringify({ type: 'token', content: chunk.toString('utf-8') }));
  });

  child.stderr.on('data', (chunk) => {
    ws.send(JSON.stringify({ type: 'token', content: chunk.toString('utf-8') }));
  });

  child.on('close', (code) => {
    ws.send(JSON.stringify({ type: 'status', status: 'completed' }));
  });

  child.on('error', (err) => {
    ws.send(JSON.stringify({ type: 'token', content: `⚠️ Official AG CLI Execution Error: ${err.message}\n` }));
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
    const md = `### 🟢 Official Google Antigravity CLI Engine Status [${DEVICE_NAME}]

- **AG CLI Executable Binary:** \`${getAgyExecutablePath()}\`
- **Authentication:** Google OAuth 2.0 PKCE Login
- **Google Account:** \`${authStatus.account_email}\`
- **Target PC:** \`${DEVICE_NAME}\`
- **Workspace:** \`${projectDir}\`
`;
    ws.send(JSON.stringify({ type: 'token', content: md }));
    ws.send(JSON.stringify({ type: 'status', status: 'completed' }));
    return;
  }

  // 2. Active Workspace Slash Command
  if (['/workspace', 'workspace status', '/set-workspace'].includes(lowerPrompt)) {
    const md = `### 📁 Active Antigravity Workspace Status [${DEVICE_NAME}]

- **Active Workspace Path:** \`${projectDir}\`
- **Directory Exists:** ${fs.existsSync(projectDir) ? '🟢 YES' : '🔴 NO'}
- **Default Fallback Scratch:** \`${defaultWorkspace}\`
- **AG CLI Settings File:** \`${path.join(cliDataDir, 'settings.json')}\`

*Tip: Click the **💾 Save Default** button in the Web UI bar to save this workspace directory as your default!*
`;
    ws.send(JSON.stringify({ type: 'token', content: md }));
    ws.send(JSON.stringify({ type: 'status', status: 'completed' }));
    return;
  }

  // 3. Pure Direct Execution of Official AG CLI Binary (100% Zero Hardcoded Logic!)
  executePureAgCliBinary(ws, prompt, projectDir);
}

function connectDaemon() {
  const tunnelUrl = `${VPS_SERVER_URL.replace(/\/$/, '')}/ws/tunnel?auth_password=${BRIDGE_PASSWORD}&device_name=${DEVICE_NAME}`;
  console.log(`============================================================`);
  console.log(` [Official Google Antigravity Headless CLI Daemon Client]`);
  console.log(`============================================================`);
  console.log(`[+] Device Registered: '${DEVICE_NAME}'`);
  console.log(`[+] Official agy.exe Path: ${getAgyExecutablePath()}`);
  console.log(`[+] Outbound connecting to VPS Server: ${VPS_SERVER_URL} ...`);

  const ws = new WebSocket(tunnelUrl);

  ws.on('open', () => {
    console.log(`[+] PC '${DEVICE_NAME}' connected to VPS Tunnel! Official agy.exe Ready.`);
  });

  ws.on('message', async (data) => {
    try {
      const payload = JSON.parse(data.toString());
      console.log(`[+] PC '${DEVICE_NAME}' executing agy.exe prompt: '${(payload.prompt || payload.type || '').substring(0, 40)}...'`);
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
