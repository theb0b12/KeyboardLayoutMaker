const SVG_NS = "http://www.w3.org/2000/svg";

let viewportGroup = null;

// Multi-select state — { layerName -> Set of ids }
// But selection is per-layer, keyed by currentLayer
let selectedIds = new Set();

// Rubber-band
let rubberBand = null;
let isRubberBanding = false;

// Gap between layer blocks on the canvas
const LAYER_GAP = 80;
const LAYER_LABEL_HEIGHT = 28;

function renderKeyboard(keys, currentLayer) {
  // `layers` is defined in app.js
  const allLayers = typeof layers !== "undefined" ? layers : [currentLayer];

  const svg = document.getElementById("keyboardCanvas");
  const oldViewport = document.getElementById("viewport");
  const oldTransform = oldViewport ? oldViewport.getAttribute("transform") : null;

  svg.innerHTML = "";
  selectedIds.clear();
  updateSelectionPanel();

  viewportGroup = document.createElementNS(SVG_NS, "g");
  viewportGroup.id = "viewport";

  if (oldTransform) {
    viewportGroup.setAttribute("transform", oldTransform);
  }

  // Figure out the bounding height of one keyboard block
  const blockHeight = getKeysHeight(keys);

  allLayers.forEach((layerName, layerIndex) => {
    const offsetY = layerIndex * (blockHeight + LAYER_GAP + LAYER_LABEL_HEIGHT);

    // Layer label
    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("x", 50);
    label.setAttribute("y", offsetY + LAYER_LABEL_HEIGHT - 8);
    label.setAttribute("font-size", "14");
    label.setAttribute("fill", layerName === currentLayer ? "#4c8bf5" : "#5a6880");
    label.setAttribute("font-family", "system-ui, sans-serif");
    label.setAttribute("font-weight", "600");
    label.setAttribute("letter-spacing", "1");
    label.setAttribute("pointer-events", "none");
    label.textContent = layerName.toUpperCase();

    // Underline for active layer
    if (layerName === currentLayer) {
      const underline = document.createElementNS(SVG_NS, "line");
      underline.setAttribute("x1", 50);
      underline.setAttribute("y1", offsetY + LAYER_LABEL_HEIGHT - 4);
      underline.setAttribute("x2", 50 + layerName.length * 9);
      underline.setAttribute("y2", offsetY + LAYER_LABEL_HEIGHT - 4);
      underline.setAttribute("stroke", "#4c8bf5");
      underline.setAttribute("stroke-width", "2");
      underline.setAttribute("pointer-events", "none");
      viewportGroup.appendChild(underline);
    }

    viewportGroup.appendChild(label);

    // Separator line between layers (not before first)
    if (layerIndex > 0) {
      const sep = document.createElementNS(SVG_NS, "line");
      const sepY = offsetY - LAYER_GAP / 2;
      sep.setAttribute("x1", 30);
      sep.setAttribute("y1", sepY);
      sep.setAttribute("x2", 2000);
      sep.setAttribute("y2", sepY);
      sep.setAttribute("stroke", "#2a2f3a");
      sep.setAttribute("stroke-width", "1");
      sep.setAttribute("stroke-dasharray", "6,4");
      sep.setAttribute("pointer-events", "none");
      viewportGroup.appendChild(sep);
    }

    // Render all keys for this layer, offset by Y
    keys.forEach(key => {
      buildKeyElement(key, layerName, offsetY + LAYER_LABEL_HEIGHT, currentLayer);
    });
  });

  // Rubber-band overlay (always on top)
  const rubberGroup = document.createElementNS(SVG_NS, "g");
  rubberGroup.id = "rubberGroup";
  viewportGroup.appendChild(rubberGroup);

  svg.appendChild(viewportGroup);

  setupRubberBand(svg, keys, currentLayer, allLayers, blockHeight);

  if (oldTransform) {
    const match = oldTransform.match(
      /translate\(([-\d.]+),\s*([-\d.]+)\)\s*scale\(([-\d.]+)\)/
    );
    if (match) {
      panX = parseFloat(match[1]);
      panY = parseFloat(match[2]);
      zoom = parseFloat(match[3]);
    }
  }
}

function getKeysHeight(keys) {
  if (!keys.length) return 400;
  const maxY = Math.max(...keys.map(k => k.y + k.height / 2));
  const minY = Math.min(...keys.map(k => k.y - k.height / 2));
  return maxY - minY + 60;
}

