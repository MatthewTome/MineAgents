interface BoxPlotProps {
  data: Array<{ condition: string; min: number; q1: number; median: number; q3: number; max: number }>;
}

export default function BoxPlot({ data }: BoxPlotProps) {
  if (!data.length) {
    return <div className="chart-placeholder">No timing data available.</div>;
  }

  const scale = (value: number, max: number) => {
    if (max === 0) {
      return 0;
    }
    return (value / max) * 160 + 20;
  };

  const maxValue = Math.max(...data.map(item => item.max));

  return (
    <div className="box-plot">
      {data.map(item => {
        const min = scale(item.min, maxValue);
        const q1 = scale(item.q1, maxValue);
        const median = scale(item.median, maxValue);
        const q3 = scale(item.q3, maxValue);
        const max = scale(item.max, maxValue);

        return (
          <div className="box-column" key={item.condition}>
            <svg width="120" height="220">
              <line x1="60" x2="60" y1={220 - min} y2={220 - max} stroke="#94a3b8" strokeWidth="2" />
              <rect x="30" y={220 - q3} width="60" height={q3 - q1} fill="#1f2937" stroke="#38bdf8" strokeWidth="2" />
              <line x1="30" x2="90" y1={220 - median} y2={220 - median} stroke="#38bdf8" strokeWidth="3" />
              <line x1="45" x2="75" y1={220 - min} y2={220 - min} stroke="#94a3b8" strokeWidth="2" />
              <line x1="45" x2="75" y1={220 - max} y2={220 - max} stroke="#94a3b8" strokeWidth="2" />
            </svg>
            <strong>{item.condition}</strong>
            <span className="tag">Median {item.median.toFixed(1)}s</span>
          </div>
        );
      })}
    </div>
  );
}