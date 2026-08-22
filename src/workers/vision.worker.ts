/// <reference lib="webworker" />

import {
  ObjectDetector,
  FilesetResolver,
} from '@mediapipe/tasks-vision';

// ─── Types ───
interface DetectMessage {
  type: 'detect';
  frame: ImageBitmap;
  timestamp: number;
}

interface InitMessage {
  type: 'init';
}

interface CloseMessage {
  type: 'close';
}

type WorkerMessage = DetectMessage | InitMessage | CloseMessage;

export interface Detection {
  categoryName: string;
  score: number;
  boundingBox: {
    originX: number;
    originY: number;
    width: number;
    height: number;
  };
}

export interface DetectionResult {
  type: 'detections';
  detections: Detection[];
  inferenceTimeMs: number;
}

export interface StatusMessage {
  type: 'status';
  status: 'initializing' | 'ready' | 'error';
  message?: string;
}

// ─── State ───
let detector: ObjectDetector | null = null;

// ─── Initialize the detector ───
async function initializeDetector(): Promise<void> {
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
      message: 'Loading detection model...',
    } satisfies StatusMessage);

    detector = await ObjectDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: '/models/efficientdet_lite0.tflite',
      },
      runningMode: 'VIDEO',
      scoreThreshold: 0.55,
      maxResults: 10,
    });

    self.postMessage({
      type: 'status',
      status: 'ready',
      message: 'Object detector ready',
    } satisfies StatusMessage);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    self.postMessage({
      type: 'status',
      status: 'error',
      message: `Failed to initialize detector: ${msg}`,
    } satisfies StatusMessage);
  }
}

// ─── Run detection on a frame ───
function detectFrame(frame: ImageBitmap, timestamp: number): void {
  if (!detector) {
    // Close the bitmap to prevent leaks even when detector isn't ready
    frame.close();
    // CRITICAL: Must still respond to release the main thread's frame-lock!
    self.postMessage({
      type: 'detections',
      detections: [],
      inferenceTimeMs: 0,
    } satisfies DetectionResult);
    return;
  }

  const startTime = performance.now();

  try {
    const result = detector.detectForVideo(frame, timestamp);

    const detections: Detection[] = (result.detections ?? []).map((d) => {
      const bbox = d.boundingBox!;
      const category = d.categories?.[0];
      return {
        categoryName: category?.categoryName ?? 'unknown',
        score: category?.score ?? 0,
        boundingBox: {
          originX: bbox.originX,
          originY: bbox.originY,
          width: bbox.width,
          height: bbox.height,
        },
      };
    });

    const inferenceTimeMs = performance.now() - startTime;

    self.postMessage({
      type: 'detections',
      detections,
      inferenceTimeMs,
    } satisfies DetectionResult);
  } catch (error) {
    console.error('[vision.worker] Detection error:', error);
    // CRITICAL: Must still respond to release the main thread's frame-lock!
    self.postMessage({
      type: 'detections',
      detections: [],
      inferenceTimeMs: 0,
    } satisfies DetectionResult);
  } finally {
    // CRITICAL: Always close the bitmap to free memory in the worker
    frame.close();
  }
}

// ─── Message Handler ───
self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { data } = event;

  switch (data.type) {
    case 'init':
      initializeDetector();
      break;

    case 'detect':
      detectFrame(data.frame, data.timestamp);
      break;

    case 'close':
      // CRITICAL: Release the WASM heap and model memory
      if (detector) {
        detector.close();
        detector = null;
      }
      break;
  }
};

// Auto-initialize on worker creation
initializeDetector();
