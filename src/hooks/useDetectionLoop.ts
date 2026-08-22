'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import type { Detection, DetectionResult, StatusMessage } from '@/workers/vision.worker';

// ─── Types ───
export type ModelStatus = 'idle' | 'initializing' | 'ready' | 'error';

export interface UseDetectionLoopOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isReady: boolean;
  enabled: boolean;
  onDetections: (detections: Detection[], sourceWidth: number, sourceHeight: number) => void;
}

export interface UseDetectionLoopReturn {
  modelStatus: ModelStatus;
  modelMessage: string;
  fps: number;
  inferenceTimeMs: number;
}

const DOWNSCALE_WIDTH = 480;

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

    // ─── FPS tracking ───
    let frameCount = 0;
    let lastFpsTime = performance.now();

    // ─── Track downscaled frame dimensions to pass to renderer ───
    let lastSourceWidth = DOWNSCALE_WIDTH;
    let lastSourceHeight = 0;

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

        // Update inference time
        setInferenceTimeMs(Math.round(result.inferenceTimeMs));

        // FPS tracking
        frameCount++;
        const now = performance.now();
        if (now - lastFpsTime >= 1000) {
          setFps(frameCount);
          frameCount = 0;
          lastFpsTime = now;
        }

        // Forward detections to the rendering callback
        onDetectionsRef.current(result.detections, lastSourceWidth, lastSourceHeight);

        // CRITICAL: Release the frame-lock so the next frame can be sent
        isProcessingRef.current = false;
      }
    };

    worker.onerror = (error) => {
      console.error('[useDetectionLoop] Worker error:', error);
      setModelStatus('error');
      setModelMessage(`Worker crashed: ${error.message}`);
    };

    // ─── Frame-locked render loop ───
    function renderLoop() {
      const video = videoRef.current;
      if (video && !video.paused && !video.ended && !isProcessingRef.current) {
        isProcessingRef.current = true;

        // Downscale captured frame to 320px width for mobile performance
        createImageBitmap(video, {
          resizeWidth: DOWNSCALE_WIDTH,
          resizeQuality: 'low',
        })
          .then((bitmap) => {
            // Track the actual dimensions of the downscaled frame
            lastSourceWidth = bitmap.width;
            lastSourceHeight = bitmap.height;

            // Transfer bitmap ownership to the worker (zero-copy, instant GC on main thread)
            worker.postMessage(
              { type: 'detect', frame: bitmap, timestamp: performance.now() },
              [bitmap]
            );
          })
          .catch(() => {
            // If createImageBitmap fails (e.g., video not ready), release lock
            isProcessingRef.current = false;
          });
      }

      rafIdRef.current = requestAnimationFrame(renderLoop);
    }

    rafIdRef.current = requestAnimationFrame(renderLoop);

    // ─── Cleanup ───
    return () => {
      cancelAnimationFrame(rafIdRef.current);

      // Tell the worker to release the WASM heap and model
      worker.postMessage({ type: 'close' });

      // Give the worker a moment to clean up, then terminate
      setTimeout(() => {
        worker.terminate();
      }, 100);

      workerRef.current = null;
      isProcessingRef.current = false;
    };
  }, [isReady, enabled, videoRef]);

  return { modelStatus, fps, inferenceTimeMs, modelMessage };
}
