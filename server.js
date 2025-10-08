import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import fetch from "node-fetch";
import OpenAI from "openai";

ffmpeg.setFfmpegPath(ffmpegPath);
const app = express();
const upload = multer({ dest: "/tmp" });
const PORT = process.env.PORT || 3000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// === Route utama ===
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();
    let audioPath = filePath;

    // Jika input berupa video, konversi ke WAV
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

    // Transkripsi menggunakan OpenAI Whisper API
    const audioStream = await fs.readFile(audioPath);
    const result = await openai.audio.transcriptions.create({
      file: new Blob([audioStream]),
      model: "whisper-1",
    });

    const transcript = result.text;

    // Ringkas hasil dengan Gemini API
    const geminiKey = process.env.GEMINI_API_KEY;
    const summaryRes = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-goog-api-key": geminiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: `Ringkas teks berikut dalam bahasa Indonesia:\n\n${transcript}` },
              ],
            },
          ],
        }),
      }
    );

    const summaryJson = await summaryRes.json();
    const summary =
      summaryJson?.candidates?.[0]?.content?.parts?.[0]?.text ||
      summaryJson?.error?.message ||
      "Ringkasan tidak ditemukan.";

    // Hapus file sementara
    await fs.unlink(filePath).catch(() => {});
    await fs.unlink(audioPath).catch(() => {});

    res.json({ transcript, summary });
  } catch (err) {
    console.error("Error in /upload:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
