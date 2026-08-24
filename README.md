# AuraLens 

> Real-time Edge AI Object Detection with Spatial Audio Feedback, built with Next.js 16 (App Router), Tailwind CSS, MediaPipe Tasks Vision (WebAssembly), and Web Audio API.

---

##  Features

- ** Off-Main-Thread Edge AI:** Runs MediaPipe `ObjectDetector` inside a dedicated Web Worker via WebAssembly. Zero UI freezes or stuttering.
- ** Memory-Safe Frame Locking:** Uses frame-lock pipeline with `ImageBitmap` transfer to prevent memory leaks and maintain steady performance.
- ** Spatial Audio Engine:**
  - **Directional Sound:** Maps object X-coordinates to a `StereoPannerNode` so detected objects ping in the left/right earbud corresponding to their location.
  - **Speech Synthesis:** Uses Web Speech API to announce detected object labels with intelligent 3-second debounce per object class.
- **📱 Mobile & Android Ready:**
  - Dynamic aspect-ratio adaptation on `loadedmetadata` (supporting portrait & landscape modes).
  - Flexible `{ ideal }` camera constraints with environment (back) camera preference.
  - Android Chrome `SpeechSynthesis` and `AudioContext` warmup on user gesture.
  - HiDPI canvas sharpness scaling via `window.devicePixelRatio`.
- ** Strict Content Security Policy (CSP):** Self-hosted WASM binaries and TFLite model in `/public` for privacy and offline reliability.
- ** Dark-Mode Cyberpunk HUD:** Sleek HUD UI with live stats (FPS, inference latency, camera resolution, detected object counters).

---

##  Getting Started

### Prerequisites

- Node.js 18+ or 20+
- npm, pnpm, or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/DamyantGaur/AURALENS.git
cd AURALENS

# Install dependencies
npm install
```

### Running Locally

```bash
# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser, click **Start Assistant**, and allow camera access.

### Production Build

```bash
npm run build
npm run start
```

---

##  Architecture Overview

```
src/
├── app/
│   ├── layout.tsx         # Root layout with mobile viewport & theme metadata
│   ├── page.tsx           # Main HUD UI & integration orchestrator
│   └── globals.css        # Cyberpunk HUD styling & animations
├── hooks/
│   ├── useWebcam.ts       # Flexible getUserMedia hook & dynamic resolution detection
│   └── useDetectionLoop.ts# Frame-locked worker communication & FPS tracker
├── lib/
│   ├── canvasRenderer.ts  # DPR-aware bounding box overlay renderer
│   └── spatialAudio.ts    # StereoPannerNode & Web Speech dual-layer audio engine
└── workers/
    └── vision.worker.ts   # MediaPipe WASM detector in Web Worker
public/
├── wasm/                  # MediaPipe WASM runtime files
└── models/                # EfficientDet-Lite0 TFLite model
```

---

## 📜 License

MIT License. Free for open source and personal use.
