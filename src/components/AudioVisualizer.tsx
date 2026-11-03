import { useEffect, useRef } from 'react';
import type { AudioEngine } from '../audio/AudioEngine';

export type VisualizerKind = 'waveform-original' | 'waveform-enhanced' | 'spectrum-overlay';

interface Props {
  engine: AudioEngine;
  kind: VisualizerKind;
  running: boolean;
  height?: number;
}

const WAVE_POINTS = 1024;

/**
 * Draws directly from the AnalyserNodes on every animation frame - no synthetic
 * data, so a flat line really means a silent channel.
 */
export function AudioVisualizer({ engine, kind, running, height = 132 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const wave = new Float32Array(WAVE_POINTS);
    const specEnh = new Uint8Array(1024);
    const specOrig = new Uint8Array(1024);
    let frame = 0;
    let stopped = false;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const drawGrid = (w: number, h: number) => {
      ctx.strokeStyle = 'rgba(30, 48, 80, 0.85)';
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const y = (h / 4) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(42, 66, 105, 0.9)';
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
    };

    const drawWave = (w: number, h: number, color: string, glow: string) => {
      if (running) {
        if (kind === 'waveform-enhanced') engine.readEnhancedWaveform(wave);
        else engine.readOriginalWaveform(wave);
      } else wave.fill(0);

      ctx.clearRect(0, 0, w, h);
      drawGrid(w, h);
      ctx.beginPath();
      const step = w / WAVE_POINTS;
      for (let i = 0; i < WAVE_POINTS; i++) {
        const v = Math.max(-1, Math.min(1, wave[i]));
        const y = h / 2 - v * (h / 2 - 4);
        if (i === 0) ctx.moveTo(0, y);
        else ctx.lineTo(i * step, y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.shadowColor = glow;
      ctx.shadowBlur = running ? 9 : 0;
      ctx.stroke();
      ctx.shadowBlur = 0;
    };

    const drawSpectrum = (w: number, h: number) => {
      if (running) {
        engine.readSpectrum(specEnh);
        engine.readOriginalSpectrum(specOrig);
      } else {
        specEnh.fill(0);
        specOrig.fill(0);
      }
      ctx.clearRect(0, 0, w, h);
      drawGrid(w, h);

      const bars = 96;
      const bw = w / bars;
      // log-spaced bins so the 80 Hz - 8 kHz speech range is readable
      const binAt = (i: number, len: number) => {
        const t = i / bars;
        return Math.min(len - 1, Math.round(Math.pow(10, t * Math.log10(len))));
      };
      for (let i = 0; i < bars; i++) {
        const o = specOrig[binAt(i, specOrig.length)] / 255;
        const e = specEnh[binAt(i, specEnh.length)] / 255;
        const ox = (1 - o) * h;
        ctx.fillStyle = 'rgba(148, 163, 184, 0.32)';
        ctx.fillRect(i * bw, ox, bw * 0.9, Math.max(0, h - ox));
        const ey = (1 - e) * h;
        const grad = ctx.createLinearGradient(0, ey, 0, h);
        grad.addColorStop(0, '#22d3ee');
        grad.addColorStop(1, '#3d8bfd');
        ctx.fillStyle = grad;
        ctx.fillRect(i * bw, ey, bw * 0.62, Math.max(0, h - ey));
      }
    };

    const loop = () => {
      if (stopped) return;
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      if (kind === 'spectrum-overlay') drawSpectrum(w, h);
      else drawWave(w, h, kind === 'waveform-enhanced' ? '#5eb2ff' : '#c3cede', kind === 'waveform-enhanced' ? 'rgba(61,139,253,0.6)' : 'rgba(203,213,225,0.35)');
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [engine, kind, running, height]);

  return <canvas ref={canvasRef} className="viz" style={{ height }} />;
}
