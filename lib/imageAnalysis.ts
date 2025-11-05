export type ImageExposureStats = {
  overExposedPercent: number; // 0..1
  underExposedPercent: number; // 0..1
};

export type ImageExif = {
  make?: string;
  model?: string;
  dateTime?: string;
};

export type ImageAnalysis = {
  id: string;
  name: string;
  sizeBytes: number;
  width: number;
  height: number;
  aspectRatio: number;
  megapixels: number;
  blurVariance: number;
  blurScore: number; // 0..100; higher is sharper
  exposure: ImageExposureStats;
  exif?: ImageExif;
  hashHex: string; // 64-bit dHash hex
  flags: string[]; // blurry, low-resolution, overexposed, underexposed, duplicate
  objectUrl: string;
};

function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = url;
  });
}

function drawToCanvas(img: HTMLImageElement, maxDim: number): ImageData {
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D not supported");
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

function toGrayscale(data: ImageData): { gray: Float32Array; width: number; height: number } {
  const { data: rgba, width, height } = data;
  const gray = new Float32Array(width * height);
  for (let i = 0, g = 0; i < rgba.length; i += 4, g += 1) {
    const r = rgba[i], gch = rgba[i + 1], b = rgba[i + 2];
    // ITU-R BT.601 luma
    gray[g] = 0.299 * r + 0.587 * gch + 0.114 * b;
  }
  return { gray, width, height };
}

function laplacianVariance(gray: Float32Array, width: number, height: number): number {
  const kernel = [0, 1, 0, 1, -4, 1, 0, 1, 0];
  const out = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let acc = 0;
      let k = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const ix = x + kx;
          const iy = y + ky;
          acc += gray[iy * width + ix] * kernel[k++];
        }
      }
      out[y * width + x] = acc;
    }
  }
  // variance
  let mean = 0;
  const n = out.length;
  for (let i = 0; i < n; i++) mean += out[i];
  mean /= n;
  let variance = 0;
  for (let i = 0; i < n; i++) {
    const d = out[i] - mean;
    variance += d * d;
  }
  variance /= n;
  return variance;
}

function exposureStats(data: ImageData): ImageExposureStats {
  const { data: rgba } = data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    const y = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    hist[y]++;
  }
  const total = (rgba.length / 4) | 0;
  let under = 0;
  for (let i = 0; i <= 5; i++) under += hist[i];
  let over = 0;
  for (let i = 250; i <= 255; i++) over += hist[i];
  return { overExposedPercent: over / total, underExposedPercent: under / total };
}

function smallGrayscale(img: HTMLImageElement, w: number, h: number): Float32Array {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D not supported");
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const gray = new Float32Array(w * h);
  for (let i = 0, g = 0; i < data.length; i += 4, g++) {
    gray[g] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return gray;
}

function dHashHex(img: HTMLImageElement): string {
  // Difference hash on 9x8
  const w = 9, h = 8;
  const g = smallGrayscale(img, w, h);
  let bits = "";
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w - 1; x++) {
      const left = g[y * w + x];
      const right = g[y * w + x + 1];
      bits += left > right ? "1" : "0";
    }
  }
  // 64 bits -> 16 hex chars
  let hex = "";
  for (let i = 0; i < 64; i += 4) {
    const nibble = bits.slice(i, i + 4);
    hex += parseInt(nibble, 2).toString(16);
  }
  return hex;
}

function hammingDistanceHex(a: string, b: string): number {
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    const ax = parseInt(a[i], 16);
    const bx = parseInt(b[i], 16);
    let x = ax ^ bx;
    // count bits in nibble
    dist += (x & 1) + ((x >> 1) & 1) + ((x >> 2) & 1) + ((x >> 3) & 1);
  }
  return dist;
}

async function extractExif(file: File): Promise<ImageExif | undefined> {
  try {
    // Lazy import to reduce initial bundle
    const exifr = await import("exifr");
    const data: any = await exifr.parse(file, ["Make", "Model", "CreateDate", "DateTimeOriginal"]);
    if (!data) return undefined;
    const date = (data.DateTimeOriginal || data.CreateDate)?.toString?.() || undefined;
    return { make: data.Make, model: data.Model, dateTime: date };
  } catch {
    return undefined;
  }
}

export async function analyzeFiles(files: File[]): Promise<ImageAnalysis[]> {
  const results: ImageAnalysis[] = [];

  // Analyze images sequentially to reduce memory spikes
  for (const file of files) {
    const objectUrl = URL.createObjectURL(file);
    try {
      const img = await createImage(objectUrl);

      const width = img.width;
      const height = img.height;
      const megapixels = (width * height) / 1_000_000;
      const aspectRatio = width / height;

      const scaled = drawToCanvas(img, 512);
      const { gray, width: gw, height: gh } = toGrayscale(scaled);
      const variance = laplacianVariance(gray, gw, gh);

      // Map variance to 0..100 roughly; tweakable
      const blurScore = Math.max(0, Math.min(100, (Math.log10(variance + 1) / 3) * 100));

      const exposure = exposureStats(scaled);

      const hashHex = dHashHex(img);

      const exif = await extractExif(file);

      const flags: string[] = [];
      if (blurScore < 35) flags.push("blurry");
      if (Math.min(width, height) < 800 || megapixels < 1.0) flags.push("low-resolution");
      if (exposure.overExposedPercent > 0.25) flags.push("overexposed");
      if (exposure.underExposedPercent > 0.25) flags.push("underexposed");

      results.push({
        id: crypto.randomUUID(),
        name: file.name,
        sizeBytes: file.size,
        width,
        height,
        aspectRatio,
        megapixels,
        blurVariance: variance,
        blurScore,
        exposure,
        exif,
        hashHex,
        flags,
        objectUrl,
      });
    } catch (e) {
      URL.revokeObjectURL(objectUrl);
      throw e;
    }
  }

  // Mark duplicates by comparing hashes; set threshold fairly strict
  const threshold = 5; // Hamming distance
  for (let i = 0; i < results.length; i++) {
    for (let j = i + 1; j < results.length; j++) {
      const a = results[i];
      const b = results[j];
      const dist = hammingDistanceHex(a.hashHex, b.hashHex);
      if (dist <= threshold) {
        b.flags.includes("duplicate") || b.flags.push("duplicate");
      }
    }
  }

  return results;
}

export function exportAnalysesToCSV(rows: ImageAnalysis[]): string {
  const header = [
    "name",
    "size_bytes",
    "width",
    "height",
    "megapixels",
    "aspect_ratio",
    "blur_score",
    "overexposed_pct",
    "underexposed_pct",
    "flags",
    "make",
    "model",
    "datetime",
    "hash_hex",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    const cols = [
      r.name,
      String(r.sizeBytes),
      String(r.width),
      String(r.height),
      r.megapixels.toFixed(2),
      r.aspectRatio.toFixed(4),
      r.blurScore.toFixed(0),
      (r.exposure.overExposedPercent * 100).toFixed(1),
      (r.exposure.underExposedPercent * 100).toFixed(1),
      r.flags.join("|"),
      r.exif?.make || "",
      r.exif?.model || "",
      r.exif?.dateTime || "",
      r.hashHex,
    ];
    // Simple CSV escaping
    lines.push(cols.map((c) => (/[,\"\n]/.test(c) ? `"${c.replace(/\"/g, '""')}"` : c)).join(","));
  }
  return lines.join("\n");
}
