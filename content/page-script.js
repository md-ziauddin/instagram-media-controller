/**
 * Instagram Reels & Video Controller - Page Script (MAIN World)
 * Intercepts network responses (fetch/XHR), inspects React Fiber,
 * and caches full-resolution video_versions for instant downloading.
 */
(() => {
  'use strict';

  // In-memory cache for media metadata indexed by shortcode and id
  const mediaCache = new Map();

  // Recursively search any JS object for video_versions or media items
  function harvestMediaObjects(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 20) return;

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

    // Traverse arrays and nested objects
    if (Array.isArray(obj)) {
      for (const item of obj) {
        harvestMediaObjects(item, depth + 1);
      }
    } else {
      for (const key of Object.keys(obj)) {
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

  // Intercept window.fetch to capture video_versions from GraphQL and clips endpoints
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
      if (
        url.includes('/graphql/query') ||
        url.includes('/api/v1/') ||
        url.includes('/clips/') ||
        url.includes('instagram.com')
      ) {
        const clone = response.clone();
        clone.json().then(data => {
          harvestMediaObjects(data);
        }).catch(() => {});
      }
    } catch (e) {}
    return response;
  };

  // Intercept XMLHttpRequest
  const originalXHR = window.XMLHttpRequest.prototype.open;
  window.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.addEventListener('load', function () {
      try {
        if (typeof url === 'string' && (url.includes('/graphql/query') || url.includes('/api/v1/'))) {
          const data = JSON.parse(this.responseText);
          harvestMediaObjects(data);
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

  function searchFiberForMedia(fiber, maxDepth = 40) {
    if (!fiber || maxDepth <= 0) return null;
    let current = fiber;
    let depth = 0;

    while (current && depth < maxDepth) {
      if (current.memoizedProps) {
        harvestMediaObjects(current.memoizedProps);
        const media = current.memoizedProps.media || current.memoizedProps.post || current.memoizedProps.item;
        if (media && (media.video_versions || media.video_url)) {
          return parseMediaItem(media);
        }
      }
      if (current.memoizedState) {
        harvestMediaObjects(current.memoizedState);
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
      const { requestId, shortcode, videoSelector } = event.data;

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

      // 3. Check React Fiber on the video or its ancestors
      if (!result && videoSelector) {
        const videoEl = document.querySelector(videoSelector);
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

  // Initial scan
  scanScriptTags();
  console.log('[IG Media Controller] Enhanced page script active in MAIN world.');
})();
