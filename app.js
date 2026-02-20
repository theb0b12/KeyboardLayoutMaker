let keys = [];
let currentLayer = "base";
let layers = ["base"];

let zoom = 1;
let panX = 0;
let panY = 0;
let isDragging = false;
let dragMoved = false;
let lastX = 0;
let lastY = 0;

const fileInput    = document.getElementById("fileInput");
const keyText      = document.getElementById("keyText");
const keyColor     = document.getElementById("keyColor");
const keyTextColor = document.getElementById("keyTextColor");
const fontSize     = document.getElementById("fontSize");
const layerSelect  = document.getElementById("layerSelect");

// ── DXF import ────────────────────────────────────────────────
fileInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.name.endsWith(".dxf")) {
    keys = await parseDXFFile(file);
    renderKeyboard(keys, currentLayer);
  }
});

// ── Layer management ──────────────────────────────────────────

function rebuildLayerSelect() {
  layerSelect.innerHTML = "";
  layers.forEach(name => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name.charAt(0).toUpperCase() + name.slice(1);
    layerSelect.appendChild(opt);
  });
  layerSelect.value = currentLayer;
}

layerSelect.addEventListener("change", () => {
  currentLayer = layerSelect.value;
  clearSelection();
  // Re-render so the active layer label/highlight updates
  renderKeyboard(keys, currentLayer);
});

document.getElementById("addLayerBtn").addEventListener("click", () => {
  const newName = prompt("Layer name:", `layer${layers.length}`);
  if (!newName || layers.includes(newName)) return;

  // New layer starts blank — same size/font but no text, white bg
  keys.forEach(key => {
    const src = key.layers[currentLayer];
    key.layers[newName] = {
      text:     "",
      bg:       "#ffffff",
      color:    src.color || "#000000",
      fontSize: src.fontSize
    };
  });

  layers.push(newName);
  currentLayer = newName;
  rebuildLayerSelect();
  renderKeyboard(keys, currentLayer);
});

// ── Selection sync from render.js ─────────────────────────────
document.addEventListener("selectionChanged", (e) => {
  const ids = e.detail.ids;

  if (ids.length === 0) {
    keyText.value       = "";
    keyColor.value      = "#ffffff";
    keyTextColor.value  = "#000000";
    fontSize.value      = "18";
    keyText.placeholder = "A";
    keyColor.title      = "";
    return;
  }

  if (ids.length === 1) {
    const key = keys.find(k => k.id === ids[0]);
    if (!key) return;
    const layer = key.layers[currentLayer];
    keyText.value      = layer.text;
    keyColor.value     = layer.bg;
    keyTextColor.value = layer.color || "#000000";
    fontSize.value     = layer.fontSize;
    return;
  }

  const selectedKeys = ids.map(id => keys.find(k => k.id === id)).filter(Boolean);
  const ls = selectedKeys.map(k => k.layers[currentLayer]);

  const allSameBg    = ls.every(l => l.bg === ls[0].bg);
  const allSameColor = ls.every(l => (l.color || "#000000") === (ls[0].color || "#000000"));
  const allSameSize  = ls.every(l => l.fontSize === ls[0].fontSize);

  keyColor.value       = allSameBg    ? ls[0].bg                   : "#ffffff";
  keyTextColor.value   = allSameColor ? (ls[0].color || "#000000") : "#000000";
  fontSize.value       = allSameSize  ? ls[0].fontSize             : "";
  fontSize.placeholder = allSameSize  ? ""                         : "mixed";
  keyColor.title       = allSameBg    ? "" : "Mixed — will apply to all selected";
  keyTextColor.title   = allSameColor ? "" : "Mixed — will apply to all selected";
});

// Live-sync text → canvas (single key only)
keyText.addEventListener("input", () => {
  if (selectedIds.size !== 1) return;
  const id = [...selectedIds][0];
  const key = keys.find(k => k.id === id);
  if (!key) return;
  key.layers[currentLayer].text = keyText.value;

  const group = document.querySelector(`#viewport g[data-key-id="${id}"][data-layer="${currentLayer}"]`);
  if (group) {
    const text = group.querySelector("text");
    if (text) text.textContent = keyText.value;
    if (group._input) group._input.value = keyText.value;
  }
});

