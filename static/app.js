// ---- State ----
let sessionId = localStorage.getItem("sessionId") || crypto.randomUUID().replace(/-/g, "").slice(0, 16);
localStorage.setItem("sessionId", sessionId);
let activePaperId = null;
let selectedFile = null;
const API = "";

// ---- DOM refs ----
const fileInput = document.getElementById("fileInput");
const dropZone = document.getElementById("dropZone");
const uploadBtn = document.getElementById("uploadBtn");
const paperTitle = document.getElementById("paperTitle");

// ---- File selection ----
fileInput.addEventListener("change", (e) => {
  selectedFile = e.target.files[0];
  if (selectedFile) {
    paperTitle.value = paperTitle.value || selectedFile.name.replace(/\.\w+$/, "");
    uploadBtn.disabled = false;
  }
});

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragging");
});

dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragging"));

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragging");
  if (e.dataTransfer.files.length) {
    selectedFile = e.dataTransfer.files[0];
    paperTitle.value = paperTitle.value || selectedFile.name.replace(/\.\w+$/, "");
    uploadBtn.disabled = false;
  }
});

// ---- PDF text extraction ----
async function extractPdfText(file) {
  const arrayBuffer = await file.arrayBuffer();
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item) => item.str).join(" ");
    pages.push(pageText);
  }
  return pages.join("\n\n");
}

// ---- Upload ----
uploadBtn.addEventListener("click", async () => {
  if (!selectedFile) return;
  uploadBtn.disabled = true;
  uploadBtn.textContent = "Processing...";

  try {
    let textContent;
    const isPdf = selectedFile.name.toLowerCase().endsWith(".pdf");

    if (isPdf) {
      uploadBtn.textContent = "Extracting PDF text...";
      textContent = await extractPdfText(selectedFile);
    } else {
      textContent = await selectedFile.text();
    }

    if (!textContent || textContent.trim().length < 50) {
      throw new Error("Could not extract enough text from the file.");
    }

    uploadBtn.textContent = "Uploading...";
    const formData = new FormData();
    formData.append("text", textContent);
    formData.append("title", paperTitle.value || "Untitled");

    const res = await fetch(`${API}/api/papers`, { method: "POST", body: formData });
    const data = await res.json();

    if (data.success) {
      showToast("Paper uploaded! Indexing in progress...", "success");
      selectedFile = null;
      fileInput.value = "";
      paperTitle.value = "";
      uploadBtn.textContent = "Upload & Index";

      pollPaperStatus(data.paperId);
      setTimeout(loadPapers, 1000);
    } else {
      throw new Error(data.error);
    }
  } catch (err) {
    showToast(err.message || "Upload failed", "error");
    uploadBtn.disabled = false;
    uploadBtn.textContent = "Upload & Index";
  }
});

// ---- Paper status polling ----
function pollPaperStatus(paperId) {
  const interval = setInterval(async () => {
    try {
      const res = await fetch(`${API}/api/papers/${paperId}/status`);
      const paper = await res.json();
      if (paper.status === "ready") {
        clearInterval(interval);
        showToast(`"${paper.title}" is ready!`, "success");
        loadPapers();
      } else if (paper.status === "failed") {
        clearInterval(interval);
        showToast("Indexing failed", "error");
        loadPapers();
      }
    } catch (e) {
      /* keep polling */
    }
  }, 3000);
}

// ---- Load papers ----
async function loadPapers() {
  try {
    const res = await fetch(`${API}/api/papers`);
    const data = await res.json();
    const list = document.getElementById("papersList");

    if (!data.papers || data.papers.length === 0) {
      list.innerHTML = '<div class="empty-state">No papers uploaded yet</div>';
      return;
    }

    list.innerHTML = data.papers
      .map(
        (p) => `
      <div class="paper-card ${activePaperId === p.id ? "active" : ""}" onclick="selectPaper('${p.id}', '${p.title.replace(/'/g, "\\'")}')">
        <div class="paper-card-top">
          <div class="paper-title">${escapeHtml(p.title)}</div>
          <button class="delete-paper-btn" onclick="deletePaper('${p.id}', event)" title="Remove paper">&times;</button>
        </div>
        <div class="paper-meta">
          <span class="status-dot ${p.status}"></span>
          ${p.status} ${p.chunkCount ? "/ " + p.chunkCount + " chunks" : ""}
        </div>
      </div>
    `
      )
      .join("");

    // Auto-select if only one ready paper
    const readyPapers = data.papers.filter((p) => p.status === "ready");
    if (readyPapers.length === 1 && !activePaperId) {
      selectPaper(readyPapers[0].id, readyPapers[0].title);
    }
  } catch (err) {
    console.error("Failed to load papers:", err);
  }
}

