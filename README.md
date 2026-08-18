# Orvonex — YouTube & Spotify to MP3

A fast, customizable audio converter for downloading and processing music from YouTube and Spotify links. Choose your audio quality, adjust playback, modify pitch, normalize volume, and manage multiple tracks from a real-time queue.

## Tech Stack

* **Node.js** — Backend & server
* **Python 3** — Media processing
* **yt-dlp** — Media extraction
* **FFmpeg** — Audio conversion & processing
* **WebSocket** — Real-time conversion progress

## Features

* YouTube videos & playlists
* Spotify links
* Custom audio bitrate:

  * 128 kbps
  * 192 kbps
  * 256 kbps
  * 320 kbps
* Playback speed control — `0.5×` to `2.0×`
* Pitch shifting — `±12` semitones
* EBU R128 volume normalization
* Real-time conversion progress via WebSocket
* Multi-track download queue
* Track selection with checkboxes
* Automatic audio conversion through FFmpeg

## Requirements

* **Node.js 18+**
* **Python 3**
* **yt-dlp**
* **FFmpeg**

### Install yt-dlp

```bash
pip install yt-dlp
```

### Install FFmpeg

**Ubuntu / Debian:**

```bash
sudo apt update
sudo apt install ffmpeg
```

**macOS:**

```bash
brew install ffmpeg
```

**Windows:**

Install FFmpeg and make sure it is available in your system `PATH`.

## Installation

Clone the repository and install the Node.js dependencies:

```bash
git clone <your-repository-url>
cd wavr
npm install
```

## Running

Start the server:

```bash
node server.js
```

Then open:

```text
http://localhost:3000
```

## How It Works

1. Paste a supported YouTube or Spotify link.
2. Select the tracks you want to process.
3. Configure bitrate and audio effects.
4. Add tracks to the queue.
5. Wavr processes the audio using `yt-dlp` and FFmpeg.
6. Monitor conversion progress in real time.
7. Download the finished MP3 files.

## Project Structure

```text
wavr/
├── server.js
├── package.json
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── downloads/
└── README.md
```

## Notes

Wavr is intended for downloading and converting content that you have permission to access or convert. Respect the terms of service and copyright laws applicable to the content you process.

## License

Add your preferred license here, such as **MIT**, if you intend to open-source the project.
