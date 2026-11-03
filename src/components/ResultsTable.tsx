import { TableProperties } from 'lucide-react';
import type { ResultRow } from '../audio/evaluation';
import { formatNum } from '../audio/audioUtils';

interface Props {
  rows: ResultRow[];
}

function cell(value: number, digits = 1, goodWhenPositive = true) {
  if (!isFinite(value)) return <td>--</td>;
  const good = goodWhenPositive ? value > 0 : value < 0;
  return <td className={value === 0 ? '' : good ? 'pos' : 'neg'}>{value > 0 ? '+' : ''}{value.toFixed(digits)}</td>;
}

/** The results table required by section 10 of the specification. */
export function ResultsTable({ rows }: Props) {
  return (
    <div className="card">
      <div className="card-title">
        <TableProperties size={14} /> Measured results
      </div>
      {rows.length === 0 ? (
        <div className="faint">
          No measurements yet. Start processing, speak over a noise source, then press "Measure 2 s" on the
          evaluation page. Every number below comes from the captured buffers.
        </div>
      ) : (
        <div className="scroll-x">
          <table className="table">
            <thead>
              <tr>
                <th>Noise condition</th>
                <th>Original SNR (dB)</th>
                <th>Enhanced SNR (dB)</th>
                <th>SNR improvement (dB)</th>
                <th>Noise floor reduction (dB)</th>
                <th>Speech energy change (dB)</th>
                <th>Processing delay (ms)</th>
                <th>Observations</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={`${row.condition}-${i}`}>
                  <td className="text">{row.condition}</td>
                  <td>{formatNum(row.originalSnrDb)}</td>
                  <td>{formatNum(row.enhancedSnrDb)}</td>
                  {cell(row.snrImprovementDb)}
                  {cell(row.noiseFloorReductionDb)}
                  {cell(row.speechEnergyChangeDb, 1, false)}
                  <td>{formatNum(row.processingDelayMs)}</td>
                  <td className="text faint">{row.observation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="faint" style={{ marginTop: 12 }}>
        SNR is a reference-free estimate (10th-percentile frame energy as the noise floor, frames 6 dB above it
        as speech). &quot;Speech energy change&quot; near 0 dB means the speaker was preserved. PESQ/STOI need a
        clean reference file, so export the WAVs and run them in an external tool.
      </div>
    </div>
  );
}
