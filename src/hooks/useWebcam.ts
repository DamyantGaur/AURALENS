'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

export interface VideoDimensions {
  width: number;
  height: number;
}

export interface UseWebcamReturn {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  stream: MediaStream | null;
  error: string | null;
  isReady: boolean;
  videoDimensions: VideoDimensions | null;
  startCamera: () => Promise<void>;
}

export function useWebcam(): UseWebcamReturn {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [videoDimensions, setVideoDimensions] = useState<VideoDimensions | null>(null);

  const startCamera = useCallback(async () => {
    try {
      setError(null);
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: { ideal: 'environment' },
        },
        audio: false,
      });

      setStream(mediaStream);

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;

        videoRef.current.onloadedmetadata = () => {
          const video = videoRef.current!;
          const width = video.videoWidth;
          const height = video.videoHeight;
          setVideoDimensions({ width, height });
          setIsReady(true);
        };
      }
    } catch (err) {
      if (err instanceof DOMException) {
        switch (err.name) {
          case 'NotAllowedError':
            setError('Camera permission denied. Please allow camera access in your browser settings.');
            break;
          case 'NotFoundError':
            setError('No camera found. Please connect a camera and try again.');
            break;
          case 'NotReadableError':
            setError('Camera is already in use by another application.');
            break;
          case 'OverconstrainedError':
            setError('Camera does not support the requested resolution. Trying fallback...');
            // Fallback: try with no constraints
            try {
              const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
              setStream(fallbackStream);
              if (videoRef.current) {
                videoRef.current.srcObject = fallbackStream;
                videoRef.current.onloadedmetadata = () => {
                  const video = videoRef.current!;
                  setVideoDimensions({ width: video.videoWidth, height: video.videoHeight });
                  setIsReady(true);
                  setError(null);
                };
              }
            } catch {
              setError('Camera could not be accessed even with fallback constraints.');
            }
            break;
          default:
            setError(`Camera error: ${err.message}`);
        }
      } else {
        setError('An unexpected error occurred while accessing the camera.');
      }
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [stream]);

  return { videoRef, stream, error, isReady, videoDimensions, startCamera };
}
