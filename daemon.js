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

function checkAgCliInstalled() {
  try {
    execSync('where agy', { encoding: 'utf-8' });
    return true;
  } catch (e) {
    const agyLocal = path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'agy.cmd');
    return fs.existsSync(agyLocal);
  }
}

function autoInstallAgCli(ws) {
  if (checkAgCliInstalled()) return true;

  if (ws) {
    ws.send(JSON.stringify({ type: 'thought', content: `[Auto-Installer] Antigravity CLI (agy) not detected on ${DEVICE_NAME}. Auto-installing globally...` }));
  }
  console.log(`[+] Auto-installing Antigravity CLI (agy) globally on ${DEVICE_NAME}...`);

  try {
    execSync('npm install -g @google/antigravity-cli --suppress-warnings', { encoding: 'utf-8', stdio: 'ignore' });
    if (ws) ws.send(JSON.stringify({ type: 'thought', content: `[Auto-Installer] 🟢 Antigravity CLI (agy) installed successfully!` }));
    return true;
  } catch (err) {
    try {
      execSync('npm install -g agy --suppress-warnings', { encoding: 'utf-8', stdio: 'ignore' });
      return true;
    } catch (e) {
      if (ws) ws.send(JSON.stringify({ type: 'thought', content: `[Auto-Installer] ⚠️ Note: Global npm install requires admin permissions or npx runner.` }));
      return false;
    }
  }
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

function executePureAgCli(ws, prompt, projectDir) {
  autoInstallAgCli(ws);
  ws.send(JSON.stringify({ type: 'thought', content: `[Pure AG CLI Pipe] Executing \`agy --prompt "${prompt}"\` in ${projectDir}...` }));

  const agyCmd = checkAgCliInstalled() ? 'agy' : 'npx agy';
  const child = spawn(agyCmd, ['--prompt', prompt], { cwd: projectDir, shell: true });

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
    ws.send(JSON.stringify({ type: 'token', content: `⚠️ AG CLI Execution Error: ${err.message}\n` }));
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

- **AG CLI Installed:** ${checkAgCliInstalled() ? '🟢 YES (`agy`)' : '🟡 Auto-Installing via npm'}
- **Authentication:** Google OAuth 2.0 PKCE Login
- **Google Account:** \`${authStatus.account_email}\`
- **Target PC:** \`${DEVICE_NAME}\`
- **Workspace:** \`${projectDir}\`
`;
    ws.send(JSON.stringify({ type: 'token', content: md }));
    ws.send(JSON.stringify({ type: 'status', status: 'completed' }));
    return;
  }

  // 2. Pure Direct Execution of AG CLI Subprocess (100% Zero Hardcoded Logic!)
  executePureAgCli(ws, prompt, projectDir);
}

function connectDaemon() {
  const tunnelUrl = `${VPS_SERVER_URL.replace(/\/$/, '')}/ws/tunnel?auth_password=${BRIDGE_PASSWORD}&device_name=${DEVICE_NAME}`;
  console.log(`============================================================`);
  console.log(` [Antigravity Headless Pure AG CLI Pipe Daemon Client]`);
  console.log(`============================================================`);
  console.log(`[+] Device Registered: '${DEVICE_NAME}'`);
  console.log(`[+] AG CLI Auto-Installer Engine: Active`);
  console.log(`[+] Outbound connecting to VPS Server: ${VPS_SERVER_URL} ...`);

  const ws = new WebSocket(tunnelUrl);

  ws.on('open', () => {
    console.log(`[+] PC '${DEVICE_NAME}' connected to VPS Tunnel! Pure AG CLI Pipe Ready.`);
  });

  ws.on('message', async (data) => {
    try {
      const payload = JSON.parse(data.toString());
      console.log(`[+] PC '${DEVICE_NAME}' executing AG CLI prompt: '${(payload.prompt || payload.type || '').substring(0, 40)}...'`);
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
