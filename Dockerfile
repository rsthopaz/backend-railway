# Gunakan base image Node.js versi 18
FROM node:18

# Install ffmpeg agar bisa digunakan fluent-ffmpeg
RUN apt-get update && apt-get install -y ffmpeg

# Set direktori kerja di dalam container
WORKDIR /app

# Copy semua file project ke container
COPY . .

# Install dependencies
RUN npm install

# Expose port aplikasi (Railway otomatis membaca ENV PORT)
EXPOSE 8080

# Jalankan aplikasi
CMD ["npm", "start"]
