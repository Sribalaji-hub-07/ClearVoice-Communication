import React, { useEffect, useRef } from 'react';

interface Props {
  analyser: AnalyserNode | null;
  isActive: boolean;
  barColor?: string;
  bgColor?: string;
  barCount?: number;
  height?: number;
}

export default function SoundWaveVisualizer({
  analyser,
  isActive,
  barColor = '#ffffff',
  bgColor = '#06101e',
  barCount = 64,
  height = 180,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let animId: number;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dataArray = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;

    const draw = () => {
      const width = canvas.width;
      const h = canvas.height;
      const cy = h / 2;

      // Dark background matching image 1
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, width, h);

      if (isActive && analyser && dataArray) {
        analyser.getByteFrequencyData(dataArray);
      }

      const totalBars = barCount;
      const barSpacing = width / totalBars;
      const barWidth = Math.max(3, barSpacing * 0.45);
      const now = Date.now() / 1000;

      for (let i = 0; i < totalBars; i++) {
        const x = i * barSpacing + barSpacing / 2;

        // Symmetric bell-shaped window so center bars are naturally taller like audio waveforms
        const norm = i / (totalBars - 1); // 0 to 1
        const bellCurve = Math.sin(norm * Math.PI); // 0 at edges, 1 in center

        let amplitude = 0.15 * bellCurve; // baseline idle height

        if (isActive && dataArray) {
          // Map index to frequency bin
          const binIndex = Math.min(
            dataArray.length - 1,
            Math.floor((i / totalBars) * 48)
          );
          const freqValue = dataArray[binIndex] / 255.0; // 0 to 1
          amplitude = Math.max(0.12, freqValue * 0.95 * (0.35 + 0.65 * bellCurve));
        } else {
          // Gentle rhythmic idle animation
          const wavePhase = Math.sin(now * 2.5 + i * 0.25);
          amplitude = (0.15 + 0.12 * wavePhase) * (0.4 + 0.6 * bellCurve);
        }

        const barHeight = Math.max(8, amplitude * (h - 24));
        const top = cy - barHeight / 2;
        const bottom = cy + barHeight / 2;

        ctx.strokeStyle = barColor;
        ctx.lineWidth = barWidth;
        ctx.lineCap = 'round';

        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.stroke();
      }

      animId = requestAnimationFrame(draw);
    };

    draw();

    return () => cancelAnimationFrame(animId);
  }, [analyser, isActive, barColor, bgColor, barCount, height]);

  return (
    <div className="soundwave-visualizer-card">
      <canvas
        ref={canvasRef}
        width={700}
        height={height}
        style={{ width: '100%', height: `${height}px`, display: 'block', borderRadius: '10px' }}
      />
    </div>
  );
}
