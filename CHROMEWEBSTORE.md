# Chrome Web Store Listing: Instagram Reels & Video Controller

## Store Listing Metadata

- **Name**: Instagram Reels & Video Controller
- **Summary / Short Description**: Enhance Instagram Reels and videos with play/pause, timeline scrubber, playback speed controls, quality indicators, and 1-click HD video downloads.
- **Category**: Productivity / Photos & Video
- **Language**: English

---

## Detailed Description

Take full control of your Instagram video watching experience. By default, Instagram Reels and feed videos only provide a simple audio mute/unmute button without the ability to seek, adjust playback speed, or download videos. 

**Instagram Reels & Video Controller** injects a sleek, native-style media control bar on Instagram.com that lets you watch content on your own terms.

### Key Features:
- ⏯️ **Play & Pause**: Smoothly toggle video playback with dedicated buttons or hotkeys without triggering Instagram's default mute or like actions.
- ⏱️ **Timeline Scrubber & Seeking**: Full interactive progress bar with time display (current / total duration), buffered stream indicators, and timestamp previews on hover. Click or drag anywhere along the track to seek.
- ⚡ **Playback Speed Control**: Watch reels at 0.5x, 0.75x, 1x, 1.25x, 1.5x, 1.75x, or 2x speed. Easily cycle speeds or set your preferred default speed.
- 📺 **Resolution & Quality Info**: Displays the video's active resolution (1080p HD, 720p, 480p) and offers quality stream switching where available.
- ⬇️ **One-Click HD Video Downloader**: Download any Instagram Reel or video post in the highest available MP4 resolution directly to your computer.
- 🖼️ **Picture-in-Picture (PiP)**: Pop videos out into a floating window to multitask across other tabs.
- ⌨️ **Keyboard Hotkeys**:
  - `Space`: Play / Pause
  - `A` / `D`: Seek backward / forward 5 seconds
  - `[` / `]`: Decrease / increase playback speed
  - `M`: Toggle mute
  - `S`: Download current video
  - `P`: Toggle Picture-in-Picture

---

## Permissions Justification

| Permission / Host | Plain-English Justification for Review Team |
| :--- | :--- |
| `downloads` | Required to initiate the download of the selected video file to the user's local disk when they explicitly click the download button or press the download shortcut. |
| `storage` | Used exclusively to save user preferences locally, such as the default playback speed (`defaultSpeed`). No personally identifiable information is stored. |
| `*://*.instagram.com/*` | Required to inject the media controller interface, progress bar, and keyboard listener onto Instagram video and Reels pages. |
| `*://*.cdninstagram.com/*` | Required to allow fetching direct video media streams and downloading high-resolution MP4 files hosted on Instagram's content delivery network. |
| `*://*.fbcdn.net/*` | Required to allow fetching direct video media streams and downloading high-resolution MP4 files hosted on Meta's Facebook CDN infrastructure. |

---

## Single Purpose Description

This extension serves a single dedicated purpose: to provide media playback controls (play/pause, timeline seeking, speed adjustment) and video downloading for videos on Instagram.com.

---

## Privacy & Data Use Disclosure

- **Data Collection**: This extension collects **NO** personal data, browsing history, authentication credentials, or user analytics.
- **Data Transmission**: No data is ever sent to external servers or third-party trackers. All communication remains strictly local between the user's browser and Instagram's public CDN endpoints.
- **Local Storage**: Only stores user UI preferences (such as playback speed).

---

## Version History

- **1.0.0** (Initial Release):
  - Injected glassmorphic media controller overlay on Instagram Reels and video posts.
  - Interactive timeline scrubber with hover timestamp preview.
  - Playback speed control (0.5x to 2x) with persistence.
  - Video resolution detector and quality switcher.
  - One-click HD MP4 downloader via `chrome.downloads`.
  - Full keyboard shortcuts support and popup settings.
