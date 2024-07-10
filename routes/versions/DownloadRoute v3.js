const express = require("express");
const ytdl = require("ytdl-core");
const ytpl = require("ytpl");
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

  router.post("/playlist", cache, async (req, res) => {
    const { url } = req.body;
    if (!url || !ytpl.validateID(url)) {
      console.log("Invalid YouTube Playlist URL:", url);
      return res.status(400).send("Invalid YouTube Playlist URL");
    }

    try {
      const playlist = await ytpl(url);
      const videos = await Promise.all(
        playlist.items.map(async (item) => {
          const info = await ytdl.getInfo(item.shortUrl);
          const videoFormats = ytdl.filterFormats(info.formats, "videoonly");

          return {
            title: item.title,
            url: item.shortUrl,
            thumbnails: item.thumbnails,
            formats: videoFormats.map((format) => ({
              qualityLabel: format.qualityLabel,
              itag: format.itag,
              container: format.container,
            })),
            downloadVideoBase: `/api/v1/downloads/video/download?url=${encodeURIComponent(
              item.shortUrl
            )}&itag=`,
          };
        })
      );

      const allFormats = videos.flatMap((video) => video.formats);
      const uniqueFormats = Array.from(
        new Set(allFormats.map((format) => format.itag))
      ).map((itag) => allFormats.find((format) => format.itag === itag));

      const response = {
        title: playlist.title,
        videos,
        formats: uniqueFormats,
      };

      await client.set(url, JSON.stringify(response), "EX", 3600); // Cache for 1 hour

      res.status(200).json(response);
    } catch (error) {
      console.error("Failed to fetch playlist details:", error);
      res.status(500).send("Failed to fetch playlist details");
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
    const { url, itag } = req.query;
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
              ffmpeg()
                .input(videoPath)
                .input(audioPath)
                .outputOptions("-c:v copy")
                .outputOptions("-c:a aac")
                .save(outputPath)
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

  router.get("/audio/download", async (req, res) => {
    const { url, itag } = req.query;
    if (!url || !validateYouTubeUrl(url)) {
      console.log("Invalid YouTube URL:", url);
      return res.status(400).send("Invalid YouTube URL");
    }

    try {
      console.log("Fetching audio info for URL:", url);
      const info = await ytdl.getInfo(url);
      const format = info.formats.find((f) => f.itag.toString() === itag);
      if (!format) {
        console.log("Desired quality not found for itag:", itag);
        return res.status(500).send("Desired quality not found");
      }

      console.log("Downloading audio with itag:", itag);

      res.header("Content-Disposition", 'attachment; filename="audio.mp3"');
      ytdl(url, { quality: itag }).pipe(res);
    } catch (error) {
      console.error("Error downloading audio:", error);
      res.status(500).send("Error downloading audio");
    }
  });

  // Pause, resume, and cancel endpoints
  router.post("/video/pause", (req, res) => {
    const { taskId } = req.body;
    if (downloadTasks[taskId]) {
      downloadTasks[taskId].videoStream.pause();
      downloadTasks[taskId].audioStream.pause();
      res.status(200).send("Download paused");
    } else {
      res.status(404).send("Task not found");
    }
  });

  router.post("/video/resume", (req, res) => {
    const { taskId } = req.body;
    if (downloadTasks[taskId]) {
      downloadTasks[taskId].videoStream.resume();
      downloadTasks[taskId].audioStream.resume();
      res.status(200).send("Download resumed");
    } else {
      res.status(404).send("Task not found");
    }
  });

  router.post("/video/cancel", (req, res) => {
    const { taskId } = req.body;
    if (downloadTasks[taskId]) {
      downloadTasks[taskId].videoStream.destroy();
      downloadTasks[taskId].audioStream.destroy();
      fs.unlinkSync(downloadTasks[taskId].videoPath);
      fs.unlinkSync(downloadTasks[taskId].audioPath);
      fs.unlinkSync(downloadTasks[taskId].outputPath);
      delete downloadTasks[taskId];
      res.status(200).send("Download canceled");
    } else {
      res.status(404).send("Task not found");
    }
  });

  return router;
};
