import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import fsp from "fs/promises";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import fetch from "node-fetch";
import { existsSync } from "fs";

// =======================
// Setup FFmpeg
// =======================
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
console.log("🎬 Using ffmpeg from:", ffmpegInstaller.path);

const localFfmpeg = ffmpegInstaller.path;
const systemFfmpeg = "/usr/bin/ffmpeg";

let ffmpegPathToUse = existsSync(systemFfmpeg) ? systemFfmpeg : localFfmpeg;
ffmpeg.setFfmpegPath(ffmpegPathToUse);

console.log("🎬 ffmpeg path set to:", ffmpegPathToUse);

// =======================
// Senopati API helper
// =======================
const SENOPATI_BASE = "https://senopati.its.ac.id/senopati-lokal-dev";

async function senopatiGenerate(prompt, model = null) {
  const payload = { prompt };
  if (model) payload.model = model;

  const res = await fetch(`${SENOPATI_BASE}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const json = await res.json();
  return json.response || json.message || JSON.stringify(json);
}

// =======================
// Express setup
// =======================
const app = express();
const upload = multer({ dest: "/tmp" });
const PORT = process.env.PORT || 8080;

app.get("/", (req, res) => res.send("✅ Railway server is alive + Senopati ready!"));

// =======================
// Main /upload endpoint
// =======================
app.post("/upload", upload.single("file"), async (req, res) => {
  let filePath, audioPath;

  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();
    audioPath = filePath;

    // ✅ Convert video → audio (WAV 16k mono)
    if ([".mp4", ".mov", ".avi", ".mkv"].includes(ext)) {
      audioPath = filePath + ".wav";
      await new Promise((resolve, reject) => {
        ffmpeg(filePath)
          .audioChannels(1)
          .audioFrequency(16000)
          .toFormat("wav")
          .on("end", resolve)
          .on("error", reject)
          .save(audioPath);
      });
    }

    const geminiKey = process.env.GEMINI_API_KEY2;
    if (!geminiKey) {
      return res.status(500).json({ error: "Missing GEMINI_API_KEY2" });
    }

    const audioBase64 = fs.readFileSync(audioPath, { encoding: "base64" });

    // =======================
    // ✅ 1) Transkripsi pakai Gemini
    // =======================
    const transcriptRes = await fetch(
      "https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": geminiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: "Transkripsikan audio berikut dalam bahasa Indonesia:" },
                { inlineData: { mimeType: "audio/wav", data: audioBase64 } },
              ],
            },
          ],
        }),
      }
    );

    const transcriptJson = await transcriptRes.json();
    const transcript =
      transcriptJson?.candidates?.[0]?.content?.parts?.[0]?.text ||
      transcriptJson?.error?.message ||
      "Transkripsi gagal.";

    // =======================
    // ✅ 2) Ringkasan pakai Senopati
    // =======================
    const summary = await senopatiGenerate(
      `Ringkas teks berikut dalam poin bahasa Indonesia:\n\n${transcript}`,
      "qwen2.5:latest" // opsional (hapus jika tidak butuh)
    );

    res.json({
      status: "success",
      transcript,
      summary,
    });

  } catch (err) {
    console.error("🔥 Error in /upload:", err);
    res.status(500).json({ error: err.message });
  } finally {
    if (filePath) await fsp.unlink(filePath).catch(() => {});
    if (audioPath && audioPath !== filePath) await fsp.unlink(audioPath).catch(() => {});
  }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
