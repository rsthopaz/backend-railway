import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import fsp from "fs/promises";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import fetch from "node-fetch";

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const upload = multer({ dest: "/tmp" });
const PORT = process.env.PORT || 8080;

app.get("/", (req, res) => res.send("✅ Railway server is alive"));

app.post("/upload", upload.single("file"), async (req, res) => {
  let filePath, audioPath;
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();
    audioPath = filePath;

    // convert video → audio (jika perlu)
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

    const geminiKey = process.env.GEMINI_API_KEY;
    console.log("Using Gemini Key:", geminiKey ? "✅ Loaded" : "❌ Not Found");

    const audioBase64 = fs.readFileSync(audioPath, { encoding: "base64" });

    // === Transkripsi ===
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

    // === Ringkasan ===
    const summaryRes = await fetch(
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
                {
                  text: `Ringkas teks berikut dalam bahasa Indonesia dalam bentuk poin-poin mudah dipahami:\n\n${transcript}`,
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
      "Ringkasan gagal.";

    res.json({ transcript, summary });
  } catch (err) {
    console.error("🔥 Error in /upload:", err);
    res.status(500).json({ error: err.message });
  } finally {
    if (filePath) await fsp.unlink(filePath).catch(() => {});
    if (audioPath && audioPath !== filePath) await fsp.unlink(audioPath).catch(() => {});
  }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
