FROM node:18-slim
# Install ffmpeg
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
COPY index.js ./
EXPOSE 3001
CMD ["node", "index.js"]
