// Antigravity Remote Bridge - Client JS with Configured Google Client ID
document.addEventListener("DOMContentLoaded", () => {
  let ws = null;
  let currentAgentBubble = null;
  let currentAgentText = "";
  let thoughtCount = 0;
  let activeProcessTimer = null;
  let processStartTime = 0;
  let isSubagentsActive = false;
  let sessionToken = localStorage.getItem("bridge_token") || "";

  // Auth Elements
  const authModal = document.getElementById("authModal");
  const authForm = document.getElementById("authForm");
  const authPassword = document.getElementById("authPassword");
  const authError = document.getElementById("authError");

  // Google Login Modal Elements
  const googleLoginModal = document.getElementById("googleLoginModal");
  const closeGoogleModalBtn = document.getElementById("closeGoogleModalBtn");
  const generateCliAuthBtn = document.getElementById("generateCliAuthBtn");
  const googleCodeForm = document.getElementById("googleCodeForm");
  const googleAuthCode = document.getElementById("googleAuthCode");

  // Account Switch Header Elements
  const googleAccountBadge = document.getElementById("googleAccountBadge");
  const checkAuthBtn = document.getElementById("checkAuthBtn");
  const switchAccountBtn = document.getElementById("switchAccountBtn");
  const logoutAccountBtn = document.getElementById("logoutAccountBtn");

  // DOM Elements
  const connectionBadge = document.getElementById("connectionBadge");
  const sdkBadge = document.getElementById("sdkBadge");
  const chatMessages = document.getElementById("chatMessages");
  const chatForm = document.getElementById("chatForm");
  const promptInput = document.getElementById("promptInput");
  const sendBtn = document.getElementById("sendBtn");
  const clearChatBtn = document.getElementById("clearChatBtn");
  const thoughtFeed = document.getElementById("thoughtFeed");
  const thoughtCountBadge = document.getElementById("thoughtCountBadge");
  const logsFeed = document.getElementById("logsFeed");
  const refreshLogsBtn = document.getElementById("refreshLogsBtn");

  // Multi-PC & Project Selector Elements
  const deviceSelect = document.getElementById("deviceSelect");
  const projectSelect = document.getElementById("projectSelect");
  const customProjectPath = document.getElementById("customProjectPath");
  const directModeCheck = document.getElementById("directModeCheck");

  // Slash Menu Elements
  const slashMenu = document.getElementById("slashMenu");

  // Webhook Modal Elements
  const webhookModalBtn = document.getElementById("webhookModalBtn");
  const webhookModal = document.getElementById("webhookModal");
  const closeModalBtn = document.getElementById("closeModalBtn");
  const webhookForm = document.getElementById("webhookForm");
  const testNotifyBtn = document.getElementById("testNotifyBtn");

  // Walking & Spawning Office Elements
  const agentAlex = document.getElementById("agent-alex");
  const agentMaya = document.getElementById("agent-maya");
  const agentLeo = document.getElementById("agent-leo");
  const agentSam = document.getElementById("agent-sam");

  const cloudAlex = document.getElementById("cloud-alex");
  const cloudMaya = document.getElementById("cloud-maya");
  const cloudLeo = document.getElementById("cloud-leo");
  const cloudSam = document.getElementById("cloud-sam");

  const officeStatusBadge = document.getElementById("officeStatusBadge");

  // Map Coordinates
  const LOCATIONS = {
    entrance: { top: 310, left: 150 },
    deskAlex: { top: 30, left: 40 },
    deskMaya: { top: 30, left: 240 },
    deskLeo: { top: 260, left: 40 },
    deskSam: { top: 260, left: 240 },
    meetingTable: { top: 150, left: 140 },
    coffeeBar: { top: 310, left: 150 }
  };

  function moveAgent(agentEl, locationKey) {
    const loc = LOCATIONS[locationKey];
    if (agentEl && loc) {
      agentEl.style.top = `${loc.top}px`;
      agentEl.style.left = `${loc.left}px`;
    }
  }

  function setSpeech(cloudEl, text) {
    if (cloudEl) {
      cloudEl.textContent = text;
      cloudEl.style.display = "block";
    }
  }

  // Google OAuth Modal Handlers
  if (switchAccountBtn) {
    switchAccountBtn.addEventListener("click", () => {
      if (googleLoginModal) {
        googleLoginModal.classList.remove("hidden");
        googleLoginModal.style.display = "flex";
      }
    });
  }

  if (closeGoogleModalBtn) {
    closeGoogleModalBtn.addEventListener("click", () => {
      if (googleLoginModal) {
        googleLoginModal.classList.add("hidden");
        googleLoginModal.style.display = "none";
      }
    });
  }

  if (generateCliAuthBtn) {
    generateCliAuthBtn.addEventListener("click", () => {
      window.open("/api/auth/google", "_blank", "width=600,height=700");
      if (googleLoginModal) {
        googleLoginModal.classList.add("hidden");
        googleLoginModal.style.display = "none";
      }
    });
  }

  if (googleCodeForm) {
    googleCodeForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const code = googleAuthCode.value.trim();
      if (!code) return;

      if (code.includes("@")) {
        sendPromptDirect(`git config --global user.email "${code}"`);
        if (googleAccountBadge) googleAccountBadge.textContent = `🔑 Account: ${code}`;
      } else {
        sendPromptDirect(`agy auth login --code "${code}"`);
      }

      if (googleLoginModal) {
        googleLoginModal.classList.add("hidden");
        googleLoginModal.style.display = "none";
      }
      googleAuthCode.value = "";
    });
  }

  // Listen for OAuth Success Window Message
  window.addEventListener("message", (event) => {
    if (event.data && event.data.type === "google_auth_success") {
      const email = event.data.email;
      if (googleAccountBadge) googleAccountBadge.textContent = `🔑 Account: ${email}`;
      sendPromptDirect("/auth-status");
    }
  });

  // Account Switch Button Actions
  if (checkAuthBtn) {
    checkAuthBtn.addEventListener("click", () => {
      sendPromptDirect("/auth-status");
    });
  }

  if (logoutAccountBtn) {
    logoutAccountBtn.addEventListener("click", () => {
      if (confirm("Are you sure you want to log out the Google Account on target PC?")) {
        sendPromptDirect("/auth-logout");
        if (googleAccountBadge) googleAccountBadge.textContent = "🔑 Account: Logged Out";
      }
    });
  }

  function sendPromptDirect(promptText) {
    if (!promptText) return;
    promptInput.value = promptText;
    chatForm.dispatchEvent(new Event("submit"));
  }

  // Instant Auto-Auth for Localhost or Stored Token
  async function checkAuth() {
    if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
      try {
        const res = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: "antigravity_secret_123" })
        });
        const data = await res.json();
        if (data.token) {
          sessionToken = data.token;
          localStorage.setItem("bridge_token", sessionToken);
        }
      } catch (e) {}
    }

    if (authModal) {
      authModal.classList.add("hidden");
      authModal.style.display = "none";
    }

    initWebSocket();
    fetchStatus();
    fetchDaemons();
    fetchProjects();
  }

  authForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (authError) authError.style.display = "none";
    const password = authPassword.value.trim();

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        sessionToken = data.token;
        localStorage.setItem("bridge_token", sessionToken);
        if (authModal) {
          authModal.classList.add("hidden");
          authModal.style.display = "none";
        }
        initWebSocket();
        fetchStatus();
        fetchDaemons();
        fetchProjects();
      } else {
        if (authError) {
          authError.textContent = "Invalid Bridge Password. Access Denied!";
          authError.style.display = "block";
        }
      }
    } catch (err) {
      if (authError) {
        authError.textContent = "Connection error to VPS server.";
        authError.style.display = "block";
      }
    }
  });

  // Slash Auto-Suggest & Search Filter Logic
  promptInput.addEventListener("input", () => {
    const val = promptInput.value.trim();
    if (val.startsWith("/")) {
      if (slashMenu) slashMenu.classList.remove("hidden");
      const searchTerm = val.toLowerCase();

      let matchCount = 0;
      document.querySelectorAll(".slash-item").forEach(item => {
        const cmd = item.getAttribute("data-cmd").toLowerCase();
        const text = item.textContent.toLowerCase();

        if (cmd.includes(searchTerm) || text.includes(searchTerm)) {
          item.style.display = "block";
          matchCount++;
        } else {
          item.style.display = "none";
        }
      });

      if (matchCount === 0 && slashMenu) {
        slashMenu.classList.add("hidden");
      }
    } else {
      if (slashMenu) slashMenu.classList.add("hidden");
    }
  });

  document.querySelectorAll(".slash-item").forEach(item => {
    item.addEventListener("click", () => {
      const cmd = item.getAttribute("data-cmd");
      promptInput.value = cmd;
      if (slashMenu) slashMenu.classList.add("hidden");
      promptInput.focus();
    });
  });

  // Fetch Connected PC Daemons
  async function fetchDaemons() {
    try {
      const res = await fetch("/api/daemons");
      const data = await res.json();
      if (data.daemons && data.daemons.length > 0) {
        deviceSelect.innerHTML = "";
        data.daemons.forEach(d => {
          const opt = document.createElement("option");
          opt.value = d.device_name;
          opt.textContent = `🖥️ ${d.device_name} (Online)`;
          deviceSelect.appendChild(opt);
        });
      } else {
        deviceSelect.innerHTML = '<option value="">Default PC</option>';
      }
    } catch (err) {
      deviceSelect.innerHTML = '<option value="">Default PC</option>';
    }
  }

  // Fetch Projects List
  async function fetchProjects() {
    try {
      const res = await fetch("/api/projects");
      const data = await res.json();
      projectSelect.innerHTML = "";

      if (data.default) {
        const defaultOpt = document.createElement("option");
        defaultOpt.value = data.default;
        defaultOpt.textContent = `Default Workspace (${data.default})`;
        projectSelect.appendChild(defaultOpt);
      }

      if (data.projects && data.projects.length > 0) {
        data.projects.forEach(p => {
          const opt = document.createElement("option");
          opt.value = p.path;
          opt.textContent = `📁 ${p.name}`;
          projectSelect.appendChild(opt);
        });
      }
    } catch (err) {
      projectSelect.innerHTML = '<option value="">Default Workspace</option>';
    }
  }

  // Dynamic Spawning Engine
  function spawnSubagents(promptText) {
    isSubagentsActive = true;
    const targetPC = deviceSelect ? deviceSelect.value || "Desktop-PC" : "Desktop-PC";
    if (officeStatusBadge) {
      officeStatusBadge.style.background = "rgba(16, 185, 129, 0.15)";
      officeStatusBadge.style.color = "#059669";
      officeStatusBadge.textContent = `4 Subagents Active [${targetPC}]`;
    }

    [agentAlex, agentMaya, agentLeo, agentSam].forEach(agent => {
      if (agent) {
        agent.classList.remove("despawning");
        agent.classList.add("spawned");
      }
    });

    moveAgent(agentAlex, "deskAlex");
    moveAgent(agentMaya, "deskMaya");
    moveAgent(agentLeo, "deskLeo");
    moveAgent(agentSam, "deskSam");

    setSpeech(cloudAlex, `Alex: Routing to [${targetPC}] -> "${promptText.substring(0, 25)}..."`);
    setSpeech(cloudMaya, `Maya: Outbound tunnel active for ${targetPC}...`);
    setSpeech(cloudLeo, `Leo: Rendering UI response...`);
    setSpeech(cloudSam, `Sam: Auditing live stream...`);
  }

  function despawnSubagents(completedMsg = "Task Finished cleanly!") {
    setSpeech(cloudAlex, `Alex: ${completedMsg}`);
    setSpeech(cloudMaya, `Maya: Workspace synced.`);
    setSpeech(cloudLeo, `Leo: Stream complete.`);
    setSpeech(cloudSam, `Sam: Zero errors detected!`);

    setTimeout(() => {
      [agentAlex, agentMaya, agentLeo, agentSam].forEach(agent => {
        if (agent) {
          agent.classList.remove("spawned");
          agent.classList.add("despawning");
        }
      });

      isSubagentsActive = false;
      if (officeStatusBadge) {
        officeStatusBadge.style.background = "rgba(100, 116, 139, 0.15)";
        officeStatusBadge.style.color = "#64748B";
        officeStatusBadge.textContent = "Subagents Idle (Despawned)";
      }
    }, 3500);
  }

  // WebSocket Connection
  function initWebSocket() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${location.host}/ws/chat?token=${sessionToken}`;

    if (ws) {
      try { ws.close(); } catch(e) {}
    }

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      connectionBadge.className = "badge badge-online";
      connectionBadge.innerHTML = '<span class="dot"></span> ONLINE';
      fetchDaemons();
      setTimeout(() => sendPromptDirect("/auth-status"), 1000);
    };

    ws.onclose = () => {
      connectionBadge.className = "badge badge-offline";
      connectionBadge.innerHTML = '<span class="dot"></span> RECONNECTING...';
      setTimeout(initWebSocket, 3000);
    };

    ws.onerror = (err) => {
      console.error("WebSocket Error:", err);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleStreamEvent(msg);
      } catch (err) {
        console.error("Failed to parse msg:", event.data);
      }
    };
  }

  function handleStreamEvent(event) {
    if (event.type === "token") {
      if (!currentAgentBubble) {
        currentAgentBubble = createAgentBubble();
      }
      currentAgentText += event.content;
      currentAgentBubble.querySelector(".msg-body").innerHTML = marked.parse(currentAgentText);

      // Extract account email if present in token stream
      if (event.content.includes("Account:** `")) {
        const match = event.content.match(/Account:\*\* `([^`]+)`/);
        if (match && googleAccountBadge) {
          googleAccountBadge.textContent = `🔑 Account: ${match[1]}`;
        }
      }

      if (isSubagentsActive && Math.random() < 0.15) {
        setSpeech(cloudLeo, `Leo: Token stream "${event.content.trim().substring(0, 15)}..."`);
      }

      chatMessages.scrollTop = chatMessages.scrollHeight;
    } 
    else if (event.type === "thought") {
      addThoughtEvent(event.content, "thought");
      setSpeech(cloudAlex, `Alex: Reasoning: ${event.content.substring(0, 30)}...`);
    } 
    else if (event.type === "tool_call") {
      addThoughtEvent(`Tool: ${event.name}\nArgs: ${JSON.stringify(event.args, null, 2)}`, "tool");
      setSpeech(cloudMaya, `Maya: Calling tool "${event.name}" on ${deviceSelect ? deviceSelect.value : 'Target PC'}!`);
      setSpeech(cloudSam, `Sam: Auditing tool args...`);
    }
    else if (event.type === "process_start") {
      handleProcessStart(event);
      setSpeech(cloudMaya, `Maya: Desktop PID [${event.pid}]: ${event.command.substring(0, 25)}...`);
    }
    else if (event.type === "process_end") {
      handleProcessEnd(event);
      setSpeech(cloudSam, `Sam: Process finished in ${event.duration}s with exit code ${event.exit_code}`);
    }
    else if (event.type === "status" && event.status === "completed") {
      currentAgentBubble = null;
      currentAgentText = "";
      despawnSubagents("Response Complete!");
    }
    else if (event.type === "error") {
      if (!currentAgentBubble) currentAgentBubble = createAgentBubble();
      currentAgentBubble.querySelector(".msg-body").innerHTML += `<div style="color: #EF4444; margin-top:6px;">⚠️ ${escapeHtml(event.content)}</div>`;
      despawnSubagents("Error Encountered.");
    }
  }

  // Non-blocking Form Submission
  chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const prompt = promptInput.value.trim();
    if (!prompt) return;

    const projectDir = customProjectPath ? customProjectPath.value.trim() || projectSelect.value : "";
    const targetDevice = deviceSelect ? deviceSelect.value : "";
    const directMode = directModeCheck ? directModeCheck.checked : true;

    createUserBubble(prompt);
    spawnSubagents(prompt);
    if (slashMenu) slashMenu.classList.add("hidden");

    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({
          prompt,
          project_dir: projectDir,
          target_device: targetDevice,
          direct_mode: directMode
        }));
      } catch (ex) {
        console.error("Send error:", ex);
      }
    } else {
      console.warn("WebSocket not open yet, retrying connection...");
      initWebSocket();
    }
    
    promptInput.value = "";
    currentAgentBubble = null;
    currentAgentText = "";
  });

  promptInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      chatForm.dispatchEvent(new Event("submit"));
    }
  });

  // Quick Prompt Chips
  document.querySelectorAll(".chip-btn").forEach(chip => {
    chip.addEventListener("click", () => {
      promptInput.value = chip.getAttribute("data-prompt");
      promptInput.focus();
    });
  });

  clearChatBtn.addEventListener("click", () => {
    chatMessages.innerHTML = "";
    thoughtFeed.innerHTML = '<div class="empty-state">Stream cleared. Ready for next request.</div>';
    thoughtCount = 0;
    if (thoughtCountBadge) thoughtCountBadge.textContent = "0 Events";
  });

  // Tabs Switcher
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));
      
      btn.classList.add("active");
      const tabId = btn.getAttribute("data-tab");
      document.getElementById(tabId).classList.add("active");

      if (tabId === "tab-logs") {
        fetchLogs();
      }
    });
  });

  // Fetch Transcripts & Load Previous Sessions
  async function fetchLogs() {
    logsFeed.innerHTML = '<div class="empty-state">Scanning local brain transcript logs...</div>';
    try {
      const res = await fetch("/api/transcripts");
      const data = await res.json();
      
      if (!data || data.length === 0) {
        logsFeed.innerHTML = '<div class="empty-state">No transcript logs found in `~/.gemini/antigravity/brain`.</div>';
        return;
      }

      logsFeed.innerHTML = "";
      data.forEach(item => {
        const mtimeStr = item.mtime ? new Date(item.mtime * 1000).toLocaleString() : "Recent Session";
        const card = document.createElement("div");
        card.className = "event-card";
        card.style.borderLeftColor = "#3B82F6";
        card.innerHTML = `
          <div class="title" style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
            <span style="font-weight:700; color:var(--text-primary);">📜 ID: ${item.conversation_id.substring(0, 8)}...</span>
            <button class="btn btn-secondary load-session-btn" data-id="${item.conversation_id}" style="padding: 4px 10px; font-size: 0.72rem; border-radius: 4px;">▶ Load Session</button>
          </div>
          <div class="body" style="margin-top:6px; color:var(--text-muted);">
            <div>📅 Modified: ${mtimeStr}</div>
            <div>📊 Steps Logged: ${item.total_steps}</div>
          </div>
        `;
        logsFeed.appendChild(card);
      });

      document.querySelectorAll(".load-session-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const convId = btn.getAttribute("data-id");
          loadPreviousSession(convId);
        });
      });

    } catch (err) {
      logsFeed.innerHTML = `<div class="empty-state" style="color:#EF4444;">Failed to load logs: ${err.message}</div>`;
    }
  }

  async function loadPreviousSession(conversationId) {
    try {
      const res = await fetch(`/api/session/${conversationId}`);
      const session = await res.json();
      if (session.error) {
        alert("Failed to load session: " + session.error);
        return;
      }

      chatMessages.innerHTML = `
        <div class="system-welcome">
          <div class="welcome-card" style="border-color: var(--accent-indigo);">
            <h3 style="color: var(--accent-indigo);">📜 Loaded Previous Session</h3>
            <p style="margin-bottom:0;">Session ID: <code>${conversationId}</code> | Restored steps: ${session.messages ? session.messages.length : 0}</p>
          </div>
        </div>
      `;
      thoughtFeed.innerHTML = "";
      thoughtCount = 0;

      if (session.messages && session.messages.length > 0) {
        session.messages.forEach(msg => {
          if (msg.role === "user") {
            createUserBubble(msg.text);
          } else {
            createAgentBubble(msg.text);
          }
        });
      }

      if (session.tool_calls && session.tool_calls.length > 0) {
        session.tool_calls.forEach(tc => {
          addThoughtEvent(`Tool: ${tc.name}\nArgs: ${JSON.stringify(tc.args, null, 2)}`, "tool");
        });
      }

      document.querySelector('.tab-btn[data-tab="tab-thoughts"]').click();

    } catch (err) {
      alert("Error loading session: " + err.message);
    }
  }

  refreshLogsBtn.addEventListener("click", fetchLogs);

  // Webhook Modal Logic
  webhookModalBtn.addEventListener("click", () => {
    loadWebhookConfig();
    webhookModal.classList.remove("hidden");
  });

  closeModalBtn.addEventListener("click", () => {
    webhookModal.classList.add("hidden");
  });

  async function loadWebhookConfig() {
    try {
      const res = await fetch("/api/webhook/config");
      const config = await res.json();
      document.getElementById("tgToken").value = config.telegram_bot_token || "";
      document.getElementById("tgChatId").value = config.telegram_chat_id || "";
      document.getElementById("waUrl").value = config.whatsapp_webhook_url || "";
      document.getElementById("poUser").value = config.pushover_user_key || "";
      document.getElementById("poToken").value = config.pushover_api_token || "";
      document.getElementById("autoNotifyCheck").checked = config.enable_auto_notify ?? true;
    } catch (err) {
      console.warn("Failed to load webhook config", err);
    }
  }

  webhookForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      telegram_bot_token: document.getElementById("tgToken").value.trim(),
      telegram_chat_id: document.getElementById("tgChatId").value.trim(),
      whatsapp_webhook_url: document.getElementById("waUrl").value.trim(),
      pushover_user_key: document.getElementById("poUser").value.trim(),
      pushover_api_token: document.getElementById("poToken").value.trim(),
      enable_auto_notify: document.getElementById("autoNotifyCheck").checked
    };

    try {
      await fetch("/api/webhook/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      alert("Notification settings saved successfully!");
      webhookModal.classList.add("hidden");
    } catch (err) {
      alert("Failed to save settings: " + err.message);
    }
  });

  testNotifyBtn.addEventListener("click", async () => {
    try {
      const res = await fetch("/api/webhook/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Antigravity Bridge Test",
          message: "Hello from Antigravity Remote Bridge! Your notification pipeline is working.",
          target: "all"
        })
      });
      const data = await res.json();
      alert("Test alert dispatched! Result: " + JSON.stringify(data.results));
    } catch (err) {
      alert("Test alert failed: " + err.message);
    }
  });

  // Fetch System Status
  async function fetchStatus() {
    try {
      const res = await fetch("/api/status");
      const data = await res.json();
      if (data.desktop_daemon_connected) {
        sdkBadge.className = "badge badge-online";
        sdkBadge.innerHTML = `<span class="dot"></span> ${data.active_daemons.length} PC(s) ONLINE`;
      } else {
        sdkBadge.className = "badge badge-info";
        sdkBadge.innerHTML = '<span class="label">NO PC ONLINE</span>';
      }
    } catch (err) {
      console.warn("Status fetch failed", err);
    }
  }

  function escapeHtml(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Init
  checkAuth();
});
