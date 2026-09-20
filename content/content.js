/**
 * Instagram Reels & Video Controller - Content Script
 * Uses Screen Center targeting to lock strictly onto the visible playing reel,
 * eliminating interference from preloaded off-screen next/previous reels.
 */
(() => {
  'use strict';

  console.log('[IG Media Controller] Initializing Screen-Center Video Controller...');

  // Inject MAIN world script to access React Fiber and intercept network metadata
  function injectPageScript() {
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('content/page-script.js');
      script.onload = () => script.remove();
      (document.head || document.documentElement).appendChild(script);
    } catch (err) {
      console.warn('[IG Media Controller] Page script injection error:', err);
    }
  }
  injectPageScript();

  // SVG Icons
  const ICONS = {
    play: `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`,
    pause: `<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`,
    volumeUp: `<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`,
    volumeMute: `<svg viewBox="0 0 24 24"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>`,
    download: `<svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>`,
    spinner: `<svg viewBox="0 0 24 24"><path d="M12 4V2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8z"/></svg>`,
    pip: `<svg viewBox="0 0 24 24"><path d="M19 7h-8v6h8V7zm2-4H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16.01H3V4.99h18v14.02z"/></svg>`
  };

  const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  let defaultSpeed = 1.0;
  let activeVideo = null;
  let activeMetadata = null;
  let isSeeking = false;
  let idleTimeout = null;
  const metadataRequests = new Map();

  // Load saved preferences
  chrome.storage.local.get(['defaultSpeed'], (res) => {
    if (res.defaultSpeed) {
      defaultSpeed = parseFloat(res.defaultSpeed) || 1.0;
      if (activeVideo) {
        activeVideo.playbackRate = defaultSpeed;
        if (ui.speedBtn) ui.speedBtn.textContent = `${defaultSpeed}x`;
      }
    }
  });

  // Listen for metadata responses from page-script.js
  window.addEventListener('message', (event) => {
    if (!event.data || event.data.source !== 'IG_CONTROLLER_PAGE') return;

    if (event.data.action === 'METADATA_RESPONSE') {
      const { requestId, metadata } = event.data;
      const callback = metadataRequests.get(requestId);
      if (callback) {
        callback(metadata);
        metadataRequests.delete(requestId);
      }
    }
  });

  function requestVideoMetadata(video) {
    return new Promise((resolve) => {
      const requestId = 'req_' + Math.random().toString(36).substr(2, 9);
      metadataRequests.set(requestId, resolve);

      setTimeout(() => {
        if (metadataRequests.has(requestId)) {
          metadataRequests.delete(requestId);
          resolve(null);
        }
      }, 900);

      const shortcode = getShortcodeForVideo(video);

      window.postMessage({
        source: 'IG_CONTROLLER_CONTENT',
        action: 'GET_VIDEO_METADATA',
        requestId,
        shortcode
      }, '*');
    });
  }

  // Extract shortcode specifically from the container of the CURRENT video
  function getShortcodeForVideo(video) {
    if (!video) return '';

    // 1. Check article or container holding the video
    const article = video.closest('article') || video.closest('div[role="presentation"]') || video.closest('div[role="dialog"]') || video.parentElement?.parentElement?.parentElement;
    if (article) {
      const links = article.querySelectorAll('a[href*="/reel/"], a[href*="/p/"]');
      for (const link of links) {
        const href = link.getAttribute('href') || '';
        const m = href.match(/\/(?:reels|reel|p)\/([^/?#]+)/);
        if (m && m[1] && m[1] !== 'reels') return m[1];
      }
    }

    // 2. Check window.location.pathname
    const pathMatch = window.location.pathname.match(/\/(?:reels|reel|p)\/([^/?#]+)/);
    if (pathMatch && pathMatch[1] && pathMatch[1] !== 'reels') return pathMatch[1];

    return '';
  }

  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  function showToast(message, type = 'info') {
    let container = document.querySelector('.ig-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'ig-toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `ig-toast ig-toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'ig-toast-out 0.25s forwards';
      setTimeout(() => toast.remove(), 260);
    }, 2800);
  }

  // UI elements holder
  const ui = {};

  // Build the single Root Controller in document.body
  function buildRootController() {
    let controller = document.querySelector('.ig-media-controller');
    if (controller) {
      ui.controller = controller;
      return;
    }

    controller = document.createElement('div');
    controller.className = 'ig-media-controller ig-hidden';

    controller.innerHTML = `
      <div class="ig-timeline-container">
        <div class="ig-timeline-track">
          <div class="ig-timeline-buffer"></div>
          <div class="ig-timeline-progress"></div>
          <div class="ig-timeline-thumb"></div>
        </div>
        <div class="ig-time-tooltip">0:00</div>
      </div>

      <div class="ig-controls-row">
        <div class="ig-controls-left">
          <button class="ig-btn ig-btn-play" title="Play / Pause (Space)">
            ${ICONS.play}
          </button>
          <button class="ig-btn ig-btn-volume" title="Mute / Unmute (M)">
            ${ICONS.volumeUp}
          </button>
          <span class="ig-time-display">0:00 / 0:00</span>
        </div>

        <div class="ig-controls-right">
          <div style="position: relative;">
            <button class="ig-badge-btn ig-btn-speed" title="Playback Speed ([ / ])">
              ${defaultSpeed}x
            </button>
            <div class="ig-popover-menu ig-speed-menu">
              ${SPEED_OPTIONS.map(s => `
                <button class="ig-popover-item ${s === defaultSpeed ? 'ig-selected' : ''}" data-speed="${s}">
                  ${s}x
                </button>
              `).join('')}
            </div>
          </div>

          <div style="position: relative;">
            <button class="ig-badge-btn ig-btn-quality" title="Video Quality">
              Auto
            </button>
            <div class="ig-popover-menu ig-quality-menu"></div>
          </div>

          <button class="ig-btn ig-btn-pip" title="Picture in Picture (P)">
            ${ICONS.pip}
          </button>

          <button class="ig-btn ig-btn-download" title="Download Reel (S)">
            ${ICONS.download}
          </button>
        </div>
      </div>
    `;

    // Stop bubbling in BUBBLE phase only so clicks do not reach Instagram containers
    ['click', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'dblclick'].forEach(evt => {
      controller.addEventListener(evt, (e) => {
        e.stopPropagation();
      }, false);
    });

    document.body.appendChild(controller);

    // Cache UI references
    ui.controller = controller;
    ui.playBtn = controller.querySelector('.ig-btn-play');
    ui.volumeBtn = controller.querySelector('.ig-btn-volume');
    ui.timeDisplay = controller.querySelector('.ig-time-display');
    ui.timelineContainer = controller.querySelector('.ig-timeline-container');
    ui.timelineTrack = controller.querySelector('.ig-timeline-track');
    ui.progressBar = controller.querySelector('.ig-timeline-progress');
    ui.bufferBar = controller.querySelector('.ig-timeline-buffer');
    ui.thumb = controller.querySelector('.ig-timeline-thumb');
    ui.tooltip = controller.querySelector('.ig-time-tooltip');
    ui.speedBtn = controller.querySelector('.ig-btn-speed');
    ui.speedMenu = controller.querySelector('.ig-speed-menu');
    ui.qualityBtn = controller.querySelector('.ig-btn-quality');
    ui.qualityMenu = controller.querySelector('.ig-quality-menu');
    ui.pipBtn = controller.querySelector('.ig-btn-pip');
    ui.downloadBtn = controller.querySelector('.ig-btn-download');

    bindControllerEvents();
    console.log('[IG Media Controller] Controller UI mounted to document.body');
  }

  function bindControllerEvents() {
    // Play / Pause
    ui.playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePlay();
    });

    // Volume / Mute
    ui.volumeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMute();
    });

    // Scrubber Seeking
    ui.timelineContainer.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      startSeek(e);
    });

    ui.timelineContainer.addEventListener('mousemove', (e) => {
      e.stopPropagation();
      hoverTimeline(e);
    });

    // Speed Menu
    ui.speedBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMenus(ui.speedMenu);
      ui.speedMenu.classList.toggle('ig-show');
      ui.controller.classList.toggle('ig-menu-open', ui.speedMenu.classList.contains('ig-show'));
    });

    ui.speedMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = e.target.closest('.ig-popover-item');
      if (item && item.dataset.speed) {
        const s = parseFloat(item.dataset.speed);
        setSpeed(s);
        ui.speedMenu.classList.remove('ig-show');
        ui.controller.classList.remove('ig-menu-open');
      }
    });

    // Quality Menu
    ui.qualityBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMenus(ui.qualityMenu);
      ui.qualityMenu.classList.toggle('ig-show');
      ui.controller.classList.toggle('ig-menu-open', ui.qualityMenu.classList.contains('ig-show'));
    });

    ui.qualityMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = e.target.closest('.ig-popover-item');
      if (item && (item.dataset.tier || item.dataset.url)) {
        switchQuality(item.dataset.url, item.dataset.tier || item.dataset.label);
        ui.qualityMenu.classList.remove('ig-show');
        ui.controller.classList.remove('ig-menu-open');
      }
    });

    // Picture in Picture
    ui.pipBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      togglePiP();
    });

    // Download Video
    ui.downloadBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      downloadVideo();
    });

    // Close menus on outside click
    document.addEventListener('click', () => {
      closeMenus();
    });

    // Idle hide management
    ui.controller.addEventListener('mousemove', () => resetIdleTimer());
  }

  function closeMenus(except = null) {
    if (ui.speedMenu && ui.speedMenu !== except) ui.speedMenu.classList.remove('ig-show');
    if (ui.qualityMenu && ui.qualityMenu !== except) ui.qualityMenu.classList.remove('ig-show');
    if (!except && ui.controller) ui.controller.classList.remove('ig-menu-open');
  }

  function resetIdleTimer() {
    if (!ui.controller) return;
    ui.controller.classList.remove('ig-idle');
    clearTimeout(idleTimeout);

    if (activeVideo && !activeVideo.paused && !isSeeking) {
      idleTimeout = setTimeout(() => {
        if (!ui.controller.matches(':hover') && !ui.controller.classList.contains('ig-menu-open')) {
          ui.controller.classList.add('ig-idle');
        }
      }, 2500);
    }
  }

  function togglePlay() {
    const video = getTargetVideo();
    if (!video) return;

    if (video.paused) {
      video.play().then(() => {
        updatePlayState();
      }).catch(err => {
        console.warn('[IG Media Controller] play() error:', err);
      });
    } else {
      video.pause();
      updatePlayState();
    }
  }

  function toggleMute() {
    const video = getTargetVideo();
    if (!video) return;

    video.muted = !video.muted;
    updateVolumeState();
    showToast(video.muted ? 'Muted' : 'Unmuted');
  }

  function updatePlayState() {
    if (!ui.playBtn || !activeVideo) return;
    if (activeVideo.paused) {
      ui.playBtn.innerHTML = ICONS.play;
      ui.controller.classList.add('ig-paused');
      ui.controller.classList.remove('ig-idle');
    } else {
      ui.playBtn.innerHTML = ICONS.pause;
      ui.controller.classList.remove('ig-paused');
      resetIdleTimer();
    }
  }

  function updateVolumeState() {
    if (!ui.volumeBtn || !activeVideo) return;
    ui.volumeBtn.innerHTML = activeVideo.muted ? ICONS.volumeMute : ICONS.volumeUp;
  }

  function updateProgress(forceTime = null) {
    if (!activeVideo || isSeeking) return;
    const cur = forceTime !== null ? forceTime : (activeVideo.currentTime || 0);
    const dur = activeVideo.duration || 0;
    const pct = dur > 0 ? (cur / dur) * 100 : 0;

    ui.progressBar.style.width = `${pct}%`;
    ui.thumb.style.left = `${pct}%`;
    ui.timeDisplay.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
  }

  function updateBuffer() {
    if (!activeVideo || !activeVideo.duration) return;
    const buf = activeVideo.buffered;
    if (buf && buf.length > 0) {
      const bufferedEnd = buf.end(buf.length - 1);
      const pct = (bufferedEnd / activeVideo.duration) * 100;
      ui.bufferBar.style.width = `${pct}%`;
    }
  }

  function hoverTimeline(e) {
    if (!activeVideo || !activeVideo.duration) return;
    const rect = ui.timelineTrack.getBoundingClientRect();
    if (rect.width <= 0) return;
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetTime = pos * activeVideo.duration;
    ui.tooltip.style.left = `${pos * 100}%`;
    ui.tooltip.textContent = formatTime(targetTime);
  }

  function seekToPosition(e) {
    const video = getTargetVideo();
    if (!video || !video.duration || isNaN(video.duration)) return;

    const rect = ui.timelineTrack.getBoundingClientRect();
    if (rect.width <= 0) return;
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetTime = pos * video.duration;

    video.currentTime = targetTime;
    const pct = pos * 100;
    ui.progressBar.style.width = `${pct}%`;
    ui.thumb.style.left = `${pct}%`;
    ui.timeDisplay.textContent = `${formatTime(targetTime)} / ${formatTime(video.duration)}`;
    console.log('[IG Media Controller] Scrubbed visible reel to:', formatTime(targetTime));
  }

  function startSeek(e) {
    e.preventDefault();
    e.stopPropagation();
    isSeeking = true;
    ui.controller.classList.add('ig-seeking');
    seekToPosition(e);

    const onMouseMove = (moveEvent) => {
      moveEvent.preventDefault();
      moveEvent.stopPropagation();
      seekToPosition(moveEvent);
    };

    const onMouseUp = (upEvent) => {
      upEvent.preventDefault();
      upEvent.stopPropagation();
      isSeeking = false;
      ui.controller.classList.remove('ig-seeking');
      window.removeEventListener('mousemove', onMouseMove, true);
      window.removeEventListener('mouseup', onMouseUp, true);
    };

    window.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('mouseup', onMouseUp, true);
  }

  function setSpeed(speed) {
    defaultSpeed = speed;
    const video = getTargetVideo();
    if (video) {
      video.playbackRate = speed;
    }
    if (ui.speedBtn) {
      ui.speedBtn.textContent = `${speed}x`;
    }
    if (ui.speedMenu) {
      ui.speedMenu.querySelectorAll('.ig-popover-item').forEach(btn => {
        btn.classList.toggle('ig-selected', parseFloat(btn.dataset.speed) === speed);
      });
    }
    chrome.storage.local.set({ defaultSpeed: speed });
    showToast(`Speed: ${speed}x`);
  }

  let selectedQuality = 'Auto';
  let defaultVideoSrc = '';

  function updateQualityBadge() {
    if (!activeVideo || !ui.qualityBtn) return;
    const videoW = activeVideo.videoWidth || 0;
    const videoH = activeVideo.videoHeight || 0;
    const shortEdge = Math.min(videoW || 1080, videoH || 1920);

    let nativeTier = '1080p';
    if (shortEdge >= 1080) nativeTier = '1080p';
    else if (shortEdge >= 720) nativeTier = '720p';
    else if (shortEdge >= 540) nativeTier = '540p';
    else if (shortEdge >= 480) nativeTier = '480p';
    else if (shortEdge >= 360) nativeTier = '360p';

    if (selectedQuality === 'Auto') {
      ui.qualityBtn.textContent = 'Auto';
    } else {
      ui.qualityBtn.textContent = selectedQuality;
    }

    // Build standard quality options
    const options = [];
    options.push({
      label: `Auto (${nativeTier})`,
      tier: 'Auto',
      url: 'AUTO',
      selected: selectedQuality === 'Auto'
    });

    if (activeMetadata && activeMetadata.versions && activeMetadata.versions.length > 0) {
      const seenTiers = new Set();
      for (const v of activeMetadata.versions) {
        if (!v.url) continue;
        const edge = Math.min(v.width || 1080, v.height || 1920);
        let tierLabel = '1080p';
        if (edge >= 1080) tierLabel = '1080p';
        else if (edge >= 720) tierLabel = '720p';
        else if (edge >= 540) tierLabel = '540p';
        else if (edge >= 480) tierLabel = '480p';
        else if (edge >= 360) tierLabel = '360p';
        else tierLabel = `${edge}p`;

        if (!seenTiers.has(tierLabel)) {
          seenTiers.add(tierLabel);
          options.push({
            label: tierLabel === '1080p' ? '1080p (HD)' : tierLabel,
            tier: tierLabel,
            url: v.url,
            selected: selectedQuality === tierLabel
          });
        }
      }
    }

    ui.qualityMenu.innerHTML = options.map(opt => `
      <button class="ig-popover-item ${opt.selected ? 'ig-selected' : ''}" data-url="${opt.url}" data-tier="${opt.tier}">
        ${opt.label}
      </button>
    `).join('');
  }

  function switchQuality(targetUrl, tier) {
    if (!activeVideo) return;

    if (tier === 'Auto') {
      selectedQuality = 'Auto';
      if (defaultVideoSrc && activeVideo.src !== defaultVideoSrc) {
        const curTime = activeVideo.currentTime;
        const paused = activeVideo.paused;
        activeVideo.src = defaultVideoSrc;
        activeVideo.currentTime = curTime;
        if (!paused) activeVideo.play().catch(() => {});
      }
      ui.qualityBtn.textContent = 'Auto';
      showToast('Quality: Auto');
      updateQualityBadge();
      return;
    }

    if (!targetUrl || targetUrl === 'AUTO' || targetUrl === activeVideo.src) return;

    if (!defaultVideoSrc) {
      defaultVideoSrc = activeVideo.src || activeVideo.currentSrc;
    }

    selectedQuality = tier;
    const curTime = activeVideo.currentTime;
    const paused = activeVideo.paused;

    activeVideo.src = targetUrl;
    activeVideo.currentTime = curTime;
    if (!paused) {
      activeVideo.play().catch(console.warn);
    }

    ui.qualityBtn.textContent = tier;
    showToast(`Quality set to ${tier}`);
    updateQualityBadge();
  }

  async function togglePiP() {
    const video = getTargetVideo();
    if (!video) return;
    try {
      if (document.pictureInPictureElement === video) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch (err) {
      console.warn('[IG Media Controller] PiP error:', err);
      showToast('PiP not available for this video', 'error');
    }
  }

  async function downloadVideo() {
    const video = getTargetVideo();
    if (!video || !ui.downloadBtn) return;

    ui.downloadBtn.classList.add('ig-loading');
    ui.downloadBtn.innerHTML = ICONS.spinner;

    try {
      let downloadUrl = null;
      let username = 'instagram';
      const shortcode = getShortcodeForVideo(video);

      console.log('[IG Media Controller] Downloading video for shortcode:', shortcode);

      // Priority 1: Query page script with the exact shortcode of the visible reel
      const metadata = await requestVideoMetadata(video);
      if (metadata && metadata.versions && metadata.versions.length > 0) {
        downloadUrl = metadata.versions[0].url;
        username = metadata.username || username;
      }

      // Priority 2: Direct video element src if not a blob or segment chunk
      if (!downloadUrl && video.currentSrc && !video.currentSrc.startsWith('blob:') && !isChunkUrl(video.currentSrc)) {
        downloadUrl = video.currentSrc;
      }
      if (!downloadUrl && video.src && !video.src.startsWith('blob:') && !isChunkUrl(video.src)) {
        downloadUrl = video.src;
      }

      const filename = `instagram_${username}_${shortcode || Date.now()}.mp4`;
      console.log('[IG Media Controller] Initiating download:', { downloadUrl, filename, shortcode });

      chrome.runtime.sendMessage({
        action: 'DOWNLOAD_VIDEO',
        url: downloadUrl,
        filename: filename,
        shortcode: shortcode
      }, (response) => {
        if (response && response.success) {
          const mb = response.sizeBytes ? ` (${(response.sizeBytes / 1024 / 1024).toFixed(1)} MB)` : '';
          showToast(`Download complete!${mb}`, 'success');
        } else {
          showToast(response?.error || 'Download failed', 'error');
        }
      });
    } catch (err) {
      console.error('[IG Media Controller] Download error:', err);
      showToast('Download failed', 'error');
    } finally {
      setTimeout(() => {
        if (ui.downloadBtn) {
          ui.downloadBtn.classList.remove('ig-loading');
          ui.downloadBtn.innerHTML = ICONS.download;
        }
      }, 800);
    }
  }

  function isChunkUrl(url) {
    if (!url) return false;
    return url.includes('bytestart=') || url.includes('byteend=') || url.includes('init.mp4') || url.includes('.m4s');
  }

  // Bind video events to the active video
  function bindVideoEvents(video) {
    video.addEventListener('play', onVideoPlay);
    video.addEventListener('pause', onVideoPause);
    video.addEventListener('timeupdate', onVideoTimeUpdate);
    video.addEventListener('volumechange', onVideoVolumeChange);
    video.addEventListener('progress', onVideoProgress);
    video.addEventListener('loadedmetadata', onVideoLoadedMetadata);
  }

  function unbindVideoEvents(video) {
    if (!video) return;
    video.removeEventListener('play', onVideoPlay);
    video.removeEventListener('pause', onVideoPause);
    video.removeEventListener('timeupdate', onVideoTimeUpdate);
    video.removeEventListener('volumechange', onVideoVolumeChange);
    video.removeEventListener('progress', onVideoProgress);
    video.removeEventListener('loadedmetadata', onVideoLoadedMetadata);
  }

  function onVideoPlay() { updatePlayState(); }
  function onVideoPause() { updatePlayState(); }
  function onVideoTimeUpdate() {
    if (isScrolling) return;
    updateProgress();
  }
  function onVideoVolumeChange() { updateVolumeState(); }
  function onVideoProgress() { updateBuffer(); }
  function onVideoLoadedMetadata() {
    updateProgress();
    updateQualityBadge();
    if (!isScrolling) syncPosition();
  }

  // Set the current active video
  async function setActiveVideo(video) {
    if (!video) return;
    if (activeVideo === video && document.body.contains(video)) return;

    if (activeVideo) {
      unbindVideoEvents(activeVideo);
    }

    activeVideo = video;
    bindVideoEvents(video);

    // Apply speed setting
    video.playbackRate = defaultSpeed;

    // Refresh UI
    updatePlayState();
    updateVolumeState();
    updateProgress();
    updateBuffer();

    console.log('[IG Media Controller] Locked onto visible reel:', video, 'duration:', video.duration, 'cur:', video.currentTime);

    // Fetch new metadata
    activeMetadata = await requestVideoMetadata(video);
    updateQualityBadge();

    if (!isScrolling) {
      syncPosition();
    }
  }

  // Position controller directly over the active video
  function syncPosition() {
    if (!ui.controller || isScrolling) return;

    const video = activeVideo;
    if (!video || !document.body.contains(video)) {
      ui.controller.classList.add('ig-hidden');
      return;
    }

    const rect = video.getBoundingClientRect();
    if (rect.height < 100 || rect.bottom <= 100 || rect.top >= window.innerHeight - 100) {
      ui.controller.classList.add('ig-hidden');
      return;
    }

    ui.controller.classList.remove('ig-hidden');

    const targetWidth = Math.min(Math.max(rect.width - 48, 300), 450);
    const targetLeft = rect.left + (rect.width - targetWidth) / 2;
    // Position 24px above bottom of the video
    const targetTop = rect.bottom - 68;

    ui.controller.style.top = '0px';
    ui.controller.style.left = '0px';
    ui.controller.style.width = `${targetWidth}px`;
    ui.controller.style.transform = `translate3d(${Math.round(targetLeft)}px, ${Math.round(targetTop)}px, 0)`;
  }

  /**
   * CRITICAL: Screen-Center Video Selection
   * Determines which video is centered in the user's viewport, rejecting off-screen preloading reels.
   */
  function getActiveScreenVideo() {
    if (isScrolling) return null;
    const videos = Array.from(document.querySelectorAll('video'));
    if (videos.length === 0) return null;

    const centerY = window.innerHeight / 2;
    let bestVideo = null;
    let minDistance = Infinity;

    for (const v of videos) {
      if (!v.isConnected) continue;
      const r = v.getBoundingClientRect();
      if (r.width < 100 || r.height < 100) continue;

      const vCenter = (r.top + r.bottom) / 2;
      const dist = Math.abs(vCenter - centerY);

      // Verify that the video is actually covering the viewport center region
      if (r.top < window.innerHeight * 0.8 && r.bottom > window.innerHeight * 0.2) {
        if (dist < minDistance) {
          minDistance = dist;
          bestVideo = v;
        }
      }
    }

    return bestVideo;
  }

  function getTargetVideo() {
    if (isScrolling && activeVideo) return activeVideo;
    const centerVideo = getActiveScreenVideo();
    if (centerVideo) {
      if (centerVideo !== activeVideo) {
        setActiveVideo(centerVideo);
      }
      return centerVideo;
    }
    return activeVideo;
  }

  function updateActiveVideoFromDOM() {
    if (isScrolling) return;
    const best = getActiveScreenVideo();
    if (best) {
      setActiveVideo(best);
    } else if (!activeVideo || !document.body.contains(activeVideo)) {
      if (ui.controller) ui.controller.classList.add('ig-hidden');
    }
  }

  // Global capture listener for timeupdate across ANY video element
  document.addEventListener('timeupdate', (e) => {
    if (isScrolling) return;
    if (e.target && e.target.tagName === 'VIDEO' && e.target === activeVideo) {
      updateProgress();
    }
  }, true);

  // Global capture listener for play events (guarded by Screen Center check!)
  document.addEventListener('play', (e) => {
    if (isScrolling) return;
    if (e.target && e.target.tagName === 'VIDEO') {
      setTimeout(() => {
        if (isScrolling) return;
        const center = getActiveScreenVideo();
        if (center && center === e.target) {
          setActiveVideo(center);
        }
      }, 60);
    }
  }, true);

  // Fallback progress interval: keeps the scrubber moving smoothly without forcing reflows
  setInterval(() => {
    if (isScrolling) return;
    if (activeVideo && !activeVideo.paused && !isSeeking) {
      updateProgress();
    }
  }, 250);

  // Supported Extension Shortcut Keys
  const EXTENSION_KEYS = new Set([
    'Space', 'KeyA', 'KeyD',
    'BracketLeft', 'BracketRight', 'KeyM', 'KeyS', 'KeyP'
  ]);

  // Keyboard Shortcuts Handler
  window.addEventListener('keydown', (e) => {
    // Only handle extension shortcuts; NEVER intercept native Instagram navigation (ArrowDown/ArrowUp)
    if (!EXTENSION_KEYS.has(e.code)) return;

    const target = e.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }

    const video = getTargetVideo();
    if (!video) return;

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        e.stopPropagation();
        togglePlay();
        break;

      case 'KeyA':
        e.preventDefault();
        e.stopPropagation();
        video.currentTime = Math.max(0, video.currentTime - 5);
        updateProgress();
        showToast(`-5s (${formatTime(video.currentTime)})`);
        break;

      case 'KeyD':
        e.preventDefault();
        e.stopPropagation();
        video.currentTime = Math.min(video.duration || 0, video.currentTime + 5);
        updateProgress();
        showToast(`+5s (${formatTime(video.currentTime)})`);
        break;

      case 'BracketLeft': {
        e.preventDefault();
        const curIdx = SPEED_OPTIONS.indexOf(defaultSpeed);
        if (curIdx > 0) {
          setSpeed(SPEED_OPTIONS[curIdx - 1]);
        }
        break;
      }

      case 'BracketRight': {
        e.preventDefault();
        const curIdx = SPEED_OPTIONS.indexOf(defaultSpeed);
        if (curIdx >= 0 && curIdx < SPEED_OPTIONS.length - 1) {
          setSpeed(SPEED_OPTIONS[curIdx + 1]);
        }
        break;
      }

      case 'KeyM':
        e.preventDefault();
        toggleMute();
        break;

      case 'KeyS':
        e.preventDefault();
        e.stopPropagation();
        downloadVideo();
        break;

      case 'KeyP':
        e.preventDefault();
        togglePiP();
        break;
    }
  }, true);

  // Track window and container scrolling cleanly
  let isScrolling = false;
  let scrollSettleTimer = null;

  function onScroll() {
    isScrolling = true;
    // Hide controller during scroll transitions so it never interferes with scroll snapping
    if (ui.controller && !ui.controller.classList.contains('ig-hidden')) {
      ui.controller.classList.add('ig-hidden');
    }

    clearTimeout(scrollSettleTimer);
    scrollSettleTimer = setTimeout(() => {
      isScrolling = false;
      // Scroll has completely settled and snapped
      updateActiveVideoFromDOM();
      syncPosition();
    }, 160);
  }

  window.addEventListener('scroll', onScroll, { capture: true, passive: true });

  window.addEventListener('resize', () => {
    if (!isScrolling) syncPosition();
  }, { passive: true });

  // Debounced MutationObserver to detect newly loaded reels without layout thrashing
  let domUpdateTimer = null;
  function scheduleDOMUpdate(delay = 180) {
    if (isScrolling) return;
    clearTimeout(domUpdateTimer);
    domUpdateTimer = setTimeout(() => {
      if (isScrolling) return;
      buildRootController();
      updateActiveVideoFromDOM();
      syncPosition();
    }, delay);
  }

  const observer = new MutationObserver((mutations) => {
    if (isScrolling) return;
    let hasStructuralChange = false;
    for (const m of mutations) {
      if (m.addedNodes.length > 0 || m.removedNodes.length > 0) {
        hasStructuralChange = true;
        break;
      }
    }
    if (hasStructuralChange) {
      scheduleDOMUpdate(220);
    }
  });

  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true
  });

  // Initialization
  function init() {
    buildRootController();
    updateActiveVideoFromDOM();
    syncPosition();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  console.log('[IG Media Controller] Screen-Center Controller loaded and ready.');
})();
