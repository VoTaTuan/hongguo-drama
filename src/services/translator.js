/**
 * Dịch thuật AI & Dịch tự động Phim Ngắn (Trung -> Việt)
 * Hỗ trợ: Google Translate miễn phí (mặc định) + AI tùy chỉnh (DeepSeek / OpenAI / Gemini...)
 */
import React, { useState, useEffect } from 'react';

const STORAGE_CACHE_KEY_PREFIX = 'hg_trans_v1_';
const MAX_LOCAL_STORAGE_ITEMS = 1500;
const memoryCache = new Map();
const pendingRequests = new Map();

const DEFAULT_SETTINGS = {
  enabled: true,
  provider: 'google', // 'google' | 'custom_ai'
  apiKey: '',
  endpoint: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  showOriginal: true,
  vietnamese_filenames: true,
};

const OVERRIDES_STORAGE_KEY = 'hg_trans_custom_overrides';

export function getCustomOverrides() {
  try {
    const raw = localStorage.getItem(OVERRIDES_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

export function saveCustomOverride(chineseText, customVietnamese) {
  if (!chineseText) return {};
  const zh = chineseText.trim();
  const vi = (customVietnamese || '').trim();
  const overrides = getCustomOverrides();
  if (vi) {
    overrides[zh] = vi;
    setCachedTranslation(zh, vi);
  } else {
    delete overrides[zh];
  }
  try {
    localStorage.setItem(OVERRIDES_STORAGE_KEY, JSON.stringify(overrides));
  } catch (_) {}
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('hg-translation-override-changed', { detail: { text: zh, translated: vi } }));
  }
  return overrides;
}

export function removeCustomOverride(chineseText) {
  if (!chineseText) return {};
  const zh = chineseText.trim();
  const overrides = getCustomOverrides();
  delete overrides[zh];
  try {
    localStorage.setItem(OVERRIDES_STORAGE_KEY, JSON.stringify(overrides));
  } catch (_) {}
  memoryCache.delete(zh);
  try { localStorage.removeItem(getCacheKey(zh)); } catch (_) {}
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('hg-translation-override-changed', { detail: { text: zh, translated: null } }));
  }
  return overrides;
}

let cachedSettings = null;

export function getTranslationConfig() {
  if (cachedSettings) return cachedSettings;
  try {
    const raw = localStorage.getItem('hg_ai_translation_settings');
    if (raw) {
      cachedSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
      return cachedSettings;
    }
  } catch (_) {}
  cachedSettings = { ...DEFAULT_SETTINGS };
  return cachedSettings;
}

export function saveTranslationConfig(patch) {
  const current = getTranslationConfig();
  const next = { ...current, ...patch };
  cachedSettings = next;
  try {
    localStorage.setItem('hg_ai_translation_settings', JSON.stringify(next));
  } catch (_) {}
  return next;
}

export function hasChinese(text) {
  return typeof text === 'string' && /[\u4e00-\u9fa5]/.test(text);
}

function getCacheKey(text) {
  return `${STORAGE_CACHE_KEY_PREFIX}${text.trim()}`;
}

export function getCachedTranslation(text) {
  if (!text || typeof text !== 'string') return text;
  const key = text.trim();
  const overrides = getCustomOverrides();
  if (overrides[key]) return overrides[key];
  if (memoryCache.has(key)) return memoryCache.get(key);
  try {
    const stored = localStorage.getItem(getCacheKey(key));
    if (stored) {
      memoryCache.set(key, stored);
      return stored;
    }
  } catch (_) {}
  return null;
}

export function setCachedTranslation(text, translated) {
  if (!text || !translated || text === translated) return;
  const key = text.trim();
  memoryCache.set(key, translated);
  try {
    localStorage.setItem(getCacheKey(key), translated);
  } catch (_) {
    // Quota reached: cleanup older entries
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(STORAGE_CACHE_KEY_PREFIX)) keys.push(k);
      }
      if (keys.length > MAX_LOCAL_STORAGE_ITEMS) {
        keys.slice(0, 300).forEach(k => localStorage.removeItem(k));
        localStorage.setItem(getCacheKey(key), translated);
      }
    } catch (_) {}
  }
}

