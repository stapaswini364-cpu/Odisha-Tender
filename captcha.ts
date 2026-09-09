import { createWorker } from "tesseract.js";

export async function solveCaptcha(imageBuffer: Buffer): Promise<string> {
  const worker = await createWorker("eng");

  try {
    const { data } = await worker.recognize(imageBuffer);

    const text = data.text
      .replace(/[^a-zA-Z0-9]/g, "")
      .trim();

    console.log("CAPTCHA OCR result:", text);

    return text;
  } finally {
    await worker.terminate();
  }
}