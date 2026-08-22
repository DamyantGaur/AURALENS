import type { Detection } from '@/workers/vision.worker';

// ─── Color palette for different object classes ───
const CLASS_COLORS: Record<string, string> = {
  person: 'oklch(0.72 0.19 30)',    // coral
  chair: 'oklch(0.75 0.16 200)',    // cyan
  cup: 'oklch(0.78 0.18 155)',      // green
  laptop: 'oklch(0.70 0.18 300)',   // purple
  bottle: 'oklch(0.78 0.16 80)',    // amber
  phone: 'oklch(0.68 0.20 340)',    // pink
  book: 'oklch(0.72 0.15 230)',     // blue
  tv: 'oklch(0.75 0.14 150)',       // teal
  keyboard: 'oklch(0.65 0.16 280)', // indigo
  mouse: 'oklch(0.70 0.14 50)',     // orange
};

const DEFAULT_COLOR = 'oklch(0.78 0.15 200)'; // cyan fallback

function getClassColor(className: string): string {
  return CLASS_COLORS[className.toLowerCase()] ?? DEFAULT_COLOR;
}

/**
 * Draw detection bounding boxes on the canvas.
 *
 * @param ctx - The 2D canvas rendering context (already DPR-scaled)
 * @param detections - Array of detection results from the worker
 * @param videoWidth - The actual video element width in CSS pixels
 * @param videoHeight - The actual video element height in CSS pixels
 * @param sourceWidth - The width of the frame that was sent to the detector (e.g., 320)
 * @param sourceHeight - The height of the frame that was sent to the detector
 */
export function drawDetections(
  ctx: CanvasRenderingContext2D,
  detections: Detection[],
  videoWidth: number,
  videoHeight: number,
  sourceWidth: number,
  sourceHeight: number,
): void {
  // CRITICAL: Clear the entire canvas to prevent ghosting from prior frames
  ctx.clearRect(0, 0, videoWidth, videoHeight);

  if (detections.length === 0) return;

  // Scale factor: detection coordinates are relative to the downscaled frame (e.g., 320px)
  // but we draw on the full-resolution canvas
  const scaleX = videoWidth / sourceWidth;
  const scaleY = videoHeight / sourceHeight;

  for (const detection of detections) {
    const { boundingBox, categoryName, score } = detection;
    const color = getClassColor(categoryName);

    // Scale bounding box from detection coordinates to canvas coordinates
    const x = boundingBox.originX * scaleX;
    const y = boundingBox.originY * scaleY;
    const w = boundingBox.width * scaleX;
    const h = boundingBox.height * scaleY;

    const radius = 6;

    // ─── Semi-transparent fill ───
    ctx.fillStyle = color.replace(')', ' / 0.08)').replace('oklch(', 'oklch(');
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.fill();

    // ─── Border ───
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.stroke();

    // ─── Corner accents (thicker, shorter lines at corners) ───
    const accentLen = Math.min(20, w * 0.25, h * 0.25);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';

    // Top-left
    ctx.beginPath();
    ctx.moveTo(x + accentLen, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + accentLen);
    ctx.stroke();

    // Top-right
    ctx.beginPath();
    ctx.moveTo(x + w - accentLen, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + accentLen);
    ctx.stroke();

    // Bottom-left
    ctx.beginPath();
    ctx.moveTo(x, y + h - accentLen);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x + accentLen, y + h);
    ctx.stroke();

    // Bottom-right
    ctx.beginPath();
    ctx.moveTo(x + w, y + h - accentLen);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + w - accentLen, y + h);
    ctx.stroke();

    // ─── Label background ───
    const label = `${categoryName} ${Math.round(score * 100)}%`;
    ctx.font = '600 12px system-ui, -apple-system, sans-serif';
    const textMetrics = ctx.measureText(label);
    const labelPadX = 8;
    const labelPadY = 4;
    const labelH = 22;
    const labelW = textMetrics.width + labelPadX * 2;
    const labelX = x;
    const labelY = y - labelH - 4;

    // Only draw label above box if there's room, otherwise inside
    const actualLabelY = labelY < 0 ? y + 4 : labelY;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(labelX, actualLabelY, labelW, labelH, [4, 4, 4, 4]);
    ctx.fill();

    // ─── Label text ───
    ctx.fillStyle = 'oklch(0.13 0.02 260)';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, labelX + labelPadX, actualLabelY + labelH / 2 + 1);
  }
}