// ── Apply ─────────────────────────────────────────────────────
document.getElementById("applyChanges").addEventListener("click", () => {
  if (selectedIds.size === 0) return;

  const newBg    = keyColor.value;
  const newColor = keyTextColor.value;
  const newSize  = parseInt(fontSize.value, 10) || null;
  const newText  = keyText.value;

  selectedIds.forEach(id => {
    const key = keys.find(k => k.id === id);
    if (!key) return;
    const layer = key.layers[currentLayer];
    layer.bg    = newBg;
    layer.color = newColor;
    if (newSize) layer.fontSize = newSize;
    if (selectedIds.size === 1) layer.text = newText;
    syncKeyVisual(id);
  });
});

// ── Export PNG ────────────────────────────────────────────────
document.getElementById("exportPngBtn").addEventListener("click", exportPNG);

function exportPNG() {
  const svg = document.getElementById("keyboardCanvas");
  svg.querySelectorAll("foreignObject").forEach(fo => fo.style.display = "none");

  // Temporarily remove dimming so all layers render at full opacity
  const dimmed = svg.querySelectorAll(".inactive-layer");
  dimmed.forEach(el => el.classList.remove("inactive-layer"));

  const xml = new XMLSerializer().serializeToString(svg);

  // Restore dimming
  dimmed.forEach(el => el.classList.add("inactive-layer"));
  const img = new Image();
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  img.onload = () => {
    canvas.width  = svg.clientWidth;
    canvas.height = svg.clientHeight;
    ctx.drawImage(img, 0, 0);
    const link = document.createElement("a");
    link.download = "keyboard-layout.png";
    link.href = canvas.toDataURL();
    link.click();
  };

  img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(xml)));
}

// ── Save ──────────────────────────────────────────────────────
document.getElementById("saveLayoutBtn").addEventListener("click", () => {
  if (!keys.length) { alert("No layout to save."); return; }

  const payload = {
    version: 1,
    savedAt: new Date().toISOString(),
    layers,
    keys: keys.map(k => ({
      id: k.id, x: k.x, y: k.y,
      width: k.width, height: k.height,
      rotation: k.rotation || 0,
      layers: k.layers
    }))
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.download = "keyboard-layout.json";
  link.href = URL.createObjectURL(blob);
  link.click();
  URL.revokeObjectURL(link.href);
});

// ── Load ──────────────────────────────────────────────────────
document.getElementById("loadLayoutBtn").addEventListener("click", () => {
  document.getElementById("loadLayoutInput").click();
});

document.getElementById("loadLayoutInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const payload = JSON.parse(ev.target.result);
      if (!payload.keys || !Array.isArray(payload.keys)) { alert("Invalid layout file."); return; }
      keys = payload.keys;
      layers = payload.layers || ["base"];
      currentLayer = layers[0];
      rebuildLayerSelect();
      renderKeyboard(keys, currentLayer);
    } catch (err) {
      alert("Failed to load layout: " + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = "";
});

// ── Pan & Zoom ────────────────────────────────────────────────
const svg = document.getElementById("keyboardCanvas");

svg.addEventListener("wheel", (e) => {
  e.preventDefault();
  const zoomSpeed = 0.1;
  zoom *= e.deltaY < 0 ? 1 + zoomSpeed : 1 - zoomSpeed;
  zoom = Math.min(Math.max(zoom, 0.2), 5);
  updateViewport();
});

svg.addEventListener("mousedown", (e) => {
  if (e.target.tagName === "INPUT") return;
  isDragging = true;
  dragMoved = false;
  lastX = e.clientX;
  lastY = e.clientY;
});

window.addEventListener("mouseup", (e) => {
  if (isDragging && !dragMoved && !e.target.closest?.("g[data-key-id]")) {
    clearSelection();
  }
  isDragging = false;
  dragMoved = false;
});

window.addEventListener("mousemove", (e) => {
  if (!isDragging) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMoved = true;
  panX += dx;
  panY += dy;
  lastX = e.clientX;
  lastY = e.clientY;
  updateViewport();
});

function updateViewport() {
  if (!viewportGroup) return;
  viewportGroup.setAttribute("transform", `translate(${panX}, ${panY}) scale(${zoom})`);
}

document.getElementById("resetView").addEventListener("click", () => {
  zoom = 1; panX = 0; panY = 0;
  updateViewport();
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") clearSelection();
});