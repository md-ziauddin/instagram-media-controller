/**
 * Instagram Reels & Video Controller - Page Script (MAIN World)
 * Intercepts network responses (fetch/XHR), inspects React Fiber,
 * and caches full-resolution video_versions for instant downloading.
 * Fully non-blocking to prevent any interference with native scrolling/snapping.
 */
(() => {
  'use strict';

  // In-memory cache for media metadata indexed by shortcode and id
  const mediaCache = new Map();

  // Recursively search JS object for video_versions with strict depth and length caps
  function harvestMediaObjects(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 8) return;

    // Check if this object is a media item
    if (obj.video_versions && Array.isArray(obj.video_versions) && obj.video_versions.length > 0) {
      const parsed = parseMediaItem(obj);
      if (parsed) {
        if (parsed.shortcode) mediaCache.set(parsed.shortcode, parsed);
        if (parsed.id) mediaCache.set(String(parsed.id), parsed);
      }
    } else if (obj.video_url) {
      const parsed = parseMediaItem(obj);
      if (parsed) {
        if (parsed.shortcode) mediaCache.set(parsed.shortcode, parsed);
        if (parsed.id) mediaCache.set(String(parsed.id), parsed);
      }
    }

    // Traverse arrays and nested objects with strict bounding
    if (Array.isArray(obj)) {
      const len = Math.min(obj.length, 40);
      for (let i = 0; i < len; i++) {
        harvestMediaObjects(obj[i], depth + 1);
      }
    } else {
      const keys = Object.keys(obj);
      const len = Math.min(keys.length, 30);
      for (let i = 0; i < len; i++) {
        const key = keys[i];
        if (key === 'video_versions') continue;
        harvestMediaObjects(obj[key], depth + 1);
      }
    }
  }

  function parseMediaItem(item) {
    if (!item) return null;

    let versions = [];
    if (Array.isArray(item.video_versions)) {
      versions = item.video_versions
        .filter(v => v && v.url)
        .map(v => ({
          url: v.url,
          width: v.width || 0,
          height: v.height || 0,
          type: v.type
        }));
    } else if (item.video_url) {
      versions = [{
        url: item.video_url,
        width: item.original_width || 1080,
        height: item.original_height || 1920,
        type: 101
      }];
    }

    if (versions.length === 0) return null;

    // Sort by resolution (highest quality first)
    versions.sort((a, b) => (b.width * b.height) - (a.width * a.height));

    const shortcode = item.code || item.shortcode || '';
    const id = item.id || item.pk || '';
    const username = item.owner?.username || item.user?.username || 'instagram';

    return {
      id: String(id),
      shortcode,
      username,
      versions
    };
  }

  // Intercept window.fetch ONLY for JSON API endpoints
  // NEVER intercept binary media segments or general instagram.com requests
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
      const isApi = url.includes('/graphql/query') || url.includes('/api/v1/clips/') || url.includes('/api/v1/media/');
      const contentType = response.headers?.get('content-type') || '';

      if (isApi && contentType.includes('application/json')) {
        const clone = response.clone();
        clone.json().then(data => {
          setTimeout(() => harvestMediaObjects(data), 0);
        }).catch(() => {});
      }
    } catch (e) {}
    return response;
  };

  // Intercept XMLHttpRequest for API endpoints only
  const originalXHR = window.XMLHttpRequest.prototype.open;
  window.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.addEventListener('load', function () {
      try {
        if (typeof url === 'string' && (url.includes('/graphql/query') || url.includes('/api/v1/clips/'))) {
          const contentType = this.getResponseHeader('content-type') || '';
          if (contentType.includes('application/json')) {
            const data = JSON.parse(this.responseText);
            setTimeout(() => harvestMediaObjects(data), 0);
          }
        }
      } catch (e) {}
    });
    return originalXHR.call(this, method, url, ...rest);
  };

  // Helper to extract React Fiber
  function getReactFiber(element) {
    if (!element) return null;
    const key = Object.keys(element).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
    return key ? element[key] : null;
  }

  function searchFiberForMedia(fiber, maxDepth = 25) {
    if (!fiber || maxDepth <= 0) return null;
    let current = fiber;
    let depth = 0;

    while (current && depth < maxDepth) {
      if (current.memoizedProps) {
        const p = current.memoizedProps;
        const media = p.media || p.post || p.item || p.clip || (p.video_versions ? p : null);
        if (media && (media.video_versions || media.video_url)) {
          const parsed = parseMediaItem(media);
          if (parsed) return parsed;
        }
      }
      current = current.return;
      depth++;
    }
    return null;
  }

  // Scan page script tags
  function scanScriptTags() {
    try {
      const scripts = document.querySelectorAll('script[type="application/json"]');
      for (const s of scripts) {
        if (s.textContent && s.textContent.includes('video_versions')) {
          try {
            const data = JSON.parse(s.textContent);
            harvestMediaObjects(data);
          } catch (e) {}
        }
      }
    } catch (e) {}
  }

  // Handle messages from content script
  window.addEventListener('message', (event) => {
    if (!event.data || event.data.source !== 'IG_CONTROLLER_CONTENT') return;

    if (event.data.action === 'GET_VIDEO_METADATA') {
      const { requestId, shortcode } = event.data;

      let result = null;

      // 1. Check cache by shortcode
      if (shortcode && mediaCache.has(shortcode)) {
        result = mediaCache.get(shortcode);
      }

      // 2. Scan script tags
      if (!result) {
        scanScriptTags();
        if (shortcode && mediaCache.has(shortcode)) {
          result = mediaCache.get(shortcode);
        }
      }

      // 3. Check React Fiber on center screen video or matched container
      if (!result) {
        let videoEl = null;
        if (shortcode) {
          const link = document.querySelector(`a[href*="/reel/${shortcode}"], a[href*="/p/${shortcode}"]`);
          if (link) {
            const container = link.closest('article') || link.closest('div[role="presentation"]') || link.parentElement?.parentElement;
            if (container) videoEl = container.querySelector('video');
          }
        }
        if (!videoEl) {
          const videos = Array.from(document.querySelectorAll('video'));
          const centerY = window.innerHeight / 2;
          let bestDist = Infinity;
          for (const v of videos) {
            if (!v.isConnected) continue;
            const r = v.getBoundingClientRect();
            const d = Math.abs((r.top + r.bottom) / 2 - centerY);
            if (d < bestDist) {
              bestDist = d;
              videoEl = v;
            }
          }
        }
        if (videoEl) {
          const fiber = getReactFiber(videoEl) || getReactFiber(videoEl.closest('article')) || getReactFiber(videoEl.parentElement);
          result = searchFiberForMedia(fiber);
        }
      }

      // 4. If shortcode exists, try any entry in cache matching
      if (!result && shortcode) {
        for (const [k, v] of mediaCache.entries()) {
          if (k === shortcode || (v.shortcode && v.shortcode === shortcode)) {
            result = v;
            break;
          }
        }
      }

      window.postMessage({
        source: 'IG_CONTROLLER_PAGE',
        action: 'METADATA_RESPONSE',
        requestId,
        metadata: result
      }, '*');
    }
  });

  // Initial scan deferred
  setTimeout(scanScriptTags, 500);
  console.log('[IG Media Controller] Non-blocking page script active in MAIN world.');
})();
