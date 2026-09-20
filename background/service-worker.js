/**
 * Instagram Reels & Video Controller - Service Worker
 * Handles high-definition video downloads, segment filtering, and fallback fetching.
 */

chrome.runtime.onInstalled.addListener(async () => {
  const { defaultSpeed } = await chrome.storage.local.get('defaultSpeed');
  if (!defaultSpeed) {
    await chrome.storage.local.set({
      defaultSpeed: 1.0,
      showControls: true,
      enableShortcuts: true
    });
  }
  console.log('[IG Media Controller] Service worker initialized.');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'DOWNLOAD_VIDEO') {
    handleVideoDownload(message)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // Keep channel open for async response
  }
});

async function handleVideoDownload({ url, filename, shortcode }) {
  let downloadUrl = url;

  // If URL is missing or looks like an init/segment chunk (contains byte-range or init.mp4), try resolving via shortcode
  const isChunk = downloadUrl && (downloadUrl.includes('bytestart=') || downloadUrl.includes('byteend=') || downloadUrl.includes('init.mp4'));

  if ((!downloadUrl || isChunk) && shortcode) {
    console.log(`[IG Media Controller] URL is a chunk or empty, querying post info for shortcode: ${shortcode}`);
    const resolvedUrl = await fetchVideoUrlFromShortcode(shortcode);
    if (resolvedUrl) {
      downloadUrl = resolvedUrl;
    }
  }

  if (!downloadUrl) {
    throw new Error('Could not find a complete video stream URL');
  }

  const safeFilename = sanitizeFilename(filename || `instagram_video_${Date.now()}.mp4`);

  try {
    // Attempt fetching the file to verify it's a real full video (not a 3KB chunk)
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const blob = await response.blob();
    console.log(`[IG Media Controller] Fetched media size: ${blob.size} bytes (${(blob.size / 1024 / 1024).toFixed(2)} MB)`);

    // Guard: If file size is less than 60KB, it's definitely a segment chunk or error page
    if (blob.size < 60000) {
      if (shortcode) {
        console.warn('[IG Media Controller] File size too small (<60KB), attempting resolution via shortcode endpoint...');
        const resolvedUrl = await fetchVideoUrlFromShortcode(shortcode);
        if (resolvedUrl && resolvedUrl !== downloadUrl) {
          return handleVideoDownload({ url: resolvedUrl, filename: safeFilename, shortcode: null });
        }
      }
      throw new Error(`Video file too small (${(blob.size / 1024).toFixed(1)} KB), incomplete stream segment.`);
    }

    // Convert blob to Data URL or Object URL for reliable local saving
    const reader = new FileReader();
    const dataUrl = await new Promise((resolve, reject) => {
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    const downloadId = await chrome.downloads.download({
      url: dataUrl,
      filename: safeFilename,
      saveAs: false,
      conflictAction: 'uniquify'
    });

    console.log(`[IG Media Controller] Video downloaded successfully! ID: ${downloadId}`);
    return { success: true, downloadId, sizeBytes: blob.size };
  } catch (err) {
    console.warn('[IG Media Controller] Fetch download failed, trying direct chrome.downloads:', err);

    // Secondary fallback: Direct chrome.downloads.download
    try {
      const directId = await chrome.downloads.download({
        url: downloadUrl,
        filename: safeFilename,
        saveAs: false,
        conflictAction: 'uniquify'
      });
      return { success: true, downloadId: directId };
    } catch (directErr) {
      console.error('[IG Media Controller] Direct download also failed:', directErr);
      throw new Error(err.message || directErr.message);
    }
  }
}

/**
 * Fetch Instagram post metadata by shortcode to get the direct 1080p MP4 URL
 */
async function fetchVideoUrlFromShortcode(shortcode) {
  try {
    const res = await fetch(`https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`, {
      credentials: 'include'
    });
    if (!res.ok) return null;
    const json = await res.json();
    
    // Look for video_versions in JSON
    const item = json.items?.[0] || json.graphql?.shortcode_media;
    if (item && item.video_versions && item.video_versions.length > 0) {
      const sorted = [...item.video_versions].sort((a, b) => (b.width * b.height) - (a.width * a.height));
      return sorted[0].url;
    }
    if (item?.video_url) {
      return item.video_url;
    }
  } catch (e) {
    console.warn('[IG Media Controller] Error fetching post by shortcode:', e);
  }
  return null;
}

function sanitizeFilename(name) {
  return name.replace(/[/\\?%*:|"<>]/g, '_').trim();
}
