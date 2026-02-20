// ============================================================
// app.js
//
// The "controller" — owns all global state and wires together
// the UI controls (buttons, inputs, file pickers) with the
// rendering and parsing logic in render.js and parser.js.
//
// Responsibilities:
//   - Global state: keys[], layers[], currentLayer, pan/zoom
//   - DXF file import and JSON save/load
//   - Layer creation and switching
//   - Applying panel changes (colour, font size, label) to keys
//   - Pan and zoom via mouse drag and scroll wheel
//   - PNG export
// ============================================================


// ── Global state ─────────────────────────────────────────────

// keys: the single source of truth for all key data.
// An array of objects shaped like:
// {
//   id: "uuid",
//   x: 150,          // centre X on canvas (SVG px)
//   y: 200,          // centre Y on canvas (SVG px)
//   width: 60,
//   height: 60,
//   rotation: 0,
//   layers: {
//     base: { text: "A", bg: "#ff0000", color: "#ffffff", fontSize: 18 },
//     fn:   { text: "",  bg: "#ffffff", color: "#000000", fontSize: 18 }
//   }
// }
let keys = [];

// currentLayer: the name of the layer the user is currently editing.
// Clicking/selecting/applying changes all affect this layer only.
let currentLayer = "base";

// layers: ordered array of all layer names. The order determines the
// top-to-bottom stacking order on the canvas (index 0 = topmost block).
let layers = ["base"];

// ── Pan & zoom state ──────────────────────────────────────────
// These are read and written by both app.js and render.js.
// render.js writes panX/panY/zoom when restoring a saved transform;
// app.js writes them during mouse drag and scroll.
let zoom      = 1;    // current zoom level (1 = 100%, 2 = 200%, etc.)
let panX      = 0;    // horizontal offset in screen pixels
let panY      = 0;    // vertical offset in screen pixels
let isDragging = false; // true while the user is holding the mouse button on the canvas
let dragMoved  = false; // true if the mouse moved enough to count as a drag (not a click)
let lastX      = 0;   // previous mouse X, used to calculate drag delta
let lastY      = 0;   // previous mouse Y


// ── DOM references ────────────────────────────────────────────
// Grab all the UI elements we'll need to read from or write to.
// Done once at startup rather than repeatedly inside event handlers.
const fileInput    = document.getElementById("fileInput");    // hidden file <input> for DXF
const keyText      = document.getElementById("keyText");      // panel: key label text field
const keyColor     = document.getElementById("keyColor");     // panel: background colour picker
const keyTextColor = document.getElementById("keyTextColor"); // panel: text colour picker
const fontSize     = document.getElementById("fontSize");     // panel: font size field
const layerSelect  = document.getElementById("layerSelect");  // toolbar: layer dropdown


// ============================================================
// DXF IMPORT
// ============================================================

// When the user picks a file from the "Import DXF" button,
// read it, parse it into key objects, and render the keyboard.
fileInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  if (file.name.endsWith(".dxf")) {
    // parseDXFFile is defined in parser.js.
    // It returns a Promise that resolves to the keys array.
    keys = await parseDXFFile(file);

    // Draw the keyboard. renderKeyboard is defined in render.js.
    renderKeyboard(keys, currentLayer);
  }
});


// ============================================================
// LAYER MANAGEMENT
// ============================================================

// rebuildLayerSelect()
// --------------------
// Repopulates the layer <select> dropdown to match the `layers` array.
// Called after adding a layer or loading a saved file.
function rebuildLayerSelect() {
  layerSelect.innerHTML = ""; // clear existing options

  layers.forEach(name => {
    const opt = document.createElement("option");
    opt.value = name;
    // Capitalise the first letter for display (e.g. "base" → "Base")
    opt.textContent = name.charAt(0).toUpperCase() + name.slice(1);
    layerSelect.appendChild(opt);
  });

  // Make sure the dropdown shows the currently active layer
  layerSelect.value = currentLayer;
}

// Layer dropdown change: switch which layer is active.
// This re-renders so the canvas updates the active layer highlight
// and the inactive layer dimming.
layerSelect.addEventListener("change", () => {
  currentLayer = layerSelect.value;
  clearSelection(); // deselect everything — selection is per-layer
  renderKeyboard(keys, currentLayer);
});

