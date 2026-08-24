export interface BoundingBox {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

export interface RawDetection {
  categoryName: string;
  score: number;
  boundingBox: BoundingBox;
}

export interface TrackedDetection {
  trackId: number;
  categoryName: string;
  score: number;
  boundingBox: BoundingBox;
  isRefined: boolean;
  needsClassification: boolean;
}

export interface Track {
  id: number;
  bbox: BoundingBox;
  history: Array<{ category: string; score: number }>;
  framesSinceUpdate: number;
  totalHits: number;
  isConfirmed: boolean;
  refinedLabel: string | null;
  hasAttemptedClassification: boolean;
}

// Classes that commonly disguise unlisted furniture, accessories, or appliances
export const AMBIGUOUS_CLASSES = new Set([
  'refrigerator',
  'couch',
  'bed',
  'tv',
  'dining table',
  'book',
  'bottle',
  'cell phone',
  'remote',
  'microwave',
  'oven',
  'toaster',
  'sink',
  'suitcase',
  'handbag',
]);

const IOU_THRESHOLD = 0.30;
const EMA_ALPHA = 0.65; // Smoothing factor for bounding box coordinates
const MAX_HISTORY = 5;
const CONFIRMATION_THRESHOLD = 3; // Must appear in 3 of 5 frames
const MAX_MISSING_FRAMES = 5;

function computeIoU(a: BoundingBox, b: BoundingBox): number {
  const x1 = Math.max(a.originX, b.originX);
  const y1 = Math.max(a.originY, b.originY);
  const x2 = Math.min(a.originX + a.width, b.originX + b.width);
  const y2 = Math.min(a.originY + a.height, b.originY + b.height);

  const intersectionArea = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (intersectionArea <= 0) return 0;

  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  const unionArea = areaA + areaB - intersectionArea;

  return unionArea > 0 ? intersectionArea / unionArea : 0;
}

export class TemporalTracker {
  private nextTrackId = 1;
  private tracks: Track[] = [];

  update(rawDetections: RawDetection[]): TrackedDetection[] {
    const matchedTrackIndices = new Set<number>();
    const matchedDetectionIndices = new Set<number>();

    // 1. Match raw detections to existing tracks via IoU
    for (let d = 0; d < rawDetections.length; d++) {
      const det = rawDetections[d];
      let bestIoU = IOU_THRESHOLD;
      let bestTrackIdx = -1;

      for (let t = 0; t < this.tracks.length; t++) {
        if (matchedTrackIndices.has(t)) continue;

        const iou = computeIoU(det.boundingBox, this.tracks[t].bbox);
        if (iou > bestIoU) {
          bestIoU = iou;
          bestTrackIdx = t;
        }
      }

      if (bestTrackIdx !== -1) {
        matchedTrackIndices.add(bestTrackIdx);
        matchedDetectionIndices.add(d);

        // Update matched track
        const track = this.tracks[bestTrackIdx];
        track.framesSinceUpdate = 0;
        track.totalHits += 1;

        // Smooth bounding box via Exponential Moving Average (EMA)
        track.bbox = {
          originX: EMA_ALPHA * det.boundingBox.originX + (1 - EMA_ALPHA) * track.bbox.originX,
          originY: EMA_ALPHA * det.boundingBox.originY + (1 - EMA_ALPHA) * track.bbox.originY,
          width: EMA_ALPHA * det.boundingBox.width + (1 - EMA_ALPHA) * track.bbox.width,
          height: EMA_ALPHA * det.boundingBox.height + (1 - EMA_ALPHA) * track.bbox.height,
        };

        track.history.push({ category: det.categoryName, score: det.score });
        if (track.history.length > MAX_HISTORY) {
          track.history.shift();
        }

        if (track.history.length >= CONFIRMATION_THRESHOLD && !track.isConfirmed) {
          track.isConfirmed = true;
        }
      }
    }

    // 2. Spawn new tracks for unmatched detections
    for (let d = 0; d < rawDetections.length; d++) {
      if (matchedDetectionIndices.has(d)) continue;

      const det = rawDetections[d];
      this.tracks.push({
        id: this.nextTrackId++,
        bbox: { ...det.boundingBox },
        history: [{ category: det.categoryName, score: det.score }],
        framesSinceUpdate: 0,
        totalHits: 1,
        isConfirmed: false,
        refinedLabel: null,
        hasAttemptedClassification: false,
      });
    }

    // 3. Age unmatched tracks and remove stale ones
    for (let t = this.tracks.length - 1; t >= 0; t--) {
      if (!matchedTrackIndices.has(t)) {
        this.tracks[t].framesSinceUpdate += 1;
        if (this.tracks[t].framesSinceUpdate > MAX_MISSING_FRAMES) {
          this.tracks.splice(t, 1);
        }
      }
    }

    // 4. Extract confirmed, stable detections with majority voting
    const output: TrackedDetection[] = [];

    for (const track of this.tracks) {
      // Only emit tracks that have been updated recently and are confirmed
      if (track.framesSinceUpdate > 1 || !track.isConfirmed) continue;

      // Majority voting on category name
      const categoryCounts = new Map<string, { count: number; totalScore: number; maxScore: number }>();
      for (const h of track.history) {
        const entry = categoryCounts.get(h.category) || { count: 0, totalScore: 0, maxScore: 0 };
        entry.count += 1;
        entry.totalScore += h.score;
        entry.maxScore = Math.max(entry.maxScore, h.score);
        categoryCounts.set(h.category, entry);
      }

      let majorityCategory = track.history[track.history.length - 1].category;
      let maxCount = 0;
      let representativeScore = 0;

      for (const [cat, data] of categoryCounts.entries()) {
        if (data.count > maxCount) {
          maxCount = data.count;
          majorityCategory = cat;
          representativeScore = data.maxScore;
        }
      }

      // Check if this track needs second-stage 1-time classification
      const isAmbiguous = AMBIGUOUS_CLASSES.has(majorityCategory.toLowerCase());
      const needsClassification =
        track.isConfirmed &&
        !track.hasAttemptedClassification &&
        !track.refinedLabel &&
        isAmbiguous;

      const finalLabel = track.refinedLabel || majorityCategory;

      output.push({
        trackId: track.id,
        categoryName: finalLabel,
        score: representativeScore,
        boundingBox: { ...track.bbox },
        isRefined: Boolean(track.refinedLabel),
        needsClassification,
      });
    }

    return output;
  }

  setRefinedLabel(trackId: number, refinedLabel: string): void {
    const track = this.tracks.find((t) => t.id === trackId);
    if (track) {
      track.refinedLabel = refinedLabel;
      track.hasAttemptedClassification = true;
    }
  }

  markClassificationAttempted(trackId: number): void {
    const track = this.tracks.find((t) => t.id === trackId);
    if (track) {
      track.hasAttemptedClassification = true;
    }
  }

  reset(): void {
    this.tracks = [];
    this.nextTrackId = 1;
  }
}
