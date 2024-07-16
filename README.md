# YouTube Video Downloader Backend

This project provides a backend service for downloading YouTube videos and audio using `ytdl-core` and `ffmpeg`. The backend handles fetching video details, downloading video and audio streams, and merging them if needed.

## Features

- Fetch video details including available formats
- Download video and audio streams
- Merge video and audio streams
- Rate limiting to prevent abuse

## Prerequisites

- Node.js (>= v14)
- FFmpeg

## Installation

1. Clone the repository:
   ```
   git clone https://github.com/kamrancodex/yt-video-downloader-backend.git
   cd yt-video-downloader-backend 
Install dependencies:

```
npm install
```

Ensure FFmpeg is installed and its path is set correctly.

Configuration
Create a .env file in the root directory and add the following configuration variables:

```
PORT=3000
RATE_LIMIT_WINDOW=15 * 60 * 1000 // 15 minutes
RATE_LIMIT_MAX=100 // limit each IP to 100 requests per windowMs
```
Usage
Start the server:

```
node index.js
```
The server will start listening on the port specified in the .env file or default to 3000.

API Endpoints

Fetch Video Details
```
URL: /api/v1/downloads/video
Method: POST
Body:
json
Copy code
{
  "url": "https://www.youtube.com/watch?v=example"
}
Response:
json
Copy code
{
  "title": "Video Title",
  "thumbnail": "https://img.youtube.com/vi/example/maxresdefault.jpg",
  "formats": [
    {
      "qualityLabel": "1080p",
      "itag": 137,
      "container": "mp4"
    },
    ...
  ],
  "audioFormats": [
    {
      "bitrate": 128,
      "itag": 140,
      "container": "mp4"
    },
    ...
  ],
  "downloadVideoBase": "/api/v1/downloads/video/download?url=https://www.youtube.com/watch?v=example&itag=",
  "downloadAudioBase": "/api/v1/downloads/audio/download?url=https://www.youtube.com/watch?v=example&itag="
}
Download Video
URL: /api/v1/downloads/video/download
Method: GET
Query Params:
url: The encoded URL of the YouTube video.
itag: The itag of the video format to download.
Response: The video file.
Download Audio
URL: /api/v1/downloads/audio/download
Method: GET
Query Params:
url: The encoded URL of the YouTube video.
itag: The itag of the audio format to download.
Response: The audio file.
Pause Download
URL: /api/v1/downloads/video/pause
Method: POST
Body:
json
Copy code
{
  "taskId": "video-url-itag"
}
Response: 200 OK if paused successfully, 404 Not Found if the task ID is invalid.
Resume Download
URL: /api/v1/downloads/video/resume
Method: POST
Body:
json
Copy code
{
  "taskId": "video-url-itag"
}
Response: 200 OK if resumed successfully, 404 Not Found if the task ID is invalid.
Cancel Download
URL: /api/v1/downloads/video/cancel
Method: POST
Body:
json
Copy code
{
  "taskId": "video-url-itag"
}
Response: 200 OK if canceled successfully, 404 Not Found if the task ID is invalid.
```
Contributing
Feel free to fork this repository and submit pull requests. Any contributions are welcome!

**Hosted the frontend on digital ocean droplet **
```
ytclip.live
```
**I HOSTED THE BACKEND ON DIGITAL OCEAN AND AWS AS WELL**
```
https://ytclipbackend.online/
```
Note:Im first time deploying to vps ssh etc so i did *** the code in process so im now going to learn about hosting
