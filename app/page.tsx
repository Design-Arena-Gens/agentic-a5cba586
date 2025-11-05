"use client";

import { useCallback, useMemo, useState } from "react";
import type { ImageAnalysis } from "../lib/imageAnalysis";
import { analyzeFiles, exportAnalysesToCSV } from "../lib/imageAnalysis";

export default function Page() {
  const [analyses, setAnalyses] = useState<ImageAnalysis[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFilesSelected = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    setIsAnalyzing(true);
    try {
      const list = Array.from(files);
      const result = await analyzeFiles(list);
      setAnalyses(result);
    } catch (e: any) {
      setError(e?.message || "Failed to analyze images.");
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  const onCSV = useCallback(() => {
    const csv = exportAnalysesToCSV(analyses);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "photo_check.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, [analyses]);

  const summary = useMemo(() => {
    const total = analyses.length;
    const blurry = analyses.filter((a) => a.flags.includes("blurry")).length;
    const lowres = analyses.filter((a) => a.flags.includes("low-resolution")).length;
    const over = analyses.filter((a) => a.flags.includes("overexposed")).length;
    const under = analyses.filter((a) => a.flags.includes("underexposed")).length;
    const dupes = analyses.filter((a) => a.flags.includes("duplicate")).length;
    return { total, blurry, lowres, over, under, dupes };
  }, [analyses]);

  return (
    <main>
      <section className="uploader">
        <label className="dropzone">
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => onFilesSelected(e.target.files)}
          />
          <div className="dropzone-instructions">
            <strong>Click to select</strong> or drag and drop images here
            <div className="hint">JPG, PNG, HEIC/HEIF, WebP supported by your browser</div>
          </div>
        </label>
      </section>

      {isAnalyzing && <div className="status">Analyzing photos?</div>}
      {error && <div className="error">{error}</div>}

      {analyses.length > 0 && (
        <section className="summary">
          <div className="summary-cards">
            <div className="card"><div className="metric">{summary.total}</div><div className="label">Total</div></div>
            <div className="card warn"><div className="metric">{summary.blurry}</div><div className="label">Blurry</div></div>
            <div className="card warn"><div className="metric">{summary.lowres}</div><div className="label">Low-res</div></div>
            <div className="card warn"><div className="metric">{summary.over}</div><div className="label">Overexposed</div></div>
            <div className="card warn"><div className="metric">{summary.under}</div><div className="label">Underexposed</div></div>
            <div className="card danger"><div className="metric">{summary.dupes}</div><div className="label">Duplicates</div></div>
          </div>
          <div className="summary-actions">
            <button className="btn" onClick={() => setAnalyses([])}>Reset</button>
            <button className="btn primary" onClick={onCSV}>Download CSV</button>
          </div>
        </section>
      )}

      {analyses.length > 0 && (
        <section className="grid">
          {analyses.map((a) => (
            <article key={a.id} className="tile">
              <div className="thumb-wrap">
                <img src={a.objectUrl} alt={a.name} className="thumb" />
                {a.flags.length > 0 && (
                  <div className="flags">
                    {a.flags.map((f) => (
                      <span key={f} className={`flag ${f}`}>{f}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="meta">
                <div className="name" title={a.name}>{a.name}</div>
                <div className="row"><span>Resolution</span><span>{a.width}?{a.height} ({a.megapixels.toFixed(2)}MP)</span></div>
                <div className="row"><span>Blur score</span><span>{a.blurScore.toFixed(0)} / 100</span></div>
                <div className="row"><span>Exposure</span><span>over {Math.round(a.exposure.overExposedPercent*100)}% ? under {Math.round(a.exposure.underExposedPercent*100)}%</span></div>
                {a.exif && (
                  <div className="row small">
                    <span>EXIF</span>
                    <span>{[a.exif.make, a.exif.model, a.exif.dateTime]?.filter(Boolean).join(" ? ")}</span>
                  </div>
                )}
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
