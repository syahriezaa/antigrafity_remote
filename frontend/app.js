// Antigravity Remote Bridge - Client JS with Instant Localhost Auto-Auth & Non-blocking Submit
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

  const triggerMeetingBtn = document.getElementById("triggerMeetingBtn");
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

  function createUserBubble(text) {
    const msgDiv = document.createElement("div");
    msgDiv.className = "chat-msg user";
    msgDiv.innerHTML = `
      <div class="msg-header">You</div>
      <div class="msg-body">${marked.parse(text)}</div>
    `;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function createAgentBubble(initialText = "") {
    const msgDiv = document.createElement("div");
    msgDiv.className = "chat-msg agent";
    msgDiv.innerHTML = `
      <div class="msg-header">Antigravity</div>
      <div class="msg-body">${initialText ? marked.parse(initialText) : '<span class="typing-indicator">...</span>'}</div>
    `;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return msgDiv;
  }

  function addThoughtEvent(content, type) {
    thoughtCount++;
    if (thoughtCountBadge) thoughtCountBadge.textContent = `${thoughtCount} Events`;

    const card = document.createElement("div");
    card.className = `event-card ${type}`;
    const icon = type === "thought" ? "🧠 Reasoning Step" : "🛠️ Tool Call";
    card.innerHTML = `
      <div class="title">${icon}</div>
      <div class="body">${escapeHtml(content)}</div>
    `;

    const emptyState = thoughtFeed.querySelector(".empty-state");
    if (emptyState) emptyState.remove();

    thoughtFeed.appendChild(card);
    thoughtFeed.scrollTop = thoughtFeed.scrollHeight;
  }

  function handleProcessStart(event) {
    processStartTime = Date.now();
    const banner = document.createElement("div");
    banner.id = "activeProcessBanner";
    banner.className = "process-active-banner";
    banner.innerHTML = `
      <div>
        <div style="font-size:0.7rem; color:var(--text-muted); text-transform:uppercase;">⚡ Active Subprocess [PID: ${event.pid}]</div>
        <div class="cmd-text">${escapeHtml(event.command)}</div>
      </div>
      <div class="timer-badge">
        <span class="pulse-indicator"></span>
        <span id="processTimerText">00:00</span>
      </div>
    `;

    const emptyState = thoughtFeed.querySelector(".empty-state");
    if (emptyState) emptyState.remove();

    thoughtFeed.prepend(banner);

    if (activeProcessTimer) clearInterval(activeProcessTimer);
    activeProcessTimer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - processStartTime) / 1000);
      const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const secs = String(elapsed % 60).padStart(2, '0');
      const timerEl = document.getElementById("processTimerText");
      if (timerEl) timerEl.textContent = `${mins}:${secs}`;
    }, 1000);
  }

  function handleProcessEnd(event) {
    if (activeProcessTimer) clearInterval(activeProcessTimer);
    const banner = document.getElementById("activeProcessBanner");
    if (banner) {
      banner.style.borderColor = event.exit_code === 0 ? "rgba(16, 185, 129, 0.4)" : "rgba(239, 68, 68, 0.4)";
      banner.style.background = event.exit_code === 0 ? "rgba(16, 185, 129, 0.08)" : "rgba(239, 68, 68, 0.08)";
      banner.innerHTML = `
        <div>
          <div style="font-size:0.7rem; color:var(--text-muted);">Process Finished (${event.duration}s)</div>
          <div class="cmd-text" style="color:${event.exit_code === 0 ? '#34D399' : '#F87171'}">Exit Code: ${event.exit_code}</div>
        </div>
        <div class="timer-badge" style="background:rgba(255,255,255,0.08)">${event.duration}s</div>
      `;
    }
  }

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