export function clearTranslationCache() {
  memoryCache.clear();
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(STORAGE_CACHE_KEY_PREFIX)) keysToRemove.push(k);
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
    return keysToRemove.length;
  } catch (_) {
    return 0;
  }
}

export function getTranslationCacheCount() {
  try {
    let count = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(STORAGE_CACHE_KEY_PREFIX)) count++;
    }
    return count;
  } catch (_) {
    return memoryCache.size;
  }
}

async function translateWithGoogle(text) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=zh-CN&tl=vi&dt=t&q=${encodeURIComponent(text)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Google Translate error ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data?.[0])) throw new Error('Cấu trúc trả về không đúng');
    return data[0].map(item => item?.[0] || '').join('').trim();
  } finally {
    clearTimeout(timer);
  }
}

async function translateWithCustomAi(text, config) {
  const endpoint = (config.endpoint || 'https://api.deepseek.com/v1').replace(/\/+$/, '');
  const url = `${endpoint}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey || ''}`,
      },
      body: JSON.stringify({
        model: config.model || 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: 'Bạn là chuyên gia dịch thuật phim ngắn tiếng Trung sang tiếng Việt. Hãy dịch tiêu đề hoặc tóm tắt sau đây sang tiếng Việt một cách tự nhiên, cuốn hút, đúng văn phong phim ngắn ngôn tình/hành động. Chỉ trả về kết quả dịch tiếng Việt, không kèm giải thích hay dấu ngoặc kép.',
          },
          {
            role: 'user',
            content: text,
          },
        ],
        temperature: 0.3,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`AI API error ${res.status}`);
    const data = await res.json();
    const result = data.choices?.[0]?.message?.content?.trim();
    if (!result) throw new Error('AI không trả về kết quả');
    return result.replace(/^["'《]|["'》]$/g, '').trim();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Dịch văn bản từ tiếng Trung sang tiếng Việt
 */
export async function translateText(text, options = {}) {
  if (!text || typeof text !== 'string') return text;
  const trimmed = text.trim();
  if (!trimmed || !hasChinese(trimmed)) return trimmed;

  const config = { ...getTranslationConfig(), ...options };
  if (!config.enabled && !options.isTest) return trimmed;

  // Kiểm tra bộ nhớ đệm (trừ khi yêu cầu skipCache)
  if (!options.skipCache) {
    const cached = getCachedTranslation(trimmed);
    if (cached) return cached;
  }

  // Tránh gọi trùng lặp cùng lúc cho cùng một văn bản
  if (!options.skipCache && pendingRequests.has(trimmed)) {
    return pendingRequests.get(trimmed);
  }

  const promise = (async () => {
    let result = null;

    // 1. Ưu tiên gọi qua Electron IPC Main Process (Không bao giờ bị lỗi CORS)
    if (typeof window !== 'undefined' && window.electronAPI && typeof window.electronAPI.translateText === 'function') {
      try {
        const response = await window.electronAPI.translateText(trimmed, config);
        if (response && response.success && response.text) {
          result = response.text;
        } else if (options.isTest) {
          throw new Error(response?.error || 'Lỗi dịch thuật từ hệ thống');
        } else if (config.provider === 'custom_ai') {
          // Thử dự phòng Google Dịch qua IPC
          const fallbackRes = await window.electronAPI.translateText(trimmed, { provider: 'google' });
          if (fallbackRes && fallbackRes.success && fallbackRes.text) {
            result = fallbackRes.text;
          }
        }
      } catch (ipcErr) {
        if (options.isTest) throw ipcErr;
        console.warn('[AI Translator IPC failed]:', ipcErr.message);
      }
    }

    // 2. Dự phòng gọi trực tiếp bằng browser fetch (nếu chạy ở giao diện web preview không có Electron)
    if (!result && !(typeof window !== 'undefined' && window.electronAPI?.translateText)) {
      if (config.provider === 'custom_ai' && config.apiKey) {
        try {
          result = await translateWithCustomAi(trimmed, config);
        } catch (err) {
          if (options.isTest) throw err;
          console.warn('[AI Translator] Custom AI failed:', err.message);
        }
      }

      if (!result) {
        try {
          result = await translateWithGoogle(trimmed);
        } catch (err) {
          if (options.isTest) throw err;
          console.warn('[AI Translator] Google Translate failed:', err.message);
        }
      }
    }

    if (result && result !== trimmed) {
      if (!options.skipCache) {
        setCachedTranslation(trimmed, result);
      }
      return result;
    }

    if (options.isTest) {
      throw new Error('Dịch không thành công hoặc văn bản trả về vẫn là tiếng Trung.');
    }

    return trimmed;
  })().finally(() => {
    if (!options.skipCache) {
      pendingRequests.delete(trimmed);
    }
  });

  if (!options.skipCache) {
    pendingRequests.set(trimmed, promise);
  }
  return promise;
}

/**
 * React Hook dịch văn bản
 */
export function useTranslatedText(text, options = {}) {
  const [translated, setTranslated] = React.useState(() => getCachedTranslation(text) || text);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!text || !hasChinese(text)) {
      setTranslated(text);
      return;
    }

    const cached = getCachedTranslation(text);
    if (cached) {
      setTranslated(cached);
      return;
    }

    const config = getTranslationConfig();
    if (!config.enabled) {
      setTranslated(text);
      return;
    }

    let isMounted = true;
    setLoading(true);

    translateText(text, options)
      .then(res => {
        if (isMounted && res) setTranslated(res);
      })
      .catch(() => {
        if (isMounted) setTranslated(text);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => { isMounted = false; };
  }, [text]);

  React.useEffect(() => {
    if (typeof window === 'undefined' || !text) return;
    const handleOverride = (e) => {
      if (e.detail?.text === text) {
        if (e.detail.translated) {
          setTranslated(e.detail.translated);
        } else {
          translateText(text, { skipCache: true }).then((t) => setTranslated(t)).catch(() => {});
        }
      }
    };
    window.addEventListener('hg-translation-override-changed', handleOverride);
    return () => window.removeEventListener('hg-translation-override-changed', handleOverride);
  }, [text]);

  const isTranslated = hasChinese(text) && translated !== text;
  return { translated, original: text, loading, isTranslated };
}

/**
 * Dịch từ khóa tìm kiếm tiếng Việt sang tiếng Trung để tìm trên kho phim Hồng Quả
 */
export async function translateQueryToChinese(query, options = {}) {
  if (!query || typeof query !== 'string') return query;
  const trimmed = query.trim();
  if (!trimmed) return trimmed;

  // Nếu người dùng đã gõ tiếng Trung, không cần dịch
  if (hasChinese(trimmed)) return trimmed;

  // Nếu từ khóa chỉ là ID số hoặc chuỗi quá ngắn (< 2 ký tự)
  if (/^\d+$/.test(trimmed) || trimmed.length < 2) return trimmed;

  const config = { ...getTranslationConfig(), ...options, direction: 'vi2zh' };
  if (!config.enabled) return trimmed;

  try {
    if (typeof window !== 'undefined' && window.electronAPI && typeof window.electronAPI.translateText === 'function') {
      const res = await window.electronAPI.translateText(trimmed, config);
      if (res && res.success && res.text) {
        return res.text.trim();
      }
    }
  } catch (err) {
    console.warn('[translateQueryToChinese] Error:', err.message);
  }
  return trimmed;
}