// "Add Layer" button: prompt for a name, create blank layer data
// for every key, and switch to the new layer.
document.getElementById("addLayerBtn").addEventListener("click", () => {
  const newName = prompt("Layer name:", `layer${layers.length}`);

  // Do nothing if the user cancelled or entered a name that already exists
  if (!newName || layers.includes(newName)) return;

  // For every existing key, add an entry for the new layer.
  // New layers start completely blank: empty label, white background.
  // We copy fontSize from the current layer so text scale stays consistent.
  keys.forEach(key => {
    const src = key.layers[currentLayer]; // source layer to copy fontSize from
    key.layers[newName] = {
      text:     "",                        // blank label
      bg:       "#ffffff",                 // white background
      color:    src.color || "#000000",    // keep same text colour
      fontSize: src.fontSize               // keep same font size
    };
  });

  // Add to the ordered list and switch to it
  layers.push(newName);
  currentLayer = newName;

  // Update the dropdown and redraw
  rebuildLayerSelect();
  renderKeyboard(keys, currentLayer);
});


// ============================================================
// PANEL ↔ SELECTION SYNC
// ============================================================

// render.js fires a "selectionChanged" custom event every time
// the selection changes (click, shift+click, rubber-band, deselect).
// We listen here and update the panel inputs to reflect the
// selected key(s)' current values.
document.addEventListener("selectionChanged", (e) => {
  const ids = e.detail.ids; // array of selected key IDs

  // ── Nothing selected ──────────────────────────────────────
  if (ids.length === 0) {
    keyText.value       = "";
    keyColor.value      = "#ffffff";
    keyTextColor.value  = "#000000";
    fontSize.value      = "18";
    keyText.placeholder = "A";
    keyColor.title      = "";
    return;
  }

  // ── Single key selected ───────────────────────────────────
  if (ids.length === 1) {
    const key   = keys.find(k => k.id === ids[0]);
    if (!key) return;
    const layer = key.layers[currentLayer];

    // Populate all panel fields with this key's values
    keyText.value      = layer.text;
    keyColor.value     = layer.bg;
    keyTextColor.value = layer.color || "#000000";
    fontSize.value     = layer.fontSize;
    return;
  }

  // ── Multiple keys selected ────────────────────────────────
  // When multiple keys are selected, the panel fields should show:
  //   - The shared value if all selected keys agree (e.g. all red)
  //   - A neutral default + tooltip hint if they differ ("mixed")
  const selectedKeys = ids.map(id => keys.find(k => k.id === id)).filter(Boolean);
  const ls = selectedKeys.map(k => k.layers[currentLayer]);

  // Check if all selected keys share the same value for each property
  const allSameBg    = ls.every(l => l.bg === ls[0].bg);
  const allSameColor = ls.every(l => (l.color || "#000000") === (ls[0].color || "#000000"));
  const allSameSize  = ls.every(l => l.fontSize === ls[0].fontSize);

  // Show shared value or neutral default
  keyColor.value       = allSameBg    ? ls[0].bg                   : "#ffffff";
  keyTextColor.value   = allSameColor ? (ls[0].color || "#000000") : "#000000";
  fontSize.value       = allSameSize  ? ls[0].fontSize             : "";
  fontSize.placeholder = allSameSize  ? ""                         : "mixed"; // hint in empty field

  // Show a tooltip on the colour pickers to explain they'll overwrite mixed values
  keyColor.title       = allSameBg    ? "" : "Mixed — will apply to all selected";
  keyTextColor.title   = allSameColor ? "" : "Mixed — will apply to all selected";
});


