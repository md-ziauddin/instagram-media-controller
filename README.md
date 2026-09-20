# Instagram Reels & Video Controller (Chrome Extension)

A Manifest V3 Chrome Extension providing media controls, timeline seeking, playback speed adjustment, video quality indicators, and 1-click HD video downloads for Instagram.com.

---

## Features

- ⏯️ **Play / Pause**: Smooth playback toggling that won't trigger Instagram's conflicting background click handlers.
- ⏱️ **Timeline Scrubber**: Seek to any point in the reel, with real-time buffered progress and hover timestamp tooltips.
- ⚡ **Speed Control**: Switch playback speeds (`0.5x`, `0.75x`, `1.0x`, `1.25x`, `1.5x`, `1.75x`, `2.0x`) with automatic persistence.
- 📺 **Resolution Detection**: Inspects active video resolution (`1080p`, `720p`, `480p`) with stream switching when multi-bitrate sources are present.
- ⬇️ **HD Video Downloader**: Extracts highest-bitrate MP4 URLs from post metadata and saves videos locally via `chrome.downloads`.
- 🖼️ **Picture-in-Picture**: Watch reels in a floating window while browsing other tabs.
- ⌨️ **Keyboard Shortcuts**:
  - `Space` or `K`: Play / Pause
  - `←` / `→`: Seek backward / forward 5 seconds
  - `[` / `]`: Decrease / increase playback speed
  - `M`: Toggle mute
  - `D`: Download current reel
  - `P`: Picture-in-Picture

---

## Installation Guide

1. Open Google Chrome.
2. In the URL bar, go to `chrome://extensions/`.
3. Toggle on **Developer mode** in the top-right corner.
4. Click **Load unpacked** in the top-left corner.
5. Select this folder:
   ```
   /Users/mdziauddin/projects/chrome_extensions/instagram-media-controller
   ```
6. Navigate to `https://www.instagram.com/reels/` and enjoy full media controls!
