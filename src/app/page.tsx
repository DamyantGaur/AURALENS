'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useWebcam } from '@/hooks/useWebcam';
import { useDetectionLoop } from '@/hooks/useDetectionLoop';
import { drawDetections } from '@/lib/canvasRenderer';
import { SpatialAudioEngine } from '@/lib/spatialAudio';
import type { Detection } from '@/workers/vision.worker';

type AppState = 'idle' | 'starting' | 'running' | 'error';

export default function HomePage() {
  const { videoRef, error, isReady, videoDimensions, startCamera } = useWebcam();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioEngineRef = useRef<SpatialAudioEngine | null>(null);
  const [appState, setAppState] = useState<AppState>('idle');
  const [detectionCount, setDetectionCount] = useState(0);

  // ─── Detection callback: draw boxes + trigger audio ───
  const handleDetections = useCallback(
    (detections: Detection[], sourceWidth: number, sourceHeight: number) => {
      setDetectionCount(detections.length);

      // Draw bounding boxes on canvas
      const canvas = canvasRef.current;
      if (canvas && videoDimensions) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          drawDetections(ctx, detections, videoDimensions.width, videoDimensions.height, sourceWidth, sourceHeight);
        }
      }

      // Trigger spatial audio
      if (audioEngineRef.current && detections.length > 0) {
        audioEngineRef.current.announce(detections, sourceWidth);
      }
    },
    [videoDimensions],
  );

  // ─── Detection loop ───
  const { modelStatus, fps, inferenceTimeMs, modelMessage } = useDetectionLoop({
    videoRef,
    isReady,
    enabled: appState === 'running',
    onDetections: handleDetections,
  });

  // ─── Sync canvas resolution to video dimensions + DPR ───
  useEffect(() => {
    if (!videoDimensions || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = videoDimensions.width * dpr;
    canvas.height = videoDimensions.height * dpr;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
    }
  }, [videoDimensions]);

  // ─── Handle error state ───
  useEffect(() => {
    if (error) setAppState('error');
  }, [error]);

  // ─── Handle camera ready → running ───
  useEffect(() => {
    if (isReady && appState === 'starting') {
      setAppState('running');
    }
  }, [isReady, appState]);

  // ─── Cleanup audio engine on unmount ───
  useEffect(() => {
    return () => {
      audioEngineRef.current?.dispose();
    };
  }, []);

  // ─── Start button handler with Android warmup ───
  const handleStart = useCallback(async () => {
    setAppState('starting');

    // Create and warm up audio engine (must happen in user gesture handler)
    const engine = new SpatialAudioEngine();
    await engine.warmup();
    audioEngineRef.current = engine;

    await startCamera();
  }, [startCamera]);

  // ─── Compute aspect ratio for responsive container ───
  const aspectRatio = videoDimensions
    ? `${videoDimensions.width} / ${videoDimensions.height}`
    : '640 / 480';

  // ─── Derive model status indicator ───
  const modelStatusDot =
    modelStatus === 'ready'
      ? 'status-dot--active'
      : modelStatus === 'error'
        ? 'status-dot--error'
        : modelStatus === 'initializing'
          ? 'status-dot--loading'
          : 'status-dot--inactive';

  const modelStatusText =
    modelStatus === 'ready'
      ? 'Model Active'
      : modelStatus === 'error'
        ? 'Model Error'
        : modelStatus === 'initializing'
          ? modelMessage || 'Loading…'
          : 'Model Idle';

  return (
    <main className="flex-1 flex flex-col items-center justify-center p-4 gap-6 select-none">
      {/* ─── Header ─── */}
      <header className="text-center" style={{ animation: 'fade-in-up 0.6s ease-out both' }}>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
          <span style={{ color: 'var(--color-accent-cyan)' }}>Aura</span>
          <span style={{ color: 'var(--color-text-primary)' }}>Lens</span>
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>
          Real-time edge AI object detection · Spatial audio
        </p>
      </header>

      {/* ─── Video + Canvas Container ─── */}
      <div
        className="video-container corner-brackets w-full"
        style={{ maxWidth: '640px', aspectRatio }}
      >
        <video
          ref={videoRef}
          className="video-feed"
          playsInline
          muted
          autoPlay
          style={{ aspectRatio }}
        />
        <canvas ref={canvasRef} className="detection-canvas" />
        {appState === 'running' && modelStatus !== 'ready' && <div className="scanner-line" />}

        {/* Idle state overlay */}
        {appState === 'idle' && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center z-10"
            style={{ background: 'oklch(0.13 0.02 260 / 0.85)' }}
          >
            <svg
              width="64"
              height="64"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: 'var(--color-accent-cyan-dim)', marginBottom: '16px' }}
            >
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              Camera feed will appear here
            </p>
          </div>
        )}

        {/* Loading overlay */}
        {appState === 'starting' && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center z-10"
            style={{ background: 'oklch(0.13 0.02 260 / 0.85)' }}
          >
            <div
              className="w-10 h-10 border-2 rounded-full animate-spin"
              style={{
                borderColor: 'var(--color-hud-border)',
                borderTopColor: 'var(--color-accent-cyan)',
              }}
            />
            <p className="mt-4 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              Initializing camera…
            </p>
          </div>
        )}
      </div>

      {/* ─── Error Panel ─── */}
      {(error || modelStatus === 'error') && (
        <div className="error-panel w-full" style={{ maxWidth: '640px' }}>
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="flex-shrink-0 mt-0.5"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{error || modelMessage}</span>
        </div>
      )}

      {/* ─── HUD Status Panel ─── */}
      <div
        className="hud-panel w-full flex flex-wrap items-center justify-between gap-4"
        style={{ maxWidth: '640px', animationDelay: '0.15s' }}
      >
        {/* Status Indicators */}
        <div className="flex items-center gap-5">
          {/* Camera Status */}
          <div className="flex items-center gap-2">
            <span
              className={`status-dot ${
                appState === 'running'
                  ? 'status-dot--active'
                  : appState === 'error'
                    ? 'status-dot--error'
                    : appState === 'starting'
                      ? 'status-dot--loading'
                      : 'status-dot--inactive'
              }`}
            />
            <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
              {appState === 'running'
                ? 'Camera Active'
                : appState === 'starting'
                  ? 'Starting…'
                  : appState === 'error'
                    ? 'Error'
                    : 'Standby'}
            </span>
          </div>

          {/* Model Status */}
          <div className="flex items-center gap-2">
            <span className={`status-dot ${modelStatusDot}`} />
            <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
              {modelStatusText}
            </span>
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-6">
          {/* FPS */}
          <div className="text-center">
            <div className="stat-value">{appState === 'running' ? fps : '—'}</div>
            <div className="stat-label">FPS</div>
          </div>

          {/* Inference Time */}
          <div className="text-center">
            <div className="stat-value" style={{ fontSize: '14px' }}>
              {appState === 'running' && modelStatus === 'ready'
                ? `${inferenceTimeMs}ms`
                : '—'}
            </div>
            <div className="stat-label">Inference</div>
          </div>

          {/* Resolution */}
          <div className="text-center">
            <div className="stat-value" style={{ fontSize: '14px' }}>
              {videoDimensions
                ? `${videoDimensions.width}×${videoDimensions.height}`
                : '—'}
            </div>
            <div className="stat-label">Resolution</div>
          </div>

          {/* Detections */}
          <div className="text-center">
            <div className="stat-value">
              {appState === 'running' ? detectionCount : '—'}
            </div>
            <div className="stat-label">Objects</div>
          </div>
        </div>
      </div>

      {/* ─── Start Button ─── */}
      {appState === 'idle' && (
        <button
          id="start-assistant-btn"
          className="btn-start"
          onClick={handleStart}
          style={{ animationDelay: '0.3s', animation: 'fade-in-up 0.6s ease-out both' }}
        >
          <span>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="inline-block mr-2 -mt-0.5"
            >
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            Start Assistant
          </span>
        </button>
      )}

      {/* ─── Footer ─── */}
      <footer
        className="text-center pb-4"
        style={{ color: 'var(--color-text-muted)', fontSize: '11px' }}
      >
        Edge AI · No data leaves your device · WebAssembly + MediaPipe
      </footer>
    </main>
  );
}
