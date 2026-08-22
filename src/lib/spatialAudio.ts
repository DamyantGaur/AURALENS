import type { Detection } from '@/workers/vision.worker';

// ─── Configuration ───
const DEBOUNCE_MS = 3000;       // 3-second debounce per object class
const TONE_FREQUENCY = 440;      // Hz (A4)
const TONE_DURATION = 0.15;      // seconds
const TONE_VOLUME = 0.3;         // 0-1

/**
 * SpatialAudioEngine — Dual-layer audio feedback for object detections.
 *
 * Layer 1: Spatialized tone ping via OscillatorNode → StereoPannerNode
 *          Panned to match the detected object's X position.
 *
 * Layer 2: Speech announcement via SpeechSynthesisUtterance
 *          Always center-panned (browser limitation — no routing through AudioContext).
 *
 * Implements a 3-second debounce per object class to prevent audio spam.
 */
export class SpatialAudioEngine {
  private audioCtx: AudioContext | null = null;
  private lastAnnouncedMap: Map<string, number> = new Map();
  private disposed = false;

  /**
   * Warm up both the AudioContext and SpeechSynthesis.
   * MUST be called from a user gesture handler (click/tap) for Android Chrome.
   */
  async warmup(): Promise<void> {
    // Create AudioContext on first user interaction to satisfy autoplay policy
    if (!this.audioCtx) {
      this.audioCtx = new AudioContext();
    }

    // Resume if suspended (required after page load on most mobile browsers)
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }

    // Android Chrome SpeechSynthesis warmup — fire empty utterance
    if ('speechSynthesis' in window) {
      const emptyUtterance = new SpeechSynthesisUtterance('');
      window.speechSynthesis.speak(emptyUtterance);
    }
  }

  /**
   * Process new detections and trigger audio feedback for each.
   *
   * @param detections - Array of detected objects from the worker
   * @param frameWidth - Width of the detection frame (source coordinates)
   */
  announce(detections: Detection[], frameWidth: number): void {
    if (this.disposed || !this.audioCtx) return;

    const now = Date.now();

    for (const detection of detections) {
      const { categoryName, boundingBox } = detection;

      // ─── Debounce: skip if this class was announced recently ───
      const lastAnnounced = this.lastAnnouncedMap.get(categoryName) ?? 0;
      if (now - lastAnnounced < DEBOUNCE_MS) continue;

      // Mark as announced
      this.lastAnnouncedMap.set(categoryName, now);

      // ─── Calculate pan position ───
      // Map object center X from [0, frameWidth] to [-1, +1]
      const centerX = boundingBox.originX + boundingBox.width / 2;
      const pan = Math.max(-1, Math.min(1, (centerX / frameWidth) * 2 - 1));

      // ─── Layer 1: Spatialized tone ping ───
      this.playTone(pan);

      // ─── Layer 2: Speech announcement ───
      this.speak(categoryName);
    }
  }

  /**
   * Play a short sine tone panned to the given position.
   */
  private playTone(pan: number): void {
    if (!this.audioCtx || this.audioCtx.state !== 'running') return;

    const now = this.audioCtx.currentTime;

    // Create oscillator → gain → panner → destination
    const oscillator = this.audioCtx.createOscillator();
    const gainNode = this.audioCtx.createGain();
    const pannerNode = new StereoPannerNode(this.audioCtx, { pan });

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(TONE_FREQUENCY, now);

    // Quick attack, smooth release to avoid clicks
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(TONE_VOLUME, now + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + TONE_DURATION);

    oscillator.connect(gainNode);
    gainNode.connect(pannerNode);
    pannerNode.connect(this.audioCtx.destination);

    oscillator.start(now);
    oscillator.stop(now + TONE_DURATION + 0.01);

    // Self-cleanup after the tone finishes
    oscillator.onended = () => {
      oscillator.disconnect();
      gainNode.disconnect();
      pannerNode.disconnect();
    };
  }

  /**
   * Speak an object name using the Web Speech API.
   * Center-panned (browser limitation — cannot route through AudioContext).
   */
  private speak(text: string): void {
    if (!('speechSynthesis' in window)) return;

    // Cancel any currently queued speech to avoid buildup
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.2;   // Slightly faster for responsiveness
    utterance.pitch = 1.0;
    utterance.volume = 0.8;

    window.speechSynthesis.speak(utterance);
  }

  /**
   * Clean up all resources.
   */
  dispose(): void {
    this.disposed = true;

    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }

    this.lastAnnouncedMap.clear();
  }
}
