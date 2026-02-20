// ============================================================
// render.js
//
// Responsible for drawing the keyboard onto the SVG canvas and
// handling all mouse interactions directly on the keys:
//   - single click to select
//   - shift+click for multi-select
//   - double-click to type a label inline on the key
//   - click+drag on empty canvas for rubber-band selection
//
// This file also owns the `selectedIds` Set (which keys are
// currently selected) and the highlight/deselect helpers that
// app.js calls into.
//
// SVG structure produced:
//   <svg id="keyboardCanvas">
//     <g id="viewport">          ← panned/zoomed by app.js
//       <line/>                  ← separator between layer blocks
//       <text/>                  ← layer name label
//       <g data-key-id data-layer>  ← one group per key per layer
//         <rect/>                ← coloured key background
//         <text/>                ← key label (visible normally)
//         <foreignObject>        ← contains an <input> for inline editing
//           <input/>
//         </foreignObject>
//         <rect/>                ← highlight border (shown when selected)
//       </g>
//       ...more keys...
//       <g id="rubberGroup"/>    ← rubber-band selection rect drawn here
//     </g>
//   </svg>
// ============================================================


// SVG_NS is the XML namespace required when creating SVG elements
// via JavaScript. Without it, createElement would make HTML elements
// that don't render properly inside an <svg>.
const SVG_NS = "http://www.w3.org/2000/svg";

// viewportGroup is the single <g> that wraps everything on the canvas.
// Pan and zoom are applied to this element's `transform` attribute,
// so moving/scaling this one group moves everything at once.
let viewportGroup = null;

// selectedIds is a Set of key IDs (the `id` field from each key object)
// that are currently selected. A Set is used so membership checks
// (selectedIds.has(id)) are O(1) and there are no duplicates.
// app.js reads this directly to know what to apply changes to.
let selectedIds = new Set();

// Rubber-band drag state. rubberBand is the SVG <rect> element drawn
// while the user is dragging a selection box on empty canvas.
let rubberBand = null;
let isRubberBanding = false;

// Layout constants for stacking multiple layer blocks vertically.
// LAYER_GAP is the empty space between the bottom of one keyboard
// block and the top label of the next.
// LAYER_LABEL_HEIGHT is the height reserved above each block for
// the layer name text (e.g. "BASE", "FN").
const LAYER_GAP = 80;
const LAYER_LABEL_HEIGHT = 28;