// Live-sync: as the user types in the Key Label panel field,
// update the canvas immediately (without needing to click Apply).
// Only works when exactly one key is selected — bulk label editing
// doesn't make sense.
keyText.addEventListener("input", () => {
  if (selectedIds.size !== 1) return; // selectedIds is defined in render.js

  const id  = [...selectedIds][0]; // get the single selected ID
  const key = keys.find(k => k.id === id);
  if (!key) return;

  // Update the data model
  key.layers[currentLayer].text = keyText.value;

  // Update the canvas without a full re-render by targeting just this key's elements.
  // We query by both key ID and layer to get the right group element.
  const group = document.querySelector(
    `#viewport g[data-key-id="${id}"][data-layer="${currentLayer}"]`
  );
  if (group) {
    const text = group.querySelector("text");
    if (text) text.textContent = keyText.value;
    // Also update the inline editor input in case it's open
    if (group._input) group._input.value = keyText.value;
  }
});


// ── Apply button ──────────────────────────────────────────────
// Applies background colour, text colour, and font size from the
// panel to ALL currently selected keys on the current layer.
// Text label is only applied when one key is selected.
document.getElementById("applyChanges").addEventListener("click", () => {
  if (selectedIds.size === 0) return;

  const newBg    = keyColor.value;
  const newColor = keyTextColor.value;
  // parseInt with radix 10 converts the string "18" to the number 18.
  // || null means if the field is empty or "mixed", we skip updating fontSize.
  const newSize  = parseInt(fontSize.value, 10) || null;
  const newText  = keyText.value;

  // Apply to every selected key
  selectedIds.forEach(id => {
    const key = keys.find(k => k.id === id);
    if (!key) return;
    const layer = key.layers[currentLayer];

    layer.bg    = newBg;
    layer.color = newColor;
    if (newSize) layer.fontSize = newSize; // only update if we have a valid number
    if (selectedIds.size === 1) layer.text = newText; // label only for single-select

    // syncKeyVisual updates the DOM elements to match the updated data.
    // Defined in render.js.
    syncKeyVisual(id);
  });
});


// ============================================================
// PNG EXPORT
// ============================================================

document.getElementById("exportPngBtn").addEventListener("click", exportPNG);

function exportPNG() {
  const svg = document.getElementById("keyboardCanvas");

  // foreignObject elements (the inline text editors) don't render
  // when SVG is converted to a PNG via canvas, so hide them first.
  svg.querySelectorAll("foreignObject").forEach(fo => fo.style.display = "none");

  // The .inactive-layer CSS class dims non-active layers to 45% opacity
  // in the editor. For the exported image we want all layers at full
  // brightness, so we temporarily remove the class.
  const dimmed = svg.querySelectorAll(".inactive-layer");
  dimmed.forEach(el => el.classList.remove("inactive-layer"));

  // Serialise the SVG DOM to an XML string
  const xml = new XMLSerializer().serializeToString(svg);

  // Restore the dimming class now that we have the serialised string
  dimmed.forEach(el => el.classList.add("inactive-layer"));

  const img    = new Image();
  const canvas = document.createElement("canvas");
  const ctx    = canvas.getContext("2d");

  img.onload = () => {
    // Size the canvas to match the SVG element's pixel dimensions
    canvas.width  = svg.clientWidth;
    canvas.height = svg.clientHeight;
    ctx.drawImage(img, 0, 0);

    // Trigger a download by creating a temporary <a> link
    const link = document.createElement("a");
    link.download = "keyboard-layout.png";
    link.href     = canvas.toDataURL(); // PNG data URL
    link.click();
  };

  // Convert the XML string to a base64 data URL so we can load it
  // as an Image. btoa() encodes to base64; unescape+encodeURIComponent
  // handles any non-ASCII characters in key labels.
  img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(xml)));
}


// ============================================================
// SAVE / LOAD (JSON)
// ============================================================

// Save: serialise the entire state (all keys, all layers, all
// layer data) to a JSON file the user can download.
document.getElementById("saveLayoutBtn").addEventListener("click", () => {
  if (!keys.length) { alert("No layout to save."); return; }

  const payload = {
    version: 1,                        // for future format migrations
    savedAt: new Date().toISOString(), // timestamp for reference
    layers,                            // the ordered layer names array
    keys: keys.map(k => ({            // strip only what we need to save
      id:       k.id,
      x:        k.x,
      y:        k.y,
      width:    k.width,
      height:   k.height,
      rotation: k.rotation || 0,
      layers:   k.layers             // all layer data for this key
    }))
  };

  // Create a downloadable Blob from the JSON string
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.download = "keyboard-layout.json";
  link.href     = URL.createObjectURL(blob); // temporary URL pointing to the blob
  link.click();
  URL.revokeObjectURL(link.href); // free the temporary URL after download
});

