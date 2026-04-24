import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "seedance-story";
}

export function nowStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function writeText(filePath: string, value: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, value, "utf8");
}

export async function readJson<T>(filePath: string): Promise<T> {
  const content = await readFile(filePath, "utf8");
  return JSON.parse(content) as T;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(new Error("Operation aborted."));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

export function estimateSentenceSplits(text: string): string[] {
  return text
    .split(/(?<=[。！？!?；;])/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function chunkByCount<T>(items: T[], chunkCount: number): T[][] {
  if (items.length === 0) {
    return [];
  }
  if (chunkCount <= 1) {
    return [items];
  }

  const chunks: T[][] = [];
  let start = 0;
  for (let i = 0; i < chunkCount; i += 1) {
    const remainingItems = items.length - start;
    const remainingChunks = chunkCount - i;
    const size = Math.ceil(remainingItems / remainingChunks);
    chunks.push(items.slice(start, start + size));
    start += size;
  }
  return chunks.filter((chunk) => chunk.length > 0);
}

export async function downloadToFile(url: string, destination: string, signal?: AbortSignal): Promise<void> {
  const response = await fetch(url, { signal });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }
  await ensureDir(path.dirname(destination));

  await new Promise<void>((resolve, reject) => {
    const readable = Readable.fromWeb(response.body as unknown as NodeReadableStream);
    const writable = createWriteStream(destination);
    readable.on("error", reject);
    writable.on("error", reject);
    writable.on("finish", () => resolve());
    readable.pipe(writable);
  });
}

export function collectUrls(payload: unknown): { videoUrl?: string; previewImageUrl?: string; lastFrameUrl?: string } {
  const found: string[] = [];

  const visit = (value: unknown): void => {
    if (!value) {
      return;
    }
    if (typeof value === "string") {
      if (value.startsWith("http")) {
        found.push(value);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value === "object") {
      Object.values(value as Record<string, unknown>).forEach(visit);
    }
  };

  visit(payload);

  const videoUrl = found.find((item) => /\.(mp4|mov|webm)(\?|$)/i.test(item));
  const lastFrameUrl =
    found.find((item) => /last[_-]?frame/i.test(item)) ||
    found.find((item) => /\.(jpg|jpeg|png|webp)(\?|$)/i.test(item) && /last/i.test(item));
  const previewImageUrl =
    found.find((item) => /\.(jpg|jpeg|png|webp)(\?|$)/i.test(item) && item !== lastFrameUrl) ||
    lastFrameUrl;

  return { videoUrl, previewImageUrl, lastFrameUrl };
}

export function pickString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