function buildKeyElement(key, layerName, offsetY, currentLayer) {
  const layer = key.layers[layerName];
  if (!layer) return;

  const group = document.createElementNS(SVG_NS, "g");
  group.dataset.keyId = key.id;
  group.dataset.layer = layerName;
  group.setAttribute(
    "transform",
    `translate(${key.x - key.width / 2}, ${(key.y - key.height / 2) + offsetY})`
  );

  const rect = document.createElementNS(SVG_NS, "rect");
  rect.setAttribute("width", key.width);
  rect.setAttribute("height", key.height);
  rect.setAttribute("rx", 6);
  rect.setAttribute("fill", layer.bg);
  rect.setAttribute("stroke", "#333");
  rect.setAttribute("stroke-width", "2");
  // Only interactive on the current layer
  rect.style.cursor = layerName === currentLayer ? "pointer" : "default";
  if (layerName !== currentLayer) group.classList.add("inactive-layer");

  const highlightRect = document.createElementNS(SVG_NS, "rect");
  highlightRect.setAttribute("width", key.width);
  highlightRect.setAttribute("height", key.height);
  highlightRect.setAttribute("rx", 6);
  highlightRect.setAttribute("fill", "rgba(76,139,245,0.08)");
  highlightRect.setAttribute("stroke", "#4c8bf5");
  highlightRect.setAttribute("stroke-width", "3");
  highlightRect.setAttribute("pointer-events", "none");
  highlightRect.style.display = "none";

  const text = document.createElementNS(SVG_NS, "text");
  text.setAttribute("x", key.width / 2);
  text.setAttribute("y", key.height / 2);
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("dominant-baseline", "middle");
  text.setAttribute("font-size", layer.fontSize);
  text.setAttribute("fill", layer.color || "#000000");
  text.setAttribute("pointer-events", "none");
  text.setAttribute("user-select", "none");
  text.textContent = layer.text;

  const fo = document.createElementNS(SVG_NS, "foreignObject");
  fo.setAttribute("x", 4);
  fo.setAttribute("y", 4);
  fo.setAttribute("width", key.width - 8);
  fo.setAttribute("height", key.height - 8);
  fo.style.display = "none";
  fo.style.overflow = "hidden";

  const input = document.createElement("input");
  input.type = "text";
  input.value = layer.text;
  input.style.cssText = `
    width: 100%; height: 100%;
    background: transparent; border: none; outline: none;
    text-align: center; font-size: ${layer.fontSize}px;
    color: ${layer.color || "#000000"};
    font-family: inherit; padding: 0; box-sizing: border-box; cursor: text;
  `;
  fo.appendChild(input);

  group.appendChild(rect);
  group.appendChild(text);
  group.appendChild(fo);
  group.appendChild(highlightRect);

  // Only attach interaction to current layer's keys
  if (layerName === currentLayer) {
    group.addEventListener("click", (e) => {
      if (fo.style.display !== "none") return;
      e.stopPropagation();

      if (e.shiftKey) {
        if (selectedIds.has(key.id)) {
          selectedIds.delete(key.id);
          setKeyHighlight(group, false);
        } else {
          selectedIds.add(key.id);
          setKeyHighlight(group, true);
          bringToTop(group);
        }
      } else {
        clearAllHighlights();
        selectedIds.clear();
        selectedIds.add(key.id);
        setKeyHighlight(group, true);
        bringToTop(group);
      }

      updateSelectionPanel();
    });

    group.addEventListener("dblclick", (e) => {
      if (selectedIds.size > 1) return;
      e.stopPropagation();
      clearAllHighlights();
      selectedIds.clear();
      selectedIds.add(key.id);
      setKeyHighlight(group, true);
      bringToTop(group);
      updateSelectionPanel();
      enterEditMode();
    });
  }

  function enterEditMode() {
    text.style.display = "none";
    fo.style.display = "block";
    input.style.fontSize = layer.fontSize + "px";
    input.style.color = layer.color || "#000000";
    input.value = layer.text;
    input.focus();
    input.select();
  }

  function exitEditMode() {
    const newText = input.value;
    layer.text = newText;
    text.textContent = newText;
    const keyTextEl = document.getElementById("keyText");
    if (keyTextEl && selectedIds.size === 1) keyTextEl.value = newText;
    fo.style.display = "none";
    text.style.display = "";
  }

  input.addEventListener("blur", exitEditMode);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === "Escape") input.blur();
    e.stopPropagation();
  });
  input.addEventListener("mousedown", (e) => e.stopPropagation());

  group._enterEditMode = enterEditMode;
  group._input = input;
  group._fo = fo;
  group._layer = layer;
  group._rect = rect;
  group._highlightRect = highlightRect;

  viewportGroup.appendChild(group);
  return group;
}

// ── Rubber-band ───────────────────────────────────────────────

