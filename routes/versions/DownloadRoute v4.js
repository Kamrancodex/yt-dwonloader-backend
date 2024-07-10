const express = require("express");
const ytdl = require("ytdl-core");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const tmp = require("tmp");
const fs = require("fs");
const { cache, client } = require("../../middleware/cache");
const limiter = require("../../middleware/rateLimiter");

ffmpeg.setFfmpegPath(ffmpegPath);

const validateYouTubeUrl = (url) => ytdl.validateURL(url);

module.exports = (io) => {
  const router = express.Router();
  router.use(limiter);

  let downloadTasks = {}; // Track download tasks

  router.post("/video", cache, async (req, res) => {
    const { url } = req.body;
    if (!url || !validateYouTubeUrl(url)) {
      console.log("Invalid YouTube URL:", url);
      return res.status(400).send("Invalid YouTube URL");
    }

    try {
      const info = await ytdl.getInfo(url);
      const videoFormats = ytdl.filterFormats(info.formats, "videoonly");
      const audioFormats = ytdl.filterFormats(info.formats, "audioonly");

      const availableVideoFormats = videoFormats.map((format) => ({
        qualityLabel: format.qualityLabel,
        itag: format.itag,
        container: format.container,
      }));

      const availableAudioFormats = audioFormats.map((format) => ({
        bitrate: format.audioBitrate,
        itag: format.itag,
        container: format.container,
      }));

      const encodedUrl = encodeURIComponent(url);

      const response = {
        title: info.videoDetails.title,
        thumbnail: info.videoDetails.thumbnails[0].url,
        formats: availableVideoFormats,
        audioFormats: availableAudioFormats,
        downloadVideoBase: `/api/v1/downloads/video/download?url=${encodedUrl}&itag=`,
        downloadAudioBase: `/api/v1/downloads/audio/download?url=${encodedUrl}&itag=`,
      };

      // Cache the response
      await client.set(url, JSON.stringify(response), "EX", 3600); // Cache for 1 hour

      res.status(200).json(response);
    } catch (error) {
      console.error("Failed to fetch video details:", error);
      res.status(500).send("Failed to fetch video details");
    }
  });

  const createDownloadTask = (url, itag, videoPath, audioPath, outputPath) => {
    const videoStream = ytdl(url, { quality: itag });
    const audioStream = ytdl(url, { filter: "audioonly" });

    return {
      videoStream,
      audioStream,
      videoPath,
      audioPath,
      outputPath,
    };
  };

  router.get("/video/download", async (req, res) => {
    const { url, itag, startTime, duration } = req.query;
    if (!url || !validateYouTubeUrl(url)) {
      console.log("Invalid YouTube URL:", url);
      return res.status(400).send("Invalid YouTube URL");
    }

    try {
      const videoPath = tmp.tmpNameSync({ postfix: ".mp4" });
      const audioPath = tmp.tmpNameSync({ postfix: ".mp3" });
      const outputPath = tmp.tmpNameSync({ postfix: ".mp4" });

      const taskId = `${url}-${itag}`;
      downloadTasks[taskId] = createDownloadTask(
        url,
        itag,
        videoPath,
        audioPath,
        outputPath
      );

      console.log(`Downloading video with itag: ${itag}`);
      downloadTasks[taskId].videoStream
        .on("progress", (_, downloaded, total) => {
          const progress = (downloaded / total) * 100;
          io.emit("progress", { taskId, progress, step: "Downloading video" });
        })
        .pipe(fs.createWriteStream(videoPath))
        .on("finish", async () => {
          console.log(`Downloading audio`);
          downloadTasks[taskId].audioStream
            .pipe(fs.createWriteStream(audioPath))
            .on("finish", async () => {
              console.log(`Merging video and audio`);
              io.emit("progress", { taskId, progress: 100, step: "Merging" });

              const ffmpegCommand = ffmpeg()
                .input(videoPath)
                .input(audioPath)
                .outputOptions("-c:v copy")
                .outputOptions("-c:a aac");

              if (startTime && duration) {
                console.log(
                  `Applying crop with startTime: ${startTime} and duration: ${duration}`
                );
                ffmpegCommand.setStartTime(startTime).duration(duration);
              }

              ffmpegCommand
                .save(outputPath)
                .on("start", (commandLine) => {
                  console.log(`FFmpeg command: ${commandLine}`);
                })
                .on("progress", (progress) => {
                  io.emit("progress", {
                    taskId,
                    progress: progress.percent,
                    step: "Merging",
                  });
                })
                .on("end", () => {
                  console.log(`Merged file created: ${outputPath}`);
                  res.download(outputPath, "video.mp4", (err) => {
                    if (err) {
                      console.error("Error sending file:", err);
                    }
                    fs.unlinkSync(videoPath);
                    fs.unlinkSync(audioPath);
                    fs.unlinkSync(outputPath);
                    delete downloadTasks[taskId];
                  });
                })
                .on("error", (err) => {
                  console.error("Error during merging:", err);
                  res.status(500).send("Error during merging");
                  fs.unlinkSync(videoPath);
                  fs.unlinkSync(audioPath);
                  fs.unlinkSync(outputPath);
                  delete downloadTasks[taskId];
                });
            })
            .on("error", (err) => {
              console.error("Error downloading audio:", err);
              res.status(500).send("Error downloading audio");
              fs.unlinkSync(videoPath);
              fs.unlinkSync(audioPath);
              fs.unlinkSync(outputPath);
              delete downloadTasks[taskId];
            });
        })
        .on("error", (err) => {
          console.error("Error downloading video:", err);
          res.status(500).send("Error downloading video");
          fs.unlinkSync(videoPath);
          fs.unlinkSync(audioPath);
          fs.unlinkSync(outputPath);
          delete downloadTasks[taskId];
        });
    } catch (error) {
      console.error("Error downloading video:", error);
      res.status(500).send("Error downloading video");
    }
  });

  return router;
};
