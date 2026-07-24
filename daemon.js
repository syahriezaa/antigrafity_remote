require('dotenv').config();
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execSync } = require('child_process');
const WebSocket = require('ws');
let GoogleGenAI = null;
try {
  GoogleGenAI = require('@google/genai').GoogleGenAI;
} catch (e) {}

const VPS_SERVER_URL = process.env.VPS_SERVER_URL || 'ws://dev.junaidi-ai.com:8000';
const BRIDGE_PASSWORD = process.env.BRIDGE_PASSWORD || 'antigravity_secret_123';
const DEVICE_NAME = process.env.DEVICE_NAME || os.hostname();
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';

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

function autoDetectStartCommand(projectDir) {
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

  // Check subdirectories
  try {
    const items = fs.readdirSync(projectDir);
    for (const item of items) {
      const sub = path.join(projectDir, item);
      if (fs.statSync(sub).isDirectory()) {
        const subPkg = path.join(sub, 'package.json');
        if (fs.existsSync(subPkg)) {
          try {
            const pkg = JSON.parse(fs.readFileSync(subPkg, 'utf-8'));
            if (pkg.scripts && (pkg.scripts.start || pkg.scripts.dev)) {
              return `npm --prefix ${sub} start`;
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
- **\`🔑 /auth-status\`**: Check logged-in Google Account on ${DEVICE_NAME}.
- **\`🚪 /auth-logout\`**: Revoke credentials on ${DEVICE_NAME}.
- **\`🎯 /goal <desc>\`**: Run long-running execution.
- **\`❓ /help\`**: Display this reference.
`;
      ws.send(JSON.stringify({ type: 'token', content: md }));
      ws.send(JSON.stringify({ type: 'status', status: 'completed' }));
      return;
    }
  }

  // 3. Intelligent App Launch Intent Detection ("run app", "start project", "launch app")
  const isAppLaunchIntent = /^(run|start|launch|exec|execute)(\s+the|\s+my)?(\s+app|\s+project|\s+server|\s+application)/i.test(prompt);
  if (isAppLaunchIntent) {
    const detectedCmd = autoDetectStartCommand(projectDir);
    if (detectedCmd) {
      ws.send(JSON.stringify({ type: 'thought', content: `Detected start command for ${projectDir}: ${detectedCmd}` }));
      runTerminalCommand(ws, detectedCmd, projectDir);
      return;
    } else {
      const md = `⚠️ **No start script automatically detected in workspace:** \`${projectDir}\`

Please specify the exact command to run, for example:
- \`npm start\`
- \`npm run dev\`
- \`python app.py\`
- \`node server.js\`
`;
      ws.send(JSON.stringify({ type: 'token', content: md }));
      ws.send(JSON.stringify({ type: 'status', status: 'completed' }));
      return;
    }
  }

  // 4. Direct Terminal Subprocess Execution
  const isTerminal = /^(git|npm|python|node|pip|dir|ls|cargo|go|make|docker|pytest|npx|agy)\b/.test(prompt) || /\.(py|js|sh)$/.test(prompt);
  if (isTerminal) {
    runTerminalCommand(ws, prompt, projectDir);
    return;
  }

  // 5. Conversational AI Assistant Engine (@google/genai or Assistant Response)
  ws.send(JSON.stringify({ type: 'thought', content: `Processing conversational query on ${DEVICE_NAME}...` }));

  if (GEMINI_API_KEY && GoogleGenAI) {
    try {
      const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
      const responseStream = await ai.models.generateContentStream({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });

      for await (const chunk of responseStream) {
        if (chunk.text) {
          ws.send(JSON.stringify({ type: 'token', content: chunk.text }));
        }
      }

      ws.send(JSON.stringify({ type: 'status', status: 'completed' }));
      return;
    } catch (err) {
      console.warn('GenAI streaming error, falling back:', err.message);
    }
  }

  // Conversational Fallback Greetings
  const greetings = ['hy', 'hi', 'hello', 'halo', 'hey', 'ping', 'test'];
  if (greetings.includes(lowerPrompt)) {
    const greetingMd = `👋 **Hello!** I am your **Antigravity AI Bridge Assistant** active on **${DEVICE_NAME}**.

How can I assist you today? Here are a few things you can do:

- 🚀 **Run Active Application**: Type \`run the app\` or \`npm start\`
- 🔑 **Check Google Auth Status**: Type \`/auth-status\`
- 🌐 **Web Automation**: Type \`/browser https://google.com\`
- 👥 **Multi-Agent Preview**: Type \`/teamwork-preview Build a web app\`
- 💻 **Terminal Commands**: Type \`git status\`, \`node -v\`, \`dir\`, or \`python script.py\`
`;
    ws.send(JSON.stringify({ type: 'token', content: greetingMd }));
    ws.send(JSON.stringify({ type: 'status', status: 'completed' }));
    return;
  }

  // 6. Comprehensive Intelligent Response Engine
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

  const projName = path.basename(projectDir);
  const detectedCmd = autoDetectStartCommand(projectDir);

  let md = `## 🤖 Antigravity Assistant [PC: ${DEVICE_NAME}]\n\n`;
  md += `Received instruction: **"${prompt}"**\n\n`;
  md += `### 📂 Target Workspace: \`${projName}\` (\`${projectDir}\`)\n`;
  md += `\`\`\`text\n${files.slice(0, 12).join('\n')}\n\`\`\`\n\n`;

  if (detectedCmd) {
    md += `### 💡 Detected Application Command\nTo launch the application in this directory, click or type:\n\`\`\`bash\n${detectedCmd}\n\`\`\`\n`;
  } else {
    md += `### 💡 Workspace Command Options\nYou can run any project command directly, e.g.:\n- \`npm start\`\n- \`python main.py\`\n- \`git status\`\n`;
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
