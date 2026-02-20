async function parseDXFFile(file) {
  const text = await file.text();

  const parser = new window.DxfParser();
  const dxf = parser.parseSync(text);

  const lines = dxf.entities.filter(e => e.type === "LINE");

  console.log("DXF entities:", dxf.entities.length);
  console.log("LINE entities:", lines.length);

  const rectangles = [];

  for (let i = 0; i < lines.length; i += 4) {
    const group = lines.slice(i, i + 4);
    if (group.length < 4) continue;

    const rect = buildRectangle(group);
    if (!rect) continue;

    rectangles.push(rect);
  }

  console.log("Detected keys:", rectangles.length);

  const keys = rectangles.map(rect => ({
    id: crypto.randomUUID(),
    x: rect.cx,
    y: rect.cy,
    width: rect.width,
    height: rect.height,
    rotation: 0,
    layers: {
      base: {
        text: "",
        bg: "#ffffff",
        fontSize: 18
      }
    }
  }));

  return normalizeKeys(keys);
}

function getLinePoints(line) {
  // DXF parser variations
  if (line.start && line.end) {
    return [line.start, line.end];
  }

  if (line.vertices && line.vertices.length >= 2) {
    return [line.vertices[0], line.vertices[1]];
  }

  return null;
}

function buildRectangle(lines) {
  const points = [];

  for (const line of lines) {
    const pts = getLinePoints(line);
    if (!pts) continue;

    points.push(pts[0], pts[1]);
  }

  if (points.length < 4) return null;

  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);

  if (xs.includes(undefined) || ys.includes(undefined)) return null;

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const width = maxX - minX;
  const height = maxY - minY;

  // Key size filter (important)
  if (width < 10 || height < 10) return null;
  if (width > 40 || height > 40) return null;

  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    width,
    height
  };
}

function normalizeKeys(keys) {
  const minX = Math.min(...keys.map(k => k.x));
  const maxY = Math.max(...keys.map(k => k.y)); // important change

  const scale = 4;

  return keys.map(k => ({
    ...k,
    x: (k.x - minX) * scale + 50,

    // flip Y axis
    y: (maxY - k.y) * scale + 50,

    width: k.width * scale,
    height: k.height * scale
  }));
}