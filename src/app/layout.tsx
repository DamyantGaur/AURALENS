import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AuraLens — Real-Time AI Object Detection",
  description:
    "Edge AI-powered real-time object detection with spatial audio feedback. Runs entirely in your browser using MediaPipe and WebAssembly.",
  keywords: ["object detection", "AI", "MediaPipe", "spatial audio", "edge AI", "WebAssembly"],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#1a1a2e" />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
