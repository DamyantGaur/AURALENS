'use client';

import { useEffect, useRef, useState } from 'react';
import type { TrackedDetection } from '@/lib/temporalTracker';
import type { DetectionResult, StatusMessage, DetectMessage } from '@/workers/vision.worker';

// ─── Types ───
export type ModelStatus = 'idle' | 'initializing' | 'ready' | 'error';

export interface UseDetectionLoopOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isReady: boolean;
  enabled: boolean;
  onDetections: (detections: TrackedDetection[], nativeWidth: number, nativeHeight: number) => void;
}

export interface UseDetectionLoopReturn {
  modelStatus: ModelStatus;
  modelMessage: string;
  fps: number;
  inferenceTimeMs: number;
}

const SQUARE_TARGET_SIZE = 512;

export function useDetectionLoop({
  videoRef,
  isReady,
  enabled,
  onDetections,
}: UseDetectionLoopOptions): UseDetectionLoopReturn {
  const workerRef = useRef<Worker | null>(null);
  const rafIdRef = useRef<number>(0);
  const isProcessingRef = useRef(false);
  const onDetectionsRef = useRef(onDetections);

  const [modelStatus, setModelStatus] = useState<ModelStatus>('idle');
  const [modelMessage, setModelMessage] = useState('');
  const [fps, setFps] = useState(0);
  const [inferenceTimeMs, setInferenceTimeMs] = useState(0);

  // Keep callback ref fresh without re-triggering effects
  useEffect(() => {
    onDetectionsRef.current = onDetections;
  }, [onDetections]);

  useEffect(() => {
    if (!isReady || !enabled) return;

    // ─── Create the Web Worker ───
    const worker = new Worker(
      new URL('../workers/vision.worker.ts', import.meta.url),
      { type: 'module' }
    );
    workerRef.current = worker;

    // ─── Reusable OffscreenCanvas for letterboxing ───
    let letterboxCanvas: OffscreenCanvas | null = null;
    let letterboxCtx: OffscreenCanvasRenderingContext2D | null = null;

    try {
      letterboxCanvas = new OffscreenCanvas(SQUARE_TARGET_SIZE, SQUARE_TARGET_SIZE);
      letterboxCtx = letterboxCanvas.getContext('2d', { willReadFrequently: true });
    } catch {
      // Fallback if OffscreenCanvas is unavailable
    }

    // ─── FPS tracking ───
    let frameCount = 0;
    let lastFpsTime = performance.now();

    // ─── Handle messages from the worker ───
    worker.onmessage = (event: MessageEvent<DetectionResult | StatusMessage>) => {
      const { data } = event;

      if (data.type === 'status') {
        const statusMsg = data as StatusMessage;
        switch (statusMsg.status) {
          case 'initializing':
            setModelStatus('initializing');
            setModelMessage(statusMsg.message ?? 'Initializing...');
            break;
          case 'ready':
            setModelStatus('ready');
            setModelMessage(statusMsg.message ?? 'Ready');
            break;
          case 'error':
            setModelStatus('error');
            setModelMessage(statusMsg.message ?? 'Error');
            break;
        }
      } else if (data.type === 'detections') {
        const result = data as DetectionResult;

        setInferenceTimeMs(Math.round(result.inferenceTimeMs));

        frameCount++;
        const now = performance.now();
        if (now - lastFpsTime >= 1000) {
          setFps(frameCount);
          frameCount = 0;
          lastFpsTime = now;
        }

        const video = videoRef.current;
        const nativeW = video?.videoWidth || 640;
        const nativeH = video?.videoHeight || 480;

        // Forward stabilized detections directly in native video resolution
        onDetectionsRef.current(result.detections, nativeW, nativeH);

        // Release the frame-lock
        isProcessingRef.current = false;
      }
    };

    worker.onerror = (error) => {
      console.error('[useDetectionLoop] Worker error:', error);
      setModelStatus('error');
      setModelMessage(`Worker error: ${error.message}`);
      isProcessingRef.current = false;
    };

    // ─── Frame-locked render loop with Letterboxing ───
    async function renderLoop() {
      const video = videoRef.current;
      if (
        video &&
        !video.paused &&
        !video.ended &&
        video.videoWidth > 0 &&
        video.videoHeight > 0 &&
        !isProcessingRef.current
      ) {
        isProcessingRef.current = true;

        try {
          const Wv = video.videoWidth;
          const Hv = video.videoHeight;
          const S = SQUARE_TARGET_SIZE;

          // Aspect-ratio preserving scale and padding
          const scale = Math.min(S / Wv, S / Hv);
          const scaledW = Wv * scale;
          const scaledH = Hv * scale;
          const padX = (S - scaledW) / 2;
          const padY = (S - scaledH) / 2;

          let bitmap: ImageBitmap;

          if (letterboxCtx && letterboxCanvas) {
            // Draw into letterbox square with black bars
            letterboxCtx.fillStyle = '#000000';
            letterboxCtx.fillRect(0, 0, S, S);
            letterboxCtx.drawImage(video, 0, 0, Wv, Hv, padX, padY, scaledW, scaledH);
            bitmap = letterboxCanvas.transferToImageBitmap();
          } else {
            // Fallback: direct bitmap creation
            bitmap = await createImageBitmap(video, {
              resizeWidth: S,
              resizeHeight: S,
              resizeQuality: 'medium',
            });
          }

          // Transfer bitmap ownership to worker (zero-copy, instant GC on main thread)
          const msg: DetectMessage = {
            type: 'detect',
            frame: bitmap,
            timestamp: performance.now(),
            videoWidth: Wv,
            videoHeight: Hv,
            padX,
            padY,
            scale,
            squareSize: S,
          };

          worker.postMessage(msg, [bitmap]);
        } catch {
          // Release lock if frame preparation encounters an error
          isProcessingRef.current = false;
        }
      }

      rafIdRef.current = requestAnimationFrame(renderLoop);
    }

    rafIdRef.current = requestAnimationFrame(renderLoop);

    // ─── Cleanup ───
    return () => {
      cancelAnimationFrame(rafIdRef.current);

      worker.postMessage({ type: 'close' });
      setTimeout(() => {
        worker.terminate();
      }, 100);

      workerRef.current = null;
      isProcessingRef.current = false;
      letterboxCanvas = null;
      letterboxCtx = null;
    };
  }, [isReady, enabled, videoRef]);

  return { modelStatus, fps, inferenceTimeMs, modelMessage };
}
