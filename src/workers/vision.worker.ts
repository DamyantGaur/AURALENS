/// <reference lib="webworker" />

import {
  ObjectDetector,
  ImageClassifier,
  FilesetResolver,
} from '@mediapipe/tasks-vision';
import { TemporalTracker, type RawDetection, type TrackedDetection } from '@/lib/temporalTracker';

// ─── Message Types ───
export interface DetectMessage {
  type: 'detect';
  frame: ImageBitmap;
  timestamp: number;
  videoWidth: number;
  videoHeight: number;
  padX: number;
  padY: number;
  scale: number;
  squareSize: number;
}

export interface InitMessage {
  type: 'init';
}

export interface CloseMessage {
  type: 'close';
}

type WorkerMessage = DetectMessage | InitMessage | CloseMessage;

export interface DetectionResult {
  type: 'detections';
  detections: TrackedDetection[];
  inferenceTimeMs: number;
}

export interface StatusMessage {
  type: 'status';
  status: 'initializing' | 'ready' | 'error';
  message?: string;
}

// ─── State ───
let detector: ObjectDetector | null = null;
let classifier: ImageClassifier | null = null;
const tracker = new TemporalTracker();

// Singleton OffscreenCanvas for zero-allocation subregion cropping
const CROP_SIZE = 224;
let cropCanvas: OffscreenCanvas | null = null;
let cropCtx: OffscreenCanvasRenderingContext2D | null = null;

function getCropContext(): OffscreenCanvasRenderingContext2D | null {
  if (!cropCanvas) {
    cropCanvas = new OffscreenCanvas(CROP_SIZE, CROP_SIZE);
    cropCtx = cropCanvas.getContext('2d', { willReadFrequently: true });
  }
  return cropCtx;
}

// Clean up ImageNet synset names (e.g. "wardrobe, closet, press" -> "wardrobe")
function cleanClassifierLabel(rawLabel: string): string {
  const primaryName = rawLabel.split(',')[0].trim().toLowerCase();
  return primaryName;
}

// ─── Initialize MediaPipe Models ───
async function initializeModels(): Promise<void> {
  self.postMessage({
    type: 'status',
    status: 'initializing',
    message: 'Loading WASM runtime...',
  } satisfies StatusMessage);

  try {
    const vision = await FilesetResolver.forVisionTasks('/wasm');

    self.postMessage({
      type: 'status',
      status: 'initializing',
      message: 'Loading EfficientDet-Lite2 detector...',
    } satisfies StatusMessage);

    // 1. Initialize ObjectDetector (EfficientDet-Lite2) with lowered proposal threshold
    detector = await ObjectDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: '/models/efficientdet_lite2.tflite',
      },
      runningMode: 'VIDEO',
      scoreThreshold: 0.25, // Lowered proposal threshold to catch ambiguous furniture/items
      maxResults: 10,
    });

    self.postMessage({
      type: 'status',
      status: 'initializing',
      message: 'Loading ImageClassifier...',
    } satisfies StatusMessage);

    // 2. Initialize ImageClassifier (EfficientNet-Lite0) for 1000-class refinement
    try {
      classifier = await ImageClassifier.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: '/models/efficientnet_lite0.tflite',
        },
        runningMode: 'IMAGE',
        maxResults: 3,
        scoreThreshold: 0.15,
      });
    } catch (clfErr) {
      console.warn('[vision.worker] Classifier load fallback (detector will run standalone):', clfErr);
    }

    self.postMessage({
      type: 'status',
      status: 'ready',
      message: 'AI Vision Engine Active',
    } satisfies StatusMessage);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    self.postMessage({
      type: 'status',
      status: 'error',
      message: `Detector initialization failed: ${msg}`,
    } satisfies StatusMessage);
  }
}