async function deletePaper(id, event) {
  event.stopPropagation();
  try {
    const res = await fetch(`${API}/api/papers/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (data.success) {
      if (activePaperId === id) {
        activePaperId = null;
        document.getElementById("chatTitle").textContent = "All papers";
      }
      showToast("Paper removed", "success");
      loadPapers();
    } else {
      showToast(data.error || "Failed to remove paper", "error");
    }
  } catch (err) {
    showToast("Failed to remove paper", "error");
  }
}

function selectPaper(id, title) {
  activePaperId = activePaperId === id ? null : id;
  document.getElementById("chatTitle").textContent = activePaperId ? title : "All papers";
  loadPapers();
}

// ---- Chat ----
function handleKey(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

async function sendMessage() {
  const input = document.getElementById("chatInput");
  const message = input.value.trim();
  if (!message) return;

  const welcome = document.querySelector(".welcome-message");
  if (welcome) welcome.remove();

  appendMessage("user", message);
  input.value = "";
  autoResize(input);

  const loadingId = appendLoading();
  const sendBtn = document.getElementById("sendBtn");
  sendBtn.disabled = true;

  try {
    const res = await fetch(`${API}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, sessionId, paperId: activePaperId }),
    });

    const data = await res.json();
    removeLoading(loadingId);

    if (data.error) {
      appendMessage("assistant", "Sorry, something went wrong: " + data.error);
    } else {
      appendMessage("assistant", data.message.content, data.message.sources);
    }
  } catch (err) {
    removeLoading(loadingId);
    appendMessage("assistant", "Failed to get a response. Please try again.");
  }

  sendBtn.disabled = false;
  input.focus();
}

// ---- Message rendering ----
function appendMessage(role, content, sources) {
  const container = document.getElementById("messages");
  const div = document.createElement("div");
  div.className = `message ${role}`;

  const avatar = role === "user" ? "Y" : "AI";
  let sourcesHtml = "";
  if (sources && sources.length > 0) {
    sourcesHtml = `<div class="message-sources">Sources: ${sources.join(", ")}</div>`;
  }

  div.innerHTML = `
    <div class="avatar">${avatar}</div>
    <div class="message-content">${formatContent(content)}${sourcesHtml}</div>
  `;

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function appendLoading() {
  const container = document.getElementById("messages");
  const div = document.createElement("div");
  const id = "loading-" + Date.now();
  div.id = id;
  div.className = "message assistant";
  div.innerHTML = `
    <div class="avatar">AI</div>
    <div class="message-content"><div class="loading-dots"><span>.</span><span>.</span><span>.</span></div></div>
  `;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return id;
}

function removeLoading(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

async function clearChat() {
  try {
    await fetch(`${API}/api/chat/${sessionId}`, { method: "DELETE" });
    sessionId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    localStorage.setItem("sessionId", sessionId);
    document.getElementById("messages").innerHTML = `
      <div class="welcome-message">
        <div class="welcome-icon">&#x1F4DA;</div>
        <h2>Ask anything about your papers</h2>
        <p>Upload a research paper from the sidebar, then ask questions.</p>
      </div>
    `;
  } catch (err) {
    showToast("Failed to clear chat", "error");
  }
}

// ---- Utilities ----
function formatContent(text) {
  return escapeHtml(text)
    .replace(/\n/g, "<br/>")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(
      /`(.*?)`/g,
      "<code style='background:var(--bg);padding:2px 6px;border-radius:3px;font-family:IBM Plex Mono,monospace;font-size:13px'>$1</code>"
    );
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function autoResize(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = Math.min(textarea.scrollHeight, 120) + "px";
}

document.getElementById("chatInput").addEventListener("input", function () {
  autoResize(this);
});

function showToast(msg, type) {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// ---- Init ----
loadPapers();