function setupRubberBand(svg, keys, currentLayer, allLayers, blockHeight) {
  let rbStartSVG = null;

  svg.addEventListener("mousedown", (e) => {
    if (e.target.tagName === "INPUT") return;
    const clickedGroup = e.target.closest("g[data-key-id]");
    if (clickedGroup) return;

    isRubberBanding = true;
    rbStartSVG = svgPoint(svg, e.clientX, e.clientY);

    rubberBand = document.createElementNS(SVG_NS, "rect");
    rubberBand.setAttribute("fill", "rgba(76,139,245,0.12)");
    rubberBand.setAttribute("stroke", "#4c8bf5");
    rubberBand.setAttribute("stroke-width", "1.5");
    rubberBand.setAttribute("stroke-dasharray", "5,3");
    rubberBand.setAttribute("pointer-events", "none");
    rubberBand.setAttribute("rx", "3");

    const rg = document.getElementById("rubberGroup");
    if (rg) rg.appendChild(rubberBand);
  });

  window.addEventListener("mousemove", (e) => {
    if (!isRubberBanding || !rubberBand || !rbStartSVG) return;
    const cur = svgPoint(svg, e.clientX, e.clientY);
    rubberBand.setAttribute("x", Math.min(rbStartSVG.x, cur.x));
    rubberBand.setAttribute("y", Math.min(rbStartSVG.y, cur.y));
    rubberBand.setAttribute("width", Math.abs(cur.x - rbStartSVG.x));
    rubberBand.setAttribute("height", Math.abs(cur.y - rbStartSVG.y));
  });

  window.addEventListener("mouseup", (e) => {
    if (!isRubberBanding) return;
    isRubberBanding = false;

    if (!rubberBand || !rbStartSVG) return;
    const cur = svgPoint(svg, e.clientX, e.clientY);
    const selX = Math.min(rbStartSVG.x, cur.x);
    const selY = Math.min(rbStartSVG.y, cur.y);
    const selW = Math.abs(cur.x - rbStartSVG.x);
    const selH = Math.abs(cur.y - rbStartSVG.y);

    rubberBand.remove();
    rubberBand = null;
    rbStartSVG = null;

    if (selW < 4 && selH < 4) return;

    if (!e.shiftKey) { clearAllHighlights(); selectedIds.clear(); }

    // Only select keys in the current layer block
    const layerIndex = allLayers.indexOf(currentLayer);
    const layerOffsetY = layerIndex * (blockHeight + LAYER_GAP + LAYER_LABEL_HEIGHT) + LAYER_LABEL_HEIGHT;

    keys.forEach(key => {
      const kx = key.x - key.width / 2;
      const ky = (key.y - key.height / 2) + layerOffsetY;
      const overlaps = !(kx + key.width < selX || kx > selX + selW || ky + key.height < selY || ky > selY + selH);
      if (overlaps) {
        const group = document.querySelector(`#viewport g[data-key-id="${key.id}"][data-layer="${currentLayer}"]`);
        if (group) {
          selectedIds.add(key.id);
          setKeyHighlight(group, true);
          bringToTop(group);
        }
      }
    });

    updateSelectionPanel();
  });
}

// ── Helpers ───────────────────────────────────────────────────

function svgPoint(svg, clientX, clientY) {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const screenCTM = viewportGroup.getScreenCTM();
  if (!screenCTM) return { x: clientX, y: clientY };
  return pt.matrixTransform(screenCTM.inverse());
}

function setKeyHighlight(group, on) {
  const hr = group._highlightRect;
  if (hr) hr.style.display = on ? "" : "none";
}

function clearAllHighlights() {
  document.querySelectorAll("#viewport g[data-key-id]").forEach(g => setKeyHighlight(g, false));
}

function bringToTop(group) {
  if (viewportGroup && group.parentNode === viewportGroup) {
    const rg = document.getElementById("rubberGroup");
    viewportGroup.insertBefore(group, rg);
  }
}

function clearSelection() {
  clearAllHighlights();
  selectedIds.clear();
  updateSelectionPanel();
}

function syncKeyVisual(keyId) {
  // Update all layer instances of this key visually
  document.querySelectorAll(`#viewport g[data-key-id="${keyId}"]`).forEach(group => {
    const layer = group._layer;
    if (!layer) return;
    const rect = group._rect;
    const text = group.querySelector("text");
    const input = group._input;
    if (rect) rect.setAttribute("fill", layer.bg);
    if (text) {
      text.textContent = layer.text;
      text.setAttribute("font-size", layer.fontSize);
      text.setAttribute("fill", layer.color || "#000000");
    }
    if (input) {
      input.value = layer.text;
      input.style.fontSize = layer.fontSize + "px";
      input.style.color = layer.color || "#000000";
    }
  });
}

function updateSelectionPanel() {
  const count = selectedIds.size;
  const badge = document.getElementById("selectionBadge");
  const keyTextLabel = document.getElementById("keyTextLabel");

  if (badge) {
    if (count === 0) { badge.textContent = "No selection"; badge.className = "badge badge-none"; }
    else if (count === 1) { badge.textContent = "1 key selected"; badge.className = "badge badge-one"; }
    else { badge.textContent = `${count} keys selected`; badge.className = "badge badge-multi"; }
  }

  if (keyTextLabel) keyTextLabel.style.display = count > 1 ? "none" : "";

  document.dispatchEvent(new CustomEvent("selectionChanged", { detail: { ids: [...selectedIds] } }));
}