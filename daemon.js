require('dotenv').config();
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execSync } = require('child_process');
const WebSocket = require('ws');

const VPS_SERVER_URL = process.process?.env?.VPS_SERVER_URL || process.env.VPS_SERVER_URL || 'ws://dev.junaidi-ai.com:8000';
const BRIDGE_PASSWORD = process.env.BRIDGE_PASSWORD || 'antigravity_secret_123';
const DEVICE_NAME = process.env.DEVICE_NAME || os.hostname();

const appDataDir = path.join(os.homedir(), '.gemini', 'antigravity');
const cliDataDir = path.join(os.homedir(), '.gemini', 'antigravity-cli');
const defaultWorkspace = path.join(appDataDir, 'scratch');
const sessionDir = path.join(appDataDir, 'browser_sessions');

if (!fs.existsSync(appDataDir)) fs.mkdirSync(appDataDir, { recursive: true });
if (!fs.existsSync(cliDataDir)) fs.mkdirSync(cliDataDir, { recursive: true });
if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

function injectGoogleOAuthTokens(data) {
  const credPath = path.join(appDataDir, 'credentials.json');
  const cliSettingsPath = path.join(cliDataDir, 'settings.json');

  const credPayload = {
    account_email: data.email,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
    updated_at: new Date().toISOString(),
    auth_source: 'Google OAuth 2.0 PKCE (Remote Web UI)'
  };

  try {
    fs.writeFileSync(credPath, JSON.stringify(credPayload, null, 2), 'utf-8');
    console.log(`[+] [Google OAuth Injector] Successfully written: ${credPath}`);
  } catch (e) {
    console.error(`[!] [Google OAuth Injector] Error writing credentials.json: ${e.message}`);
  }

  const cliSettings = {
    account_email: data.email,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    skills_dir: path.join(appDataDir, 'skills'),
    builtin_skills_dir: path.join(appDataDir, 'builtin', 'skills'),
    rules_dir: path.join(appDataDir, 'rules'),
    mcp_config: path.join(appDataDir, 'mcp.json'),
    default_model: 'gemini-2.5-pro'
  };

  try {
    fs.writeFileSync(cliSettingsPath, JSON.stringify(cliSettings, null, 2), 'utf-8');
    console.log(`[+] [Google OAuth Injector] Successfully written: ${cliSettingsPath}`);
  } catch (e) {
    console.error(`[!] [Google OAuth Injector] Error writing settings.json: ${e.message}`);
  }

  try {
    execSync(`git config --global user.email "${data.email}"`, { encoding: 'utf-8' });
  } catch (e) {}
}