// Load: open a file picker for a .json file, parse it, and restore
// the full keyboard state (keys + layers) from it.
document.getElementById("loadLayoutBtn").addEventListener("click", () => {
  // Trigger the hidden file input
  document.getElementById("loadLayoutInput").click();
});

document.getElementById("loadLayoutInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const payload = JSON.parse(ev.target.result);

      // Basic validation — make sure it looks like one of our layout files
      if (!payload.keys || !Array.isArray(payload.keys)) {
        alert("Invalid layout file.");
        return;
      }

      // Restore global state from the file
      keys         = payload.keys;
      layers       = payload.layers || ["base"]; // fallback for older saves without layers
      currentLayer = layers[0];                  // start on the first layer

      // Rebuild the dropdown and re-render
      rebuildLayerSelect();
      renderKeyboard(keys, currentLayer);
    } catch (err) {
      alert("Failed to load layout: " + err.message);
    }
  };

  reader.readAsText(file);

  // Reset the input so loading the same file twice in a row works
  e.target.value = "";
});


// ============================================================
// PAN & ZOOM
// ============================================================

const svg = document.getElementById("keyboardCanvas");

// Scroll wheel: zoom in/out around the current view centre.
// e.preventDefault() stops the page from scrolling at the same time.
svg.addEventListener("wheel", (e) => {
  e.preventDefault();

  const zoomSpeed = 0.1; // 10% zoom per scroll tick

  // deltaY is negative when scrolling up (zoom in), positive when down (zoom out)
  zoom *= e.deltaY < 0 ? 1 + zoomSpeed : 1 - zoomSpeed;

  // Clamp zoom between 20% and 500% to prevent getting lost
  zoom = Math.min(Math.max(zoom, 0.2), 5);

  updateViewport();
});

// Mouse button down on the canvas: start tracking a potential drag.
// We don't start panning immediately — we wait to see if the mouse moves.
svg.addEventListener("mousedown", (e) => {
  // Don't start a drag if the user clicked inside a text input
  if (e.target.tagName === "INPUT") return;

  isDragging = true;
  dragMoved  = false; // reset movement flag
  lastX = e.clientX;
  lastY = e.clientY;
});

// Mouse button released anywhere on the page.
window.addEventListener("mouseup", (e) => {
  // If the mouse didn't move and was released on empty canvas,
  // treat it as a click on the background → deselect everything.
  if (isDragging && !dragMoved && !e.target.closest?.("g[data-key-id]")) {
    clearSelection(); // defined in render.js
  }

  isDragging = false;
  dragMoved  = false;
});

// Mouse move: if dragging, calculate how far the mouse moved since
// last frame and add that delta to panX/panY.
window.addEventListener("mousemove", (e) => {
  if (!isDragging) return;

  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;

  // Mark as a real drag once the mouse moves more than 2px
  // (prevents accidental panning on a plain click)
  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMoved = true;

  panX += dx;
  panY += dy;

  // Remember the current position for next frame's delta calculation
  lastX = e.clientX;
  lastY = e.clientY;

  updateViewport();
});

// updateViewport()
// ----------------
// Applies the current panX/panY/zoom values to the SVG viewport group.
// SVG `transform` syntax: translate(x, y) scale(zoom)
// The translate comes before scale so the offset is in screen pixels,
// not scaled pixels (otherwise panning speed would change with zoom).
function updateViewport() {
  if (!viewportGroup) return; // viewportGroup is set by render.js
  viewportGroup.setAttribute(
    "transform",
    `translate(${panX}, ${panY}) scale(${zoom})`
  );
}

// Reset View button: snap back to the default no-pan, no-zoom state.
document.getElementById("resetView").addEventListener("click", () => {
  zoom = 1;
  panX = 0;
  panY = 0;
  updateViewport();
});

// Escape key: deselect all keys from anywhere in the app.
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") clearSelection(); // clearSelection is in render.js
});