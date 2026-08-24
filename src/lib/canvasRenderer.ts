import type { TrackedDetection } from '@/lib/temporalTracker';

// ─── Color palette for different object classes ───
const CLASS_COLORS: Record<string, string> = {
  person: 'oklch(0.72 0.19 30)',    // coral
  chair: 'oklch(0.75 0.16 200)',    // cyan
  cup: 'oklch(0.78 0.18 155)',      // green
  laptop: 'oklch(0.70 0.18 300)',   // purple
  bottle: 'oklch(0.78 0.16 80)',    // amber
  perfume: 'oklch(0.80 0.17 90)',   // gold
  phone: 'oklch(0.68 0.20 340)',    // pink
  'cell phone': 'oklch(0.68 0.20 340)',
  book: 'oklch(0.72 0.15 230)',     // blue
  tv: 'oklch(0.75 0.14 150)',       // teal
  keyboard: 'oklch(0.65 0.16 280)', // indigo
  mouse: 'oklch(0.70 0.14 50)',     // orange
  wardrobe: 'oklch(0.75 0.15 130)', // emerald
  closet: 'oklch(0.75 0.15 130)',
  cabinet: 'oklch(0.73 0.14 160)',
  refrigerator: 'oklch(0.70 0.12 210)',
  couch: 'oklch(0.68 0.16 270)',
  desk: 'oklch(0.72 0.14 60)',
};

const DEFAULT_COLOR = 'oklch(0.78 0.15 200)'; // cyan fallback

function getClassColor(className: string): string {
  const normalized = className.toLowerCase().trim();
  for (const [key, color] of Object.entries(CLASS_COLORS)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return color;
    }
  }
  return DEFAULT_COLOR;
}

/**
 * Draw smoothed detection bounding boxes on the canvas.
 *
 * @param ctx - The 2D canvas rendering context (already DPR-scaled)
 * @param detections - Array of stabilized detections from the temporal tracker
 * @param videoWidth - The video element width in CSS pixels
 * @param videoHeight - The video element height in CSS pixels
 * @param nativeWidth - The native video stream width
 * @param nativeHeight - The native video stream height
 */
export function drawDetections(
  ctx: CanvasRenderingContext2D,
  detections: TrackedDetection[],
  videoWidth: number,
  videoHeight: number,
  nativeWidth: number,
  nativeHeight: number,
): void {
  // Clear canvas to eliminate ghosting
  ctx.clearRect(0, 0, videoWidth, videoHeight);

  if (detections.length === 0) return;

  const scaleX = videoWidth / nativeWidth;
  const scaleY = videoHeight / nativeHeight;

  for (const detection of detections) {
    const { boundingBox, categoryName, score, isRefined } = detection;
    const color = getClassColor(categoryName);

    // Map native stream coordinates to current canvas display dimensions
    const x = boundingBox.originX * scaleX;
    const y = boundingBox.originY * scaleY;
    const w = boundingBox.width * scaleX;
    const h = boundingBox.height * scaleY;

    const radius = 6;

    // ─── Semi-transparent Fill ───
    ctx.fillStyle = color.replace(')', ' / 0.09)');
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.fill();

    // ─── Main Border ───
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.stroke();

    // ─── Corner Accents ───
    const accentLen = Math.min(22, w * 0.25, h * 0.25);
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

    // ─── Label Badge ───
    const confidenceText = score > 0 ? ` ${Math.round(score * 100)}%` : '';
    const label = `${categoryName.toUpperCase()}${confidenceText}${isRefined ? ' ✨' : ''}`;

    ctx.font = '600 12px system-ui, -apple-system, sans-serif';
    const textMetrics = ctx.measureText(label);
    const labelPadX = 8;
    const labelH = 22;
    const labelW = textMetrics.width + labelPadX * 2;
    const labelX = x;
    const labelY = y - labelH - 4;

    const actualLabelY = labelY < 0 ? y + 4 : labelY;

    // Label background pill
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(labelX, actualLabelY, labelW, labelH, [4, 4, 4, 4]);
    ctx.fill();

    // Label text
    ctx.fillStyle = 'oklch(0.13 0.02 260)';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, labelX + labelPadX, actualLabelY + labelH / 2 + 1);
  }
}