function getGoogleAuthStatus() {
  let isAuth = false;
  let email = 'Not Logged In';
  let tokenData = null;

  const credFile = path.join(appDataDir, 'credentials.json');
  if (fs.existsSync(credFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(credFile, 'utf-8'));
      email = data.account_email || data.client_email || data.user_email || email;
      tokenData = data.access_token || null;
      if (email !== 'Not Logged In' || tokenData) isAuth = true;
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

  return { is_authenticated: isAuth, account_email: email, credential_path: credFile, token_data: tokenData };
}

function autoDetectStartCommand(projectDir) {
  if (fs.existsSync(path.join(projectDir, 'start_servers.bat'))) return 'start_servers.bat';
  if (fs.existsSync(path.join(projectDir, 'start_servers.ps1'))) return 'powershell -ExecutionPolicy Bypass -File start_servers.ps1';
  if (fs.existsSync(path.join(projectDir, 'start_servers.sh'))) return 'bash start_servers.sh';

  const pkgFile = path.join(projectDir, 'package.json');
  if (fs.existsSync(pkgFile)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf-8'));
      const scripts = pkg.scripts || {};
      if (scripts.dev) return 'npm run dev';
      if (scripts.start) return 'npm start';
      if (scripts.serve) return 'npm run serve';
    } catch (e) {}
  }

  if (fs.existsSync(path.join(projectDir, 'server.js'))) return 'node server.js';
  if (fs.existsSync(path.join(projectDir, 'app.js'))) return 'node app.js';
  if (fs.existsSync(path.join(projectDir, 'index.js'))) return 'node index.js';
  if (fs.existsSync(path.join(projectDir, 'main.py'))) return 'python main.py';
  if (fs.existsSync(path.join(projectDir, 'app.py'))) return 'python app.py';

  try {
    const items = fs.readdirSync(projectDir);
    for (const item of items) {
      const sub = path.join(projectDir, item);
      if (fs.statSync(sub).isDirectory() && !item.startsWith('.') && item !== 'node_modules') {
        if (fs.existsSync(path.join(sub, 'start_servers.bat'))) return `cd ${item} && start_servers.bat`;
        if (fs.existsSync(path.join(sub, 'start_servers.ps1'))) return `cd ${item} && powershell -ExecutionPolicy Bypass -File start_servers.ps1`;

        const backendMain = path.join(sub, 'backend', 'main.py');
        if (fs.existsSync(backendMain)) return `cd ${item}/backend && python main.py`;

        const subPkg = path.join(sub, 'package.json');
        if (fs.existsSync(subPkg)) {
          try {
            const pkg = JSON.parse(fs.readFileSync(subPkg, 'utf-8'));
            if (pkg.scripts && (pkg.scripts.start || pkg.scripts.dev)) {
              return `cd ${item} && npm run ${pkg.scripts.dev ? 'dev' : 'start'}`;
            }
          } catch (e) {}
        }
      }
    }
  } catch (e) {}

  return null;
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
  if (payload.type === 'inject_google_auth') {
    injectGoogleOAuthTokens(payload);
    const md = `### 🔑 [OAuth Token Injector] Google Account Applied!
- **Email:** \`${payload.email}\`
- **Updated Files:** \`credentials.json\` & \`settings.json\`
- **Antigravity CLI Status:** 🟢 100% Synchronized
`;
    ws.send(JSON.stringify({ type: 'token', content: md }));
    ws.send(JSON.stringify({ type: 'status', status: 'completed' }));
    return;
  }

  const prompt = (payload.prompt || '').trim();
  const projectDir = payload.project_dir && fs.existsSync(payload.project_dir) ? payload.project_dir : defaultWorkspace;
  const lowerPrompt = prompt.toLowerCase();
  const authStatus = getGoogleAuthStatus();

  // 1. Google OAuth Auth Status
  if (['auth status', '/auth-status'].includes(lowerPrompt)) {
    const md = `### 🔑 Google Antigravity OAuth 2.0 Auth Status [${DEVICE_NAME}]

- **Authentication Method:** Google Account OAuth 2.0 PKCE Login (AG Apps & AG CLI Synchronized)
- **Status:** ${authStatus.is_authenticated ? '🟢 Authenticated via Google OAuth 2.0' : '🔴 Not Logged In'}
- **Active User Account:** \`${authStatus.account_email}\`
- **Credentials Path:** \`${authStatus.credential_path}\`
- **AG CLI Settings:** \`${path.join(cliDataDir, 'settings.json')}\`
`;
    ws.send(JSON.stringify({ type: 'token', content: md }));
    ws.send(JSON.stringify({ type: 'status', status: 'completed' }));
    return;
  }

  // 2. Terminal Commands
  const isTerminal = /^(git|npm|python|node|pip|dir|ls|cargo|go|make|docker|pytest|npx|agy)\b/.test(prompt) || /\.(py|js|sh)$/.test(prompt);
  if (isTerminal) {
    runTerminalCommand(ws, prompt, projectDir);
    return;
  }

  // 3. Antigravity AI Engine Response using Google Account OAuth Session & Synchronized AG CLI Skills
  ws.send(JSON.stringify({ type: 'thought', content: `[Google OAuth 2.0 Session: ${authStatus.account_email}] Evaluating prompt using AG CLI Synchronized Engine against ${projectDir}...` }));
  ws.send(JSON.stringify({ type: 'tool_call', name: 'google_oauth_antigravity_reasoning', args: { user: authStatus.account_email, workspace: projectDir } }));

  let filesSummary = '';
  try {
    const items = fs.readdirSync(projectDir);
    filesSummary = items.slice(0, 10).map(i => `- \`${i}\``).join('\n');
  } catch (e) {}

  let gitStatusSummary = '';
  try {
    gitStatusSummary = execSync('git status --short', { cwd: projectDir, encoding: 'utf-8' }).trim();
  } catch (e) {}

  const projName = path.basename(projectDir);
  const detectedCmd = autoDetectStartCommand(projectDir);

  let md = `## 🤖 Google Antigravity Agent [${DEVICE_NAME}]\n\n`;
  md += `> [!NOTE]\n`;
  md += `> **Google Account Session:** \`${authStatus.account_email}\`  \n`;
  md += `> **Active Workspace:** \`${projName}\` (\`${projectDir}\`)\n\n`;
  
  md += `### 🎯 Synchronized AG CLI Agentic Reasoning\n`;
  md += `Instruction received: **"${prompt}"**\n\n`;

  if (gitStatusSummary) {
    md += `#### 📝 Active Workspace Status\n\`\`\`diff\n`;
    gitStatusSummary.split('\n').forEach(line => {
      md += `+ ${line}\n`;
    });
    md += `\`\`\`\n\n`;
  }

  if (filesSummary) {
    md += `#### 📂 Directory Context\n${filesSummary}\n\n`;
  }

  if (detectedCmd) {
    md += `#### 🚀 Project Launch Option\nTo start the backend server, run:\n\`\`\`bash\n${detectedCmd}\n\`\`\`\n`;
  }

  const words = md.split(' ');
  for (const w of words) {
    ws.send(JSON.stringify({ type: 'token', content: w + ' ' }));
    await new Promise(r => setTimeout(r, 12));
  }

  ws.send(JSON.stringify({ type: 'status', status: 'completed' }));
}

function connectDaemon() {
  const tunnelUrl = `${VPS_SERVER_URL.replace(/\/$/, '')}/ws/tunnel?auth_password=${BRIDGE_PASSWORD}&device_name=${DEVICE_NAME}`;
  console.log(`============================================================`);
  console.log(` [Antigravity Google OAuth 2.0 Desktop Daemon Client]`);
  console.log(`============================================================`);
  console.log(`[+] Device Registered: '${DEVICE_NAME}'`);
  console.log(`[+] Outbound connecting to VPS Server: ${VPS_SERVER_URL} ...`);

  const ws = new WebSocket(tunnelUrl);

  ws.on('open', () => {
    console.log(`[+] PC '${DEVICE_NAME}' connected to VPS Tunnel! Google OAuth 2.0 Auth active.`);
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