// ─── Frame Detection Pipeline ───
function detectFrame(
  frame: ImageBitmap,
  timestamp: number,
  videoWidth: number,
  videoHeight: number,
  padX: number,
  padY: number,
  scale: number,
  squareSize: number
): void {
  if (!detector) {
    frame.close();
    self.postMessage({
      type: 'detections',
      detections: [],
      inferenceTimeMs: 0,
    } satisfies DetectionResult);
    return;
  }

  const startTime = performance.now();

  try {
    // 1. Run detection on the letterboxed square frame
    const result = detector.detectForVideo(frame, timestamp);

    // 2. Map coordinates from padded square [0, squareSize] back to native video [0, W_v], [0, H_v]
    const rawDetections: RawDetection[] = [];

    for (const d of result.detections ?? []) {
      const bbox = d.boundingBox;
      if (!bbox) continue;

      const category = d.categories?.[0];
      const categoryName = category?.categoryName ?? 'unknown';
      const score = category?.score ?? 0;

      // Check if coordinates are normalized (0..1) or absolute pixels (0..squareSize)
      const isNormalized = bbox.width <= 1.0 && bbox.height <= 1.0 && bbox.originX <= 1.0;
      const xPixel = isNormalized ? bbox.originX * squareSize : bbox.originX;
      const yPixel = isNormalized ? bbox.originY * squareSize : bbox.originY;
      const wPixel = isNormalized ? bbox.width * squareSize : bbox.width;
      const hPixel = isNormalized ? bbox.height * squareSize : bbox.height;

      // Inverse letterbox transformation
      const nativeX = Math.max(0, (xPixel - padX) / scale);
      const nativeY = Math.max(0, (yPixel - padY) / scale);
      const nativeW = Math.min(videoWidth - nativeX, wPixel / scale);
      const nativeH = Math.min(videoHeight - nativeY, hPixel / scale);

      if (nativeW > 10 && nativeH > 10) {
        rawDetections.push({
          categoryName,
          score,
          boundingBox: {
            originX: nativeX,
            originY: nativeY,
            width: nativeW,
            height: nativeH,
          },
        });
      }
    }

    // 3. Update temporal tracker (IoU matching, majority voting, coordinate smoothing)
    const trackedDetections = tracker.update(rawDetections);

    // 4. Track-based 1-time second-stage classification
    if (classifier) {
      const ctx = getCropContext();

      for (const track of trackedDetections) {
        if (track.needsClassification && ctx && cropCanvas) {
          try {
            // Map native video box back to letterbox bitmap coordinates for clean cropping
            const cropX = Math.max(0, Math.min(squareSize - 1, track.boundingBox.originX * scale + padX));
            const cropY = Math.max(0, Math.min(squareSize - 1, track.boundingBox.originY * scale + padY));
            const cropW = Math.max(1, Math.min(squareSize - cropX, track.boundingBox.width * scale));
            const cropH = Math.max(1, Math.min(squareSize - cropY, track.boundingBox.height * scale));

            ctx.clearRect(0, 0, CROP_SIZE, CROP_SIZE);
            ctx.drawImage(frame, cropX, cropY, cropW, cropH, 0, 0, CROP_SIZE, CROP_SIZE);

            const croppedBitmap = cropCanvas.transferToImageBitmap();
            const clfResult = classifier.classify(croppedBitmap);
            croppedBitmap.close(); // Zero-leak disposal

            const topCategory = clfResult.classifications?.[0]?.categories?.[0];
            if (topCategory && topCategory.score > 0.20) {
              const refinedName = cleanClassifierLabel(topCategory.categoryName);
              tracker.setRefinedLabel(track.trackId, refinedName);
              track.categoryName = refinedName;
              track.isRefined = true;
            } else {
              tracker.markClassificationAttempted(track.trackId);
            }
          } catch (clfErr) {
            console.error('[vision.worker] Refinement error:', clfErr);
            tracker.markClassificationAttempted(track.trackId);
          }
        }
      }
    }

    const inferenceTimeMs = performance.now() - startTime;

    self.postMessage({
      type: 'detections',
      detections: trackedDetections,
      inferenceTimeMs,
    } satisfies DetectionResult);
  } catch (error) {
    console.error('[vision.worker] Pipeline error:', error);
    self.postMessage({
      type: 'detections',
      detections: [],
      inferenceTimeMs: 0,
    } satisfies DetectionResult);
  } finally {
    // CRITICAL: Synchronously close the frame bitmap immediately
    frame.close();
  }
}

// ─── Message Dispatcher ───
self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { data } = event;

  switch (data.type) {
    case 'init':
      initializeModels();
      break;

    case 'detect':
      detectFrame(
        data.frame,
        data.timestamp,
        data.videoWidth,
        data.videoHeight,
        data.padX,
        data.padY,
        data.scale,
        data.squareSize
      );
      break;

    case 'close':
      if (detector) {
        detector.close();
        detector = null;
      }
      if (classifier) {
        classifier.close();
        classifier = null;
      }
      tracker.reset();
      cropCanvas = null;
      cropCtx = null;
      break;
  }
};

// Start initialization immediately
initializeModels();
