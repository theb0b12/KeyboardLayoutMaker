// ============================================================
// parser.js
//
// Responsible for reading a .dxf file and converting it into
// an array of "key" objects that the rest of the app can use.
//
// A DXF file is a CAD format. For keyboard layouts, each key
// is drawn as a rectangle made of 4 LINE entities. This parser
// groups those lines, reconstructs the rectangles, and spits
// out normalised key data ready for rendering.
// ============================================================


// parseDXFFile(file)
// ------------------
// Entry point. Takes a File object (from a file input), reads
// it as text, runs it through the DxfParser library, then
// extracts and returns an array of key objects.
async function parseDXFFile(file) {
  // Read the raw text content of the uploaded file
  const text = await file.text();

  // DxfParser is loaded via <script> in index.html from unpkg CDN.
  // parseSync() turns the raw DXF text into a JavaScript object
  // with an `entities` array containing every drawn shape.
  const parser = new window.DxfParser();
  const dxf = parser.parseSync(text);

  // We only care about LINE entities — each key rectangle is
  // made of exactly 4 lines (one per side).
  const lines = dxf.entities.filter(e => e.type === "LINE");

  console.log("DXF entities:", dxf.entities.length);
  console.log("LINE entities:", lines.length);

  const rectangles = [];

  // Step through lines 4 at a time, treating each group of 4 as
  // one rectangle (one key). This assumes the DXF was exported
  // with keys drawn as 4 separate LINE segments in order.
  for (let i = 0; i < lines.length; i += 4) {
    const group = lines.slice(i, i + 4);

    // Skip incomplete groups at the end of the array
    if (group.length < 4) continue;

    const rect = buildRectangle(group);

    // buildRectangle returns null if the shape doesn't look like
    // a valid key (too small, too big, or malformed)
    if (!rect) continue;

    rectangles.push(rect);
  }

  console.log("Detected keys:", rectangles.length);

  // Convert each raw rectangle into a full key object.
  // Each key starts with a single "base" layer with blank text
  // and a white background. More layers can be added in the app.
  const keys = rectangles.map(rect => ({
    id: crypto.randomUUID(),   // unique ID used throughout the app to identify this key
    x: rect.cx,                // centre X in DXF coordinate space (normalised later)
    y: rect.cy,                // centre Y in DXF coordinate space (normalised later)
    width: rect.width,
    height: rect.height,
    rotation: 0,               // reserved for future rotated key support
    layers: {
      base: {
        text: "",              // what label is printed on the key
        bg: "#ffffff",         // background fill colour
        fontSize: 18           // label font size in px
        // note: `color` (text colour) defaults to "#000000" when not set
      }
    }
  }));

  // Shift and scale all key positions so they sit nicely in the
  // top-left of the canvas rather than at arbitrary DXF coordinates
  return normalizeKeys(keys);
}


// getLinePoints(line)
// -------------------
// Extracts the two endpoint objects {x, y} from a DXF LINE entity.
// The DxfParser library can represent endpoints in two different
// shapes depending on the DXF version, so we handle both.
function getLinePoints(line) {
  // Most common format: line.start and line.end objects
  if (line.start && line.end) {
    return [line.start, line.end];
  }

  // Older format: line.vertices array
  if (line.vertices && line.vertices.length >= 2) {
    return [line.vertices[0], line.vertices[1]];
  }

  // Unknown format — skip this line
  return null;
}


// buildRectangle(lines)
// ---------------------
// Takes an array of 4 LINE entities and tries to reconstruct the
// bounding box of the rectangle they form.
//
// Strategy: collect all 8 endpoint coordinates (4 lines × 2 points),
// then take the min/max X and Y to get the bounding box.
// This works even if the lines are in arbitrary order.
function buildRectangle(lines) {
  const points = [];

  for (const line of lines) {
    const pts = getLinePoints(line);
    if (!pts) continue;

    // Each line gives us 2 points; push both
    points.push(pts[0], pts[1]);
  }

  // Need at least 4 distinct points to form a rectangle
  if (points.length < 4) return null;

  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);

  // If any coordinate is undefined the DXF data is corrupt, skip it
  if (xs.includes(undefined) || ys.includes(undefined)) return null;

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const width  = maxX - minX;
  const height = maxY - minY;

  // ⚠️ IMPORTANT: These size limits filter out noise.
  // If a key is smaller than 10 or larger than 40 DXF units it's
  // probably a stray line or a border/frame, not a key. Adjust
  // these numbers if your DXF uses a different scale.
  if (width  < 10 || height < 10) return null;
  if (width  > 40 || height > 40) return null;

  // Return centre point and dimensions
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    width,
    height
  };
}


// normalizeKeys(keys)
// -------------------
// DXF coordinates can start anywhere and use any unit scale.
// This function:
//   1. Shifts all keys so the leftmost key starts at x=50
//   2. Flips the Y axis (DXF Y goes up; SVG Y goes down)
//   3. Scales everything up by 4× so it looks reasonable on screen
function normalizeKeys(keys) {
  // Find the leftmost and topmost key positions
  const minX = Math.min(...keys.map(k => k.x));
  const maxY = Math.max(...keys.map(k => k.y)); // used for Y-flip

  // Scale factor: multiply all DXF units by this to get SVG pixels.
  // Increase this number to make the keyboard appear larger.
  const scale = 4;

  return keys.map(k => ({
    ...k,  // copy all existing properties (id, layers, etc.)

    // Shift so minX becomes 0, then add 50px left margin
    x: (k.x - minX) * scale + 50,

    // Flip Y: DXF origin is bottom-left, SVG origin is top-left.
    // (maxY - k.y) inverts the axis so keys appear right-side up.
    y: (maxY - k.y) * scale + 50,

    // Scale width and height too
    width:  k.width  * scale,
    height: k.height * scale
  }));
}