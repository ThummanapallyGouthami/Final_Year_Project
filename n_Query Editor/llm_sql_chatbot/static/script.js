// static/script.js

let chartInstance = null;
let lastColumns = [];
let lastRows = [];

const el = (id) => document.getElementById(id);

function showToast(msg) {
  el("toastBody").textContent = msg;
  const toast = bootstrap.Toast.getOrCreateInstance(el("appToast"));
  toast.show();
}

function setConnected(isConnected) {
  const badge = el("connBadge");
  if (isConnected) {
    badge.textContent = "Connected";
    badge.classList.remove("badge-disconnected");
    badge.classList.add("badge-connected");
  } else {
    badge.textContent = "Disconnected";
    badge.classList.add("badge-disconnected");
    badge.classList.remove("badge-connected");
  }
}

function addMessage(role, text) {
  const chat = el("chatBox");
  const wrapper = document.createElement("div");
  wrapper.className = `msg ${role}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = escapeHtml(text).replace(/\n/g, "<br/>");
  wrapper.appendChild(bubble);
  chat.appendChild(wrapper);
  chat.scrollTop = chat.scrollHeight;
}

function addTyping() {
  const chat = el("chatBox");
  const wrapper = document.createElement("div");
  wrapper.className = "msg bot";
  wrapper.id = "typingRow";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = `<span class="spinner"><span class="spinner-border spinner-border-sm"></span> Thinking...</span>`;
  wrapper.appendChild(bubble);
  chat.appendChild(wrapper);
  chat.scrollTop = chat.scrollHeight;
}

function removeTyping() {
  const t = document.getElementById("typingRow");
  if (t) t.remove();
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function postJSON(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || "Request failed");
  }
  return data;
}

function setSQL(sql) {
  el("sqlBox").textContent = sql || "";
}

function toggleSQL() {
  el("sqlBox").classList.toggle("d-none");
}

function clearResults() {
  el("resultMeta").textContent = "No data yet.";
  el("tableWrap").classList.add("d-none");
  el("chartWrap").classList.add("d-none");
  el("sqlBox").classList.add("d-none");
  el("emptyState").classList.remove("d-none");
  el("btnDownloadCSV").disabled = true;

  lastColumns = [];
  lastRows = [];
  destroyChart();
}

function renderTable(columns, rows) {
  const thead = el("resultTable").querySelector("thead");
  const tbody = el("resultTable").querySelector("tbody");

  thead.innerHTML = "";
  tbody.innerHTML = "";

  const trH = document.createElement("tr");
  columns.forEach((c) => {
    const th = document.createElement("th");
    th.textContent = c;
    trH.appendChild(th);
  });
  thead.appendChild(trH);

  rows.forEach((r) => {
    const tr = document.createElement("tr");
    r.forEach((cell) => {
      const td = document.createElement("td");
      td.textContent = cell === null ? "" : String(cell);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  el("tableWrap").classList.remove("d-none");
  el("emptyState").classList.add("d-none");
}

function fillChartDropdowns(columns) {
  const xSel = el("xCol");
  const ySel = el("yCol");

  xSel.innerHTML = "";
  ySel.innerHTML = "";

  columns.forEach((c, idx) => {
    const opt1 = document.createElement("option");
    opt1.value = c;
    opt1.textContent = c;
    xSel.appendChild(opt1);

    const opt2 = document.createElement("option");
    opt2.value = c;
    opt2.textContent = c;
    ySel.appendChild(opt2);
  });

  // default x: first col, y: second col if exists
  xSel.value = columns[0] || "";
  ySel.value = columns[1] || columns[0] || "";
}

function guessNumericColumns(columns, rows) {
  const numeric = [];
  for (let i = 0; i < columns.length; i++) {
    let ok = true;
    for (let r = 0; r < Math.min(rows.length, 20); r++) {
      const v = rows[r][i];
      if (v === null || v === "") continue;
      if (typeof v === "number") continue;
      if (!isFinite(Number(v))) { ok = false; break; }
    }
    if (ok) numeric.push(columns[i]);
  }
  return numeric;
}

function buildChartData(columns, rows, xCol, yCol) {
  const xIdx = columns.indexOf(xCol);
  const yIdx = columns.indexOf(yCol);

  const labels = [];
  const values = [];

  for (let i = 0; i < rows.length; i++) {
    const x = rows[i][xIdx];
    const y = rows[i][yIdx];
    labels.push(x === null ? "" : String(x));
    values.push(y === null || y === "" ? 0 : Number(y));
  }

  return { labels, values };
}

function destroyChart() {
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
}

function renderChart(type, columns, rows, xCol, yCol) {
  destroyChart();

  const ctx = el("chartCanvas");
  const { labels, values } = buildChartData(columns, rows, xCol, yCol);

  // For pie, reduce to top 12 to avoid mess
  let finalLabels = labels;
  let finalValues = values;
  if (type === "pie" && labels.length > 12) {
    finalLabels = labels.slice(0, 12);
    finalValues = values.slice(0, 12);
  }

  chartInstance = new Chart(ctx, {
    type,
    data: {
      labels: finalLabels,
      datasets: [{
        label: `${yCol} by ${xCol}`,
        data: finalValues
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: type === "pie" },
        tooltip: { enabled: true }
      },
      scales: (type === "pie") ? {} : {
        x: { ticks: { color: "rgba(255,255,255,.75)" }, grid: { color: "rgba(255,255,255,.08)" } },
        y: { ticks: { color: "rgba(255,255,255,.75)" }, grid: { color: "rgba(255,255,255,.08)" } }
      }
    }
  });

  el("chartWrap").classList.remove("d-none");
}

function enableCSVDownload(columns, rows) {
  el("btnDownloadCSV").disabled = !(columns?.length && rows?.length);
}

function downloadCSV(columns, rows) {
  const safe = (v) => {
    const s = v === null ? "" : String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replaceAll('"', '""')}"`;
    }
    return s;
  };

  const lines = [];
  lines.push(columns.map(safe).join(","));
  rows.forEach((r) => lines.push(r.map(safe).join(",")));

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "result.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

