import express from "express";
import multer from "multer";
import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import fetch from "node-fetch";

ffmpeg.setFfmpegPath(ffmpegPath); // gunakan ffmpeg-static yang cocok untuk Railway

const app = express();
const upload = multer({ dest: "/tmp" }); // lokasi penyimpanan sementara
const PORT = process.env.PORT || 3000;

// === Route utama ===
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();
    let audioPath = filePath;

    // Konversi ke WAV kalau input berupa video
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

    // Jalankan whisper-cli (pastikan sudah build di folder whisper)
const whisperPath = path.join(process.cwd(), "whisper/whisper.cpp/build/bin/whisper-cli");
const modelPath = path.join(process.cwd(), "whisper/whisper.cpp/models/ggml-small.bin");


    const whisperProc = spawn(whisperPath, [
      "-m",
      modelPath,
      "-f",
      audioPath,
      "-otxt",
    ]);

    let stderr = "";
    whisperProc.stderr.on("data", (data) => (stderr += data.toString()));

    await new Promise((resolve, reject) => {
      whisperProc.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(stderr))
      );
    });

    // Baca hasil transkrip dari file .txt (hasil whisper)
    const transcriptPath = audioPath + ".txt";
    let transcript = "Transkrip tidak ditemukan.";
    try {
      transcript = await fs.readFile(transcriptPath, "utf-8");
    } catch {}

    // Panggil API Gemini untuk meringkas hasil
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
                {
                  text: `Ringkas teks berikut dalam bahasa Indonesia:\n\n${transcript}`,
                },
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
    await fs.unlink(transcriptPath).catch(() => {});

    return res.json({ transcript, summary });
  } catch (err) {
    console.error("Error in /upload:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