// ── renderKeyboard ────────────────────────────────────────────
//
// Main entry point called by app.js whenever:
//   - a DXF file is loaded
//   - a JSON layout is loaded
//   - the active layer changes (to update which block is highlighted)
//   - a new layer is added
//
// Completely clears and redraws the SVG from scratch each time.
// The current pan/zoom transform is preserved so the view doesn't jump.
//
// Parameters:
//   keys         — array of key objects (from parser.js or loaded JSON)
//   currentLayer — name of the layer currently active for editing
function renderKeyboard(keys, currentLayer) {
  // `layers` is a global array declared in app.js containing all layer
  // names in order (e.g. ["base", "fn"]). We fall back to just the
  // current layer if somehow app.js hasn't defined it yet.
  const allLayers = typeof layers !== "undefined" ? layers : [currentLayer];

  const svg = document.getElementById("keyboardCanvas");

  // Before wiping the SVG, grab the existing transform so we can
  // reapply it after redraw — otherwise every re-render would reset
  // the user's pan and zoom back to the default.
  const oldViewport = document.getElementById("viewport");
  const oldTransform = oldViewport ? oldViewport.getAttribute("transform") : null;

  // Wipe everything inside the SVG and reset selection state
  svg.innerHTML = "";
  selectedIds.clear();
  updateSelectionPanel(); // tell the panel there's nothing selected

  // Create a fresh viewport group. Everything is appended to this.
  viewportGroup = document.createElementNS(SVG_NS, "g");
  viewportGroup.id = "viewport";

  // Reapply the saved pan/zoom transform if there was one
  if (oldTransform) {
    viewportGroup.setAttribute("transform", oldTransform);
  }

  // Calculate how tall one keyboard block is so we know how far
  // to offset each subsequent layer block downward
  const blockHeight = getKeysHeight(keys);

  // Draw each layer as a separate keyboard block stacked vertically
  allLayers.forEach((layerName, layerIndex) => {
    // offsetY is how far down this layer block starts.
    // Layer 0 = top, layer 1 = below the first block + gap, etc.
    const offsetY = layerIndex * (blockHeight + LAYER_GAP + LAYER_LABEL_HEIGHT);

    // ── Layer name label (e.g. "BASE", "FN") ──────────────────
    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("x", 50);
    label.setAttribute("y", offsetY + LAYER_LABEL_HEIGHT - 8); // sit just above the keys
    label.setAttribute("font-size", "14");
    // Active layer is bright blue, inactive layers are muted grey
    label.setAttribute("fill", layerName === currentLayer ? "#4c8bf5" : "#5a6880");
    label.setAttribute("font-family", "system-ui, sans-serif");
    label.setAttribute("font-weight", "600");
    label.setAttribute("letter-spacing", "1");
    label.setAttribute("pointer-events", "none"); // labels shouldn't block clicks
    label.textContent = layerName.toUpperCase();

    // Draw a blue underline beneath the active layer's label
    if (layerName === currentLayer) {
      const underline = document.createElementNS(SVG_NS, "line");
      underline.setAttribute("x1", 50);
      underline.setAttribute("y1", offsetY + LAYER_LABEL_HEIGHT - 4);
      // Approximate label width by multiplying character count × 9px
      underline.setAttribute("x2", 50 + layerName.length * 9);
      underline.setAttribute("y2", offsetY + LAYER_LABEL_HEIGHT - 4);
      underline.setAttribute("stroke", "#4c8bf5");
      underline.setAttribute("stroke-width", "2");
      underline.setAttribute("pointer-events", "none");
      viewportGroup.appendChild(underline);
    }

    viewportGroup.appendChild(label);

    // ── Dashed separator line between layer blocks ─────────────
    // Don't draw one before the very first block
    if (layerIndex > 0) {
      const sep = document.createElementNS(SVG_NS, "line");
      const sepY = offsetY - LAYER_GAP / 2; // centre it in the gap
      sep.setAttribute("x1", 30);
      sep.setAttribute("y1", sepY);
      sep.setAttribute("x2", 2000); // extend across the full canvas width
      sep.setAttribute("y2", sepY);
      sep.setAttribute("stroke", "#2a2f3a");
      sep.setAttribute("stroke-width", "1");
      sep.setAttribute("stroke-dasharray", "6,4"); // dashed line pattern
      sep.setAttribute("pointer-events", "none");
      viewportGroup.appendChild(sep);
    }

    // ── Draw all keys for this layer ──────────────────────────
    // offsetY + LAYER_LABEL_HEIGHT pushes the keys down past the label
    keys.forEach(key => {
      buildKeyElement(key, layerName, offsetY + LAYER_LABEL_HEIGHT, currentLayer);
    });
  });

  // ── Rubber-band overlay group ──────────────────────────────
  // This empty group is appended last so it paints on top of all keys.
  // The drag-selection rectangle is drawn inside it temporarily.
  const rubberGroup = document.createElementNS(SVG_NS, "g");
  rubberGroup.id = "rubberGroup";
  viewportGroup.appendChild(rubberGroup);

  svg.appendChild(viewportGroup);

  // Wire up the rubber-band drag-select behaviour for this render
  setupRubberBand(svg, keys, currentLayer, allLayers, blockHeight);

  // Parse the saved transform string back into panX/panY/zoom numbers
  // so that app.js's updateViewport() stays in sync.
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


// ── getKeysHeight ─────────────────────────────────────────────
//
// Calculates the total pixel height needed to display one full
// keyboard block, used to know how far to offset each layer.
// Returns 400px as a safe fallback if there are no keys yet.
function getKeysHeight(keys) {
  if (!keys.length) return 400;
  // Find the lowest and highest key edges
  const maxY = Math.max(...keys.map(k => k.y + k.height / 2));
  const minY = Math.min(...keys.map(k => k.y - k.height / 2));
  // Add 60px padding so keys don't sit right at the boundary
  return maxY - minY + 60;
}


// ── buildKeyElement ───────────────────────────────────────────
//
// Creates all the SVG elements for one key on one layer and
// appends them to the viewport group.
//
// Parameters:
//   key          — the key data object { id, x, y, width, height, layers }
//   layerName    — which layer we're rendering ("base", "fn", etc.)
//   offsetY      — how many px to push this block down on the canvas
//   currentLayer — the layer that's currently active/editable
function buildKeyElement(key, layerName, offsetY, currentLayer) {
  // Get the visual data for this specific layer
  const layer = key.layers[layerName];
  if (!layer) return; // safety: skip if this layer doesn't exist on this key

  // ── Wrapper <g> group ──────────────────────────────────────
  // All elements for this key live inside one <g> so we can move,
  // show, hide, and query them as a unit.
  // data-key-id and data-layer are HTML data attributes used by
  // querySelector to find specific key groups later.
  const group = document.createElementNS(SVG_NS, "g");
  group.dataset.keyId = key.id;
  group.dataset.layer = layerName;
  // Translate positions the group's top-left corner.
  // key.x/key.y are the key's centre, so we subtract half the size.
  // offsetY shifts the whole block down for this layer.
  group.setAttribute(
    "transform",
    `translate(${key.x - key.width / 2}, ${(key.y - key.height / 2) + offsetY})`
  );

  // ── Background rectangle ───────────────────────────────────
  const rect = document.createElementNS(SVG_NS, "rect");
  rect.setAttribute("width", key.width);
  rect.setAttribute("height", key.height);
  rect.setAttribute("rx", 6);           // rounded corners (6px radius)
  rect.setAttribute("fill", layer.bg);  // background colour from layer data
  rect.setAttribute("stroke", "#333");  // dark border
  rect.setAttribute("stroke-width", "2");
  // Only show a pointer cursor on the active layer — inactive layers
  // look clickable but aren't, so set them to default arrow cursor.
  rect.style.cursor = layerName === currentLayer ? "pointer" : "default";

  // Inactive layers get a CSS class that dims them to 45% opacity.
  // This class is temporarily removed during PNG export so all layers
  // appear at full brightness in the exported image.
  if (layerName !== currentLayer) group.classList.add("inactive-layer");

  // ── Highlight border rect ──────────────────────────────────
  // This is a second rect drawn on top of the background, invisible
  // by default, shown when the key is selected. Using a separate rect
  // (instead of changing the background rect's stroke) means the
  // highlight is always painted on top of everything else in the group.
  const highlightRect = document.createElementNS(SVG_NS, "rect");
  highlightRect.setAttribute("width", key.width);
  highlightRect.setAttribute("height", key.height);
  highlightRect.setAttribute("rx", 6);
  highlightRect.setAttribute("fill", "rgba(76,139,245,0.08)"); // very faint blue tint fill
  highlightRect.setAttribute("stroke", "#4c8bf5");             // bright blue border
  highlightRect.setAttribute("stroke-width", "3");
  highlightRect.setAttribute("pointer-events", "none"); // don't block clicks on the key
  highlightRect.style.display = "none"; // hidden until selected

  // ── Label text ────────────────────────────────────────────
  // This SVG <text> element shows the key's label (e.g. "A", "Ctrl").
  // It's hidden while the inline <input> editor is active.
  const text = document.createElementNS(SVG_NS, "text");
  text.setAttribute("x", key.width / 2);              // horizontally centred
  text.setAttribute("y", key.height / 2);             // vertically centred
  text.setAttribute("text-anchor", "middle");          // align centre on x
  text.setAttribute("dominant-baseline", "middle");    // align centre on y
  text.setAttribute("font-size", layer.fontSize);
  text.setAttribute("fill", layer.color || "#000000"); // text colour
  text.setAttribute("pointer-events", "none"); // clicks pass through to the rect below
  text.setAttribute("user-select", "none");    // can't accidentally highlight text
  text.textContent = layer.text;

  // ── Inline editor (foreignObject + input) ─────────────────
  // SVG doesn't have native text input. The workaround is to embed
  // an HTML <input> inside a <foreignObject> element, which lets you
  // place arbitrary HTML inside an SVG.
  // The foreignObject is hidden until the user double-clicks the key.
  const fo = document.createElementNS(SVG_NS, "foreignObject");
  fo.setAttribute("x", 4);                       // 4px inset from key edge
  fo.setAttribute("y", 4);
  fo.setAttribute("width",  key.width  - 8);     // 4px inset on each side
  fo.setAttribute("height", key.height - 8);
  fo.style.display  = "none";                    // hidden by default
  fo.style.overflow = "hidden";

  const input = document.createElement("input");  // regular HTML input
  input.type = "text";
  input.value = layer.text;
  // Style the input to be invisible (transparent background, no border)
  // so it looks like you're typing directly onto the key
  input.style.cssText = `
    width: 100%; height: 100%;
    background: transparent; border: none; outline: none;
    text-align: center; font-size: ${layer.fontSize}px;
    color: ${layer.color || "#000000"};
    font-family: inherit; padding: 0; box-sizing: border-box; cursor: text;
  `;
  fo.appendChild(input);

  // ── Append children in paint order ────────────────────────
  // SVG paints elements in document order (later = on top).
  // Order: background → label text → editor → highlight border
  // The highlight is last so it always appears above everything else.
  group.appendChild(rect);
  group.appendChild(text);
  group.appendChild(fo);
  group.appendChild(highlightRect); // must stay last — always on top

  // ── Click / double-click handlers (active layer only) ─────
  // We only make keys interactive on the current layer. Clicking
  // a key on an inactive layer would be confusing.
  if (layerName === currentLayer) {

    // Single click: select this key (or toggle it with Shift)
    group.addEventListener("click", (e) => {
      // If the inline editor is open, clicks inside it shouldn't
      // trigger selection changes — ignore them.
      if (fo.style.display !== "none") return;

      // stopPropagation prevents the click from bubbling up to the
      // SVG background handler that clears the selection.
      e.stopPropagation();

      if (e.shiftKey) {
        // Shift+click: toggle this key in/out of the selection
        if (selectedIds.has(key.id)) {
          selectedIds.delete(key.id);
          setKeyHighlight(group, false);
        } else {
          selectedIds.add(key.id);
          setKeyHighlight(group, true);
          bringToTop(group); // paint on top so highlight isn't covered
        }
      } else {
        // Plain click: clear all others and select just this key
        clearAllHighlights();
        selectedIds.clear();
        selectedIds.add(key.id);
        setKeyHighlight(group, true);
        bringToTop(group);
      }

      // Tell the panel to update (badge count, field values)
      updateSelectionPanel();
    });

    // Double-click: open the inline text editor for this key
    group.addEventListener("dblclick", (e) => {
      // Don't open the editor if multiple keys are selected —
      // typing the same label into 20 keys at once makes no sense
      if (selectedIds.size > 1) return;

      e.stopPropagation();

      // Make this the only selected key
      clearAllHighlights();
      selectedIds.clear();
      selectedIds.add(key.id);
      setKeyHighlight(group, true);
      bringToTop(group);
      updateSelectionPanel();

      enterEditMode();
    });
  }

  // ── enterEditMode ─────────────────────────────────────────
  // Hides the SVG text label and shows the HTML input instead,
  // then focuses it so the user can start typing immediately.
  function enterEditMode() {
    text.style.display = "none";  // hide the static label
    fo.style.display   = "block"; // show the editor

    // Sync the input's style with current layer settings
    // (in case font size or colour changed since last edit)
    input.style.fontSize = layer.fontSize + "px";
    input.style.color    = layer.color || "#000000";
    input.value          = layer.text;

    input.focus();
    input.select(); // select all existing text for easy replacement
  }

  // ── exitEditMode ──────────────────────────────────────────
  // Called when the input loses focus (blur), or on Enter/Escape.
  // Saves the typed value back to the layer data and restores
  // the SVG text label.
  function exitEditMode() {
    const newText  = input.value;
    layer.text     = newText;     // save to data model
    text.textContent = newText;   // update the SVG label

    // Also sync the panel's Key Label field if this key is still selected
    const keyTextEl = document.getElementById("keyText");
    if (keyTextEl && selectedIds.size === 1) keyTextEl.value = newText;

    fo.style.display   = "none"; // hide editor
    text.style.display = "";     // show label again
  }

  // Blur fires when the input loses focus (clicking away, tab, etc.)
  input.addEventListener("blur", exitEditMode);

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === "Escape") {
      input.blur(); // triggers exitEditMode via the blur event above
    }
    // Stop keystrokes from bubbling to window — otherwise pressing
    // Escape while typing would also deselect the key (our global
    // Escape handler in app.js would fire too)
    e.stopPropagation();
  });

  // Stop mousedown from bubbling to the SVG drag handler.
  // Without this, clicking inside the input would start a pan drag.
  input.addEventListener("mousedown", (e) => e.stopPropagation());

  // ── Attach refs to the group element ──────────────────────
  // Store references to internal elements on the group DOM node
  // using custom properties (prefixed with _). This lets other
  // functions (syncKeyVisual, etc.) update a specific key's visuals
  // without having to re-query the DOM or rebuild the whole keyboard.
  group._enterEditMode = enterEditMode;
  group._input         = input;
  group._fo            = fo;
  group._layer         = layer;       // live reference to the layer data object
  group._rect          = rect;
  group._highlightRect = highlightRect;

  viewportGroup.appendChild(group);
  return group;
}