// --------------------
// Actions
// --------------------
async function connectNow() {
  el("connectError").classList.add("d-none");
  el("connectError").textContent = "";

  const payload = {
    host: el("dbHost").value.trim(),
    user: el("dbUser").value.trim(),
    password: el("dbPass").value,
    database: el("dbName").value.trim()
  };

  try {
    const data = await postJSON("/api/connect", payload);
    setConnected(true);
    showToast(data.message || "Connected");
    bootstrap.Modal.getInstance(document.getElementById("connectModal")).hide();
  } catch (e) {
    el("connectError").textContent = e.message || "Connection failed";
    el("connectError").classList.remove("d-none");
    setConnected(false);
  }
}

async function disconnectNow() {
  try {
    await postJSON("/api/disconnect", {});
    setConnected(false);
    showToast("Disconnected");
  } catch (e) {
    showToast(e.message || "Disconnect failed");
  }
}

async function sendMessage() {
  const input = el("userInput");
  const msg = input.value.trim();
  if (!msg) return;

  addMessage("user", msg);
  input.value = "";
  addTyping();

  try {
    const data = await postJSON("/api/chat", { message: msg });
    removeTyping();

    // Show assistant message
    if (data.ok) {
      addMessage("bot", data.assistant || "Done.");
    } else {
      addMessage("bot", data.error || "Something went wrong.");
    }

    // SQL
    setSQL(data.sql || "");
    // Keep SQL hidden by default; user can toggle

    // Results
    const columns = data.columns || [];
    const rows = data.rows || [];

    lastColumns = columns;
    lastRows = rows;

    if (!columns.length || !rows.length) {
      el("resultMeta").textContent = data.error
        ? `Error: ${data.error}`
        : (data.assistant || "No rows returned.");
      el("tableWrap").classList.add("d-none");
      el("chartWrap").classList.add("d-none");
      el("emptyState").classList.remove("d-none");
      destroyChart();
      enableCSVDownload(columns, rows);
      return;
    }

    el("resultMeta").textContent = `Rows: ${rows.length} | Columns: ${columns.length}`;
    renderTable(columns, rows);
    enableCSVDownload(columns, rows);

    // Chart suggestion
    fillChartDropdowns(columns);

    // smart default y to numeric if possible
    const numericCols = guessNumericColumns(columns, rows);
    if (numericCols.length) {
      el("yCol").value = numericCols[0];
    }

    // If user asked chart, auto show chart area and render
    if (data.chart) {
      const type = data.chart.type || "bar";
      el("chartType").value = type;
      // x/y suggested by backend (if exists)
      if (data.chart.x && columns.includes(data.chart.x)) el("xCol").value = data.chart.x;
      if (data.chart.y && columns.includes(data.chart.y)) el("yCol").value = data.chart.y;

      el("chartWrap").classList.remove("d-none");
      renderChart(el("chartType").value, columns, rows, el("xCol").value, el("yCol").value);
    } else {
      // only show chart area if user manually wants
      el("chartWrap").classList.add("d-none");
      destroyChart();
    }

  } catch (e) {
    removeTyping();
    addMessage("bot", `❌ ${e.message || "Request failed"}`);
  }
}

// --------------------
// Event bindings
// --------------------
document.addEventListener("DOMContentLoaded", () => {
  setConnected(false);
  clearResults();

  el("btnConnectNow").addEventListener("click", connectNow);
  el("btnDisconnect").addEventListener("click", disconnectNow);

  el("btnSend").addEventListener("click", sendMessage);
  el("userInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendMessage();
  });

  el("btnClear").addEventListener("click", () => {
    // Clear chat but keep first bot greeting
    const chat = el("chatBox");
    chat.innerHTML = `
      <div class="msg bot">
        <div class="bubble">
          Hi 👋 Connect to MySQL, then ask questions like:
          <div class="mt-2 small text-muted">
            • “Show top 10 rows from employees”<br/>
            • “Count orders per day”<br/>
            • “Show graph of sales by month”
          </div>
        </div>
      </div>
    `;
    clearResults();
  });

  el("btnToggleSQL").addEventListener("click", toggleSQL);

  el("btnDownloadCSV").addEventListener("click", () => {
    if (!lastColumns.length || !lastRows.length) return;
    downloadCSV(lastColumns, lastRows);
  });

  el("btnRenderChart").addEventListener("click", () => {
    if (!lastColumns.length || !lastRows.length) {
      showToast("No data to chart.");
      return;
    }
    const type = el("chartType").value;
    const xCol = el("xCol").value;
    const yCol = el("yCol").value;

    el("chartWrap").classList.remove("d-none");
    renderChart(type, lastColumns, lastRows, xCol, yCol);
  });
});