// ── setupRubberBand ───────────────────────────────────────────
//
// Enables click+drag on the canvas background to draw a selection
// box. Any keys whose bounding boxes overlap the box get selected.
//
// Only keys on the current layer are selectable this way.
// Holding Shift while releasing adds to the existing selection
// instead of replacing it.
function setupRubberBand(svg, keys, currentLayer, allLayers, blockHeight) {
  // Store the SVG-space coordinate where the drag started
  let rbStartSVG = null;

  svg.addEventListener("mousedown", (e) => {
    // Don't start a rubber-band if clicking on an input or a key
    if (e.target.tagName === "INPUT") return;
    const clickedGroup = e.target.closest("g[data-key-id]");
    if (clickedGroup) return;

    isRubberBanding = true;
    // Convert mouse position from screen pixels to SVG canvas coordinates
    // (accounts for current pan and zoom)
    rbStartSVG = svgPoint(svg, e.clientX, e.clientY);

    // Create the visual selection rectangle
    rubberBand = document.createElementNS(SVG_NS, "rect");
    rubberBand.setAttribute("fill",             "rgba(76,139,245,0.12)"); // faint blue fill
    rubberBand.setAttribute("stroke",           "#4c8bf5");               // blue border
    rubberBand.setAttribute("stroke-width",     "1.5");
    rubberBand.setAttribute("stroke-dasharray", "5,3"); // dashed border
    rubberBand.setAttribute("pointer-events",   "none");
    rubberBand.setAttribute("rx",               "3");

    // Append to rubberGroup so it paints above all keys
    const rg = document.getElementById("rubberGroup");
    if (rg) rg.appendChild(rubberBand);
  });

  window.addEventListener("mousemove", (e) => {
    if (!isRubberBanding || !rubberBand || !rbStartSVG) return;

    // Update the rubber-band rectangle to follow the mouse.
    // We always set x/y to the top-left corner regardless of which
    // direction the user is dragging.
    const cur = svgPoint(svg, e.clientX, e.clientY);
    rubberBand.setAttribute("x",      Math.min(rbStartSVG.x, cur.x));
    rubberBand.setAttribute("y",      Math.min(rbStartSVG.y, cur.y));
    rubberBand.setAttribute("width",  Math.abs(cur.x - rbStartSVG.x));
    rubberBand.setAttribute("height", Math.abs(cur.y - rbStartSVG.y));
  });

  window.addEventListener("mouseup", (e) => {
    if (!isRubberBanding) return;
    isRubberBanding = false;

    if (!rubberBand || !rbStartSVG) return;

    // Final position of the selection box
    const cur  = svgPoint(svg, e.clientX, e.clientY);
    const selX = Math.min(rbStartSVG.x, cur.x);
    const selY = Math.min(rbStartSVG.y, cur.y);
    const selW = Math.abs(cur.x - rbStartSVG.x);
    const selH = Math.abs(cur.y - rbStartSVG.y);

    // Remove the visual rubber-band rect — it's done its job
    rubberBand.remove();
    rubberBand  = null;
    rbStartSVG  = null;

    // If the user barely moved the mouse it was probably a misclick,
    // not an intentional drag — ignore it
    if (selW < 4 && selH < 4) return;

    // Clear existing selection unless Shift is held
    if (!e.shiftKey) {
      clearAllHighlights();
      selectedIds.clear();
    }

    // Calculate the Y offset of the current layer's block on the canvas.
    // We only want to select keys that visually overlap the rubber-band
    // within the active layer block, not in other layer blocks.
    const layerIndex   = allLayers.indexOf(currentLayer);
    const layerOffsetY = layerIndex * (blockHeight + LAYER_GAP + LAYER_LABEL_HEIGHT) + LAYER_LABEL_HEIGHT;

    // Check each key to see if it overlaps the selection box
    keys.forEach(key => {
      // Key's top-left corner in SVG space (accounting for the layer's Y offset)
      const kx = key.x - key.width  / 2;
      const ky = (key.y - key.height / 2) + layerOffsetY;

      // Standard rectangle overlap test:
      // Two rectangles do NOT overlap if one is entirely to the left,
      // right, above, or below the other. We negate that to get "overlaps".
      const overlaps = !(
        kx + key.width  < selX ||  // key is entirely left of selection
        kx              > selX + selW || // key is entirely right
        ky + key.height < selY ||  // key is entirely above
        ky              > selY + selH   // key is entirely below
      );

      if (overlaps) {
        // Find the DOM group for this key on the current layer
        const group = document.querySelector(
          `#viewport g[data-key-id="${key.id}"][data-layer="${currentLayer}"]`
        );
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


// ── svgPoint ─────────────────────────────────────────────────
//
// Converts a screen-space mouse position (clientX/Y in pixels
// relative to the browser window) into SVG canvas coordinates
// (accounting for pan and zoom applied to the viewport group).
//
// We need this because after panning/zooming, a click at screen
// position (400, 300) might correspond to SVG position (200, 150).
function svgPoint(svg, clientX, clientY) {
  // createSVGPoint creates a coordinate object in SVG space
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;

  // getScreenCTM() returns the transformation matrix that maps
  // SVG coordinates to screen coordinates. .inverse() flips it,
  // so we can map screen → SVG instead.
  const screenCTM = viewportGroup.getScreenCTM();
  if (!screenCTM) return { x: clientX, y: clientY }; // fallback if transform unavailable

  return pt.matrixTransform(screenCTM.inverse());
}


// ── setKeyHighlight ───────────────────────────────────────────
//
// Shows or hides the blue highlight border on a key group.
// `on` is a boolean: true = selected, false = deselected.
function setKeyHighlight(group, on) {
  const hr = group._highlightRect;
  if (hr) hr.style.display = on ? "" : "none";
}


// ── clearAllHighlights ────────────────────────────────────────
//
// Removes the selection highlight from every key on the canvas,
// across all layers. Used before setting a new selection.
function clearAllHighlights() {
  document.querySelectorAll("#viewport g[data-key-id]").forEach(g => {
    setKeyHighlight(g, false);
  });
}


// ── bringToTop ────────────────────────────────────────────────
//
// Moves a key's group element to just before the rubber-band
// overlay group in the DOM. Since SVG paints in document order,
// this makes the key render on top of all its sibling keys —
// preventing the highlight border from being obscured by neighbours.
function bringToTop(group) {
  if (viewportGroup && group.parentNode === viewportGroup) {
    // Insert before rubberGroup so rubberGroup stays the very last
    // child (and thus always paints on top of everything)
    const rg = document.getElementById("rubberGroup");
    viewportGroup.insertBefore(group, rg);
  }
}


// ── clearSelection ────────────────────────────────────────────
//
// Public function called by app.js to deselect everything.
// Triggered by: clicking empty canvas, pressing Escape,
// or switching layers.
function clearSelection() {
  clearAllHighlights();
  selectedIds.clear();
  updateSelectionPanel();
}


// ── syncKeyVisual ─────────────────────────────────────────────
//
// After the panel's Apply button is clicked (in app.js), the key
// data has been updated but the DOM still shows the old values.
// This function finds every DOM group for the given key ID
// (one per layer) and updates the visuals to match the data.
//
// Note: we update all layer instances so that if you're viewing
// the base layer and edit a key's font size, the change is
// reflected in all layer blocks simultaneously.
function syncKeyVisual(keyId) {
  document.querySelectorAll(`#viewport g[data-key-id="${keyId}"]`).forEach(group => {
    const layer = group._layer; // live reference to the layer data object
    if (!layer) return;

    const rect  = group._rect;
    const text  = group.querySelector("text");
    const input = group._input;

    // Update background colour
    if (rect) rect.setAttribute("fill", layer.bg);

    // Update label text, size, and colour
    if (text) {
      text.textContent = layer.text;
      text.setAttribute("font-size", layer.fontSize);
      text.setAttribute("fill", layer.color || "#000000");
    }

    // Also update the hidden inline editor so it's in sync
    // if the user opens it next
    if (input) {
      input.value = layer.text;
      input.style.fontSize = layer.fontSize + "px";
      input.style.color    = layer.color || "#000000";
    }
  });
}


// ── updateSelectionPanel ──────────────────────────────────────
//
// Called after any selection change to:
//   1. Update the badge in the panel ("No selection" / "1 key" / "N keys")
//   2. Show/hide the Key Label field (hidden when multiple keys selected)
//   3. Fire a "selectionChanged" custom event that app.js listens to,
//      so app.js can sync the panel inputs with the selected key's values
function updateSelectionPanel() {
  const count = selectedIds.size;
  const badge        = document.getElementById("selectionBadge");
  const keyTextLabel = document.getElementById("keyTextLabel");

  if (badge) {
    if      (count === 0) { badge.textContent = "No selection";        badge.className = "badge badge-none";  }
    else if (count === 1) { badge.textContent = "1 key selected";      badge.className = "badge badge-one";   }
    else                  { badge.textContent = `${count} keys selected`; badge.className = "badge badge-multi"; }
  }

  // The Key Label field only makes sense for a single key.
  // When 5 keys are selected you can change their colour in bulk,
  // but typing the same label onto all of them is not useful.
  if (keyTextLabel) keyTextLabel.style.display = count > 1 ? "none" : "";

  // Fire a custom DOM event — app.js listens with addEventListener("selectionChanged")
  // and uses the ids array to populate the panel fields with the right values
  document.dispatchEvent(new CustomEvent("selectionChanged", {
    detail: { ids: [...selectedIds] } // spread Set into a plain array
  }));
}