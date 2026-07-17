const DEFAULT_OPENROUTER_MODEL = 'xiaomi/mimo-v2.5';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const FETCH_TIMEOUT_MS = 10_000;
const AI_TIMEOUT_MS = 20_000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_OUTPUT_TOKENS = 1000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_MATCHED_TRIGGER_WORDS = 3;
const SUPPORTED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/tiff',
  'image/heic',
  'image/heif',
]);

function normalizeMimeType(value) {
  return String(value || '').split(';')[0].trim().toLowerCase();
}

function mimeTypeFromName(name) {
  const lower = String(name || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  if (lower.endsWith('.tif') || lower.endsWith('.tiff')) return 'image/tiff';
  if (lower.endsWith('.heic')) return 'image/heic';
  if (lower.endsWith('.heif')) return 'image/heif';
  return '';
}

function attachmentMimeType(attachment) {
  const contentType = normalizeMimeType(attachment?.contentType);
  if (SUPPORTED_IMAGE_TYPES.has(contentType)) return contentType;
  return mimeTypeFromName(attachment?.name || attachment?.url);
}

function firstSupportedImageAttachment(attachments) {
  const values = typeof attachments?.values === 'function'
    ? [...attachments.values()]
    : Array.isArray(attachments)
      ? attachments
      : [];
  return values.find((attachment) => SUPPORTED_IMAGE_TYPES.has(attachmentMimeType(attachment))) || null;
}

function normalizeMatchText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchTriggerWords({ ocrText }, triggerWords) {
  const haystack = normalizeMatchText(ocrText || '');
  if (!haystack) return [];
  return (Array.isArray(triggerWords) ? triggerWords : [])
    .filter((word) => typeof word === 'string')
    .map((word) => ({ raw: word.trim(), normalized: normalizeMatchText(word) }))
    .filter((word) => word.raw && word.normalized && haystack.includes(word.normalized))
    .map((word) => word.raw)
    .slice(0, MAX_MATCHED_TRIGGER_WORDS);
}

function triggerWordsForPrompt(triggerWords) {
  const words = [];
  let totalLength = 0;
  for (const word of Array.isArray(triggerWords) ? triggerWords : []) {
    const value = String(word || '').trim();
    if (!value || words.includes(value)) continue;
    if (totalLength + value.length > 4000) break;
    words.push(value);
    totalLength += value.length;
  }
  return words;
}

function decideScamFromVision(vision, triggerWords, threshold) {
  const confidence = Number(vision?.confidence);
  const safeThreshold = Number.isFinite(threshold) ? threshold : 0.7;
  const matchedWords = matchTriggerWords(vision || {}, triggerWords);
  const hasEnoughConfidence = Number.isFinite(confidence) && confidence >= safeThreshold;
  return {
    isScam: hasEnoughConfidence && matchedWords.length > 0,
    matchedWords,
    hasEnoughConfidence,
    confidence: Number.isFinite(confidence) ? confidence : null,
  };
}

function cleanJsonText(value) {
  return String(value || '')
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
}

function parseVisionJson(text) {
  const cleaned = cleanJsonText(text);
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    const parseError = new Error(`Failed to parse AI Verdict JSON response: ${error.message}`);
    parseError.rawAiResponse = String(text || '').slice(0, 1000);
    parseError.cleanedAiResponse = cleaned.slice(0, 1000);
    throw parseError;
  }
}

function normalizeVisionResponse(value) {
  const caption = typeof value?.caption === 'string' ? value.caption.trim() : '';
  const ocrText = typeof value?.ocrText === 'string' ? value.ocrText.trim() : '';
  let confidence = Number(value?.confidence);
  if (Number.isFinite(confidence) && confidence > 1) confidence /= 100;
  if (!Number.isFinite(confidence)) confidence = 0;
  confidence = Math.max(0, Math.min(1, confidence));
  return { caption, ocrText, confidence };
}

function geminiModelPath(model) {
  return String(model || DEFAULT_GEMINI_MODEL)
    .replace(/^models\//, '')
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

async function fetchAttachmentBase64(attachment) {
  const size = Number(attachment?.size || 0);
  if (size > MAX_IMAGE_BYTES) {
    const error = new Error(`Image is too large: ${size} bytes`);
    error.unbilledAiVision = true;
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(attachment.url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Image fetch failed: HTTP ${response.status}`);
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_IMAGE_BYTES) {
      throw new Error(`Image is too large: ${contentLength} bytes`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      throw new Error(`Image is too large: ${buffer.byteLength} bytes`);
    }
    return buffer.toString('base64');
  } catch (error) {
    error.unbilledAiVision = true;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function visionPrompt({ retry = false, triggerWords = [] } = {}) {
  const patterns = triggerWordsForPrompt(triggerWords);
  const lines = [
    'Analyze this single Discord image attachment for visible text matching configured spam trigger patterns.',
    patterns.length
      ? `Trigger patterns to look for:\n${patterns.map((word, index) => `${index + 1}. ${word}`).join('\n')}`
      : 'No trigger patterns were supplied. Return empty ocrText.',
    'Return one valid minified JSON object only: {"caption":"...","ocrText":"...","confidence":0.0}',
    'caption: short factual context, max 120 characters; do not list all text.',
    'ocrText: copy only up to 3 visible snippets that match the trigger patterns, separated by " | "; empty string if none.',
    'confidence: number from 0 to 1 for how confident you are in caption/OCR accuracy.',
    'Stop after 3 matching snippets. Do not OCR the whole image.',
    'Do not decide whether this is a scam. Do not explain reasoning or steps.',
    'Do not include markdown, code fences, comments, or extra keys.',
  ];
  if (retry) {
    lines.unshift('Previous answer failed because it was empty or invalid. Return JSON only now.');
  }
  return lines.join('\n');
}

async function fetchJsonWithTimeout(url, options, provider = null) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(body?.error?.message || `AI request failed: HTTP ${response.status}`);
      error.httpStatus = response.status;
      error.provider = provider;
      error.providerError = body?.error || null;
      if (provider === 'openrouter') {
        const hasCost = Boolean(body?.usage && Object.prototype.hasOwnProperty.call(body.usage, 'cost'));
        const cost = hasCost && typeof body.usage.cost === 'number' ? body.usage.cost : NaN;
        error.openRouterCost = Number.isFinite(cost) ? cost : null;
        error.unbilledAiVision = openRouterResponseIsUnbilled(body)
          || openRouterRejectionIsUnbilled(body, response.status);
      }
      throw error;
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

function cacheKeyForAttachment(provider, model, attachment) {
  return [provider, model, attachment?.id || attachment?.url || attachment?.name || 'unknown'].join(':');
}

function cloneCachedResult(result) {
  return result ? { ...result, cached: true } : null;
}

function jsonSnippet(value, maxLength = 1000) {
  try {
    return JSON.stringify(value).slice(0, maxLength);
  } catch {
    return String(value || '').slice(0, maxLength);
  }
}

function extractTextContent(content) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (typeof part?.text === 'string') return part.text;
        if (typeof part?.content === 'string') return part.content;
        return '';
      })
      .join('')
      .trim();
  }
  if (content && typeof content === 'object') {
    if (typeof content.text === 'string') return content.text.trim();
    if (typeof content.content === 'string') return content.content.trim();
    return jsonSnippet(content);
  }
  return '';
}

function extractOpenRouterText(body) {
  const choice = body?.choices?.[0];
  const text = extractTextContent(choice?.message?.content);
  if (text) return text;

  const error = new Error([
    'OpenRouter response did not include text',
    `finish_reason=${choice?.finish_reason || 'unknown'}`,
    `native_finish_reason=${choice?.native_finish_reason || 'unknown'}`,
    `model=${body?.model || 'unknown'}`,
  ].join('; '));
  error.rawAiResponse = jsonSnippet({
    id: body?.id,
    model: body?.model,
    choices: body?.choices,
    usage: body?.usage,
    error: body?.error,
  });
  error.cleanedAiResponse = error.rawAiResponse;
  error.retryableAiVision = true;
  const hasCost = Boolean(body?.usage && Object.prototype.hasOwnProperty.call(body.usage, 'cost'));
  const cost = hasCost && typeof body.usage.cost === 'number' ? body.usage.cost : NaN;
  error.openRouterCost = Number.isFinite(cost) ? cost : null;
  error.unbilledAiVision = openRouterResponseIsUnbilled(body);
  throw error;
}

function openRouterResponseIsUnbilled(body) {
  const choice = body?.choices?.[0];
  const usage = body?.usage;
  const hasCost = Boolean(usage && Object.prototype.hasOwnProperty.call(usage, 'cost'));
  const hasCompletionTokens = Boolean(usage && Object.prototype.hasOwnProperty.call(usage, 'completion_tokens'));
  const cost = hasCost && typeof usage.cost === 'number' ? usage.cost : NaN;
  const completionTokens = hasCompletionTokens && typeof usage.completion_tokens === 'number'
    ? usage.completion_tokens
    : NaN;
  const finishReason = choice?.finish_reason
    ?? choice?.native_finish_reason
    ?? (body?.error ? 'error' : null);
  const normalizedFinishReason = finishReason === null ? null : String(finishReason).toLowerCase();
  if (hasCost && Number.isFinite(cost)) return cost === 0;
  return (
    hasCompletionTokens
    && Number.isFinite(completionTokens)
    && completionTokens === 0
    && (!normalizedFinishReason || normalizedFinishReason === 'error')
  );
}

function openRouterRejectionIsUnbilled(body, httpStatus) {
  const hasUsage = Boolean(body && Object.prototype.hasOwnProperty.call(body, 'usage'));
  const hasGeneratedChoice = Array.isArray(body?.choices) && body.choices.length > 0;
  return Number(httpStatus) >= 400
    && Number(httpStatus) < 500
    && !hasUsage
    && !hasGeneratedChoice;
}

function shouldRetryAiVisionError(error) {
  const message = String(error?.message || '');
  return Boolean(
    error?.retryableAiVision
    || message.startsWith('Failed to parse AI Verdict JSON response')
    || message.includes('OpenRouter response did not include text')
    || message.includes('finish_reason=length')
  );
}

function combineAiVisionErrors(firstError, retryError) {
  const error = new Error(`${firstError.message}; retry failed: ${retryError.message}`);
  error.rawAiResponse = retryError.rawAiResponse || firstError.rawAiResponse || null;
  error.cleanedAiResponse = retryError.cleanedAiResponse || firstError.cleanedAiResponse || null;
  error.firstRawAiResponse = firstError.rawAiResponse || null;
  error.firstCleanedAiResponse = firstError.cleanedAiResponse || null;
  error.unbilledAiVision = Boolean(firstError.unbilledAiVision && retryError.unbilledAiVision);
  return error;
}

async function callOpenRouter({ apiKey, model, imageUrl, base64Image, mimeType, prompt }) {
  const url = imageUrl || `data:${mimeType};base64,${base64Image}`;
  const body = await fetchJsonWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-OpenRouter-Title': 'Spam Catcher',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url } },
          ],
        },
      ],
      // OpenRouter structured-output support varies by model/provider; keep this model prompt-only.
      reasoning: { effort: 'none', exclude: true },
      max_tokens: MAX_OUTPUT_TOKENS,
      temperature: 0,
      stream: false,
    }),
  }, 'openrouter');
  return {
    text: extractOpenRouterText(body),
    unbilledAiVision: openRouterResponseIsUnbilled(body),
  };
}

async function callGemini({ apiKey, model, base64Image, mimeType, prompt }) {
  const url = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModelPath(model)}:generateContent`);
  url.searchParams.set('key', apiKey);
  const body = await fetchJsonWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { inlineData: { mimeType, data: base64Image } },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        temperature: 0,
      },
    }),
  }, 'gemini');
  const text = body?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || '')
    .join('')
    .trim();
  if (!text) throw new Error('Gemini response did not include text.');
  return { text, unbilledAiVision: false };
}

function createAiVisionChecker({
  openRouterApiKey,
  openRouterModel = DEFAULT_OPENROUTER_MODEL,
  geminiApiKey,
  geminiModel = DEFAULT_GEMINI_MODEL,
} = {}) {
  const provider = openRouterApiKey ? 'openrouter' : geminiApiKey ? 'gemini' : null;
  if (!provider) return null;
  const model = provider === 'openrouter' ? openRouterModel : geminiModel;
  const cache = new Map();

  function getCached(attachment) {
    const cached = cache.get(cacheKeyForAttachment(provider, model, attachment));
    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
      cache.delete(cacheKeyForAttachment(provider, model, attachment));
      return null;
    }
    return cloneCachedResult(cached.result);
  }

  function setCached(attachment, result) {
    cache.set(cacheKeyForAttachment(provider, model, attachment), {
      result: { ...result, cached: false },
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
  }

  async function analyzeWithOpenRouter(attachment, mimeType, prompt) {
    try {
      return await callOpenRouter({
        apiKey: openRouterApiKey,
        model,
        imageUrl: attachment.url,
        mimeType,
        prompt,
      });
    } catch (urlError) {
      let base64Image;
      try {
        base64Image = await fetchAttachmentBase64(attachment);
      } catch (fetchError) {
        const error = new Error(`OpenRouter image URL failed (${urlError.message}); base64 fetch failed (${fetchError.message})`);
        error.rawAiResponse = urlError.rawAiResponse || null;
        error.cleanedAiResponse = urlError.cleanedAiResponse || null;
        error.firstRawAiResponse = urlError.rawAiResponse || null;
        error.firstCleanedAiResponse = urlError.cleanedAiResponse || null;
        error.retryableAiVision = Boolean(urlError.retryableAiVision);
        error.unbilledAiVision = Boolean(urlError.unbilledAiVision && fetchError.unbilledAiVision);
        throw error;
      }
      try {
        const base64Result = await callOpenRouter({
          apiKey: openRouterApiKey,
          model,
          base64Image,
          mimeType,
          prompt,
        });
        return {
          ...base64Result,
          unbilledAiVision: Boolean(urlError.unbilledAiVision && base64Result.unbilledAiVision),
        };
      } catch (base64Error) {
        const error = new Error(`OpenRouter image URL failed (${urlError.message}); base64 fallback failed (${base64Error.message})`);
        error.rawAiResponse = base64Error.rawAiResponse || urlError.rawAiResponse || null;
        error.cleanedAiResponse = base64Error.cleanedAiResponse || urlError.cleanedAiResponse || null;
        error.firstRawAiResponse = urlError.rawAiResponse || null;
        error.firstCleanedAiResponse = urlError.cleanedAiResponse || null;
        error.retryableAiVision = Boolean(urlError.retryableAiVision || base64Error.retryableAiVision);
        error.unbilledAiVision = Boolean(urlError.unbilledAiVision && base64Error.unbilledAiVision);
        throw error;
      }
    }
  }

  async function callProvider(attachment, mimeType, { retry = false, triggerWords = [] } = {}) {
    const prompt = visionPrompt({ retry, triggerWords });
    if (provider === 'openrouter') {
      return analyzeWithOpenRouter(attachment, mimeType, prompt);
    }
    return callGemini({
      apiKey: geminiApiKey,
      model,
      base64Image: await fetchAttachmentBase64(attachment),
      mimeType,
      prompt,
    });
  }

  async function analyzeProviderJson(attachment, mimeType, triggerWords) {
    let firstError = null;
    let response;
    try {
      response = await callProvider(attachment, mimeType, { triggerWords });
      try {
        return parseVisionJson(response.text);
      } catch (error) {
        error.unbilledAiVision = Boolean(response.unbilledAiVision);
        throw error;
      }
    } catch (error) {
      if (!shouldRetryAiVisionError(error)) throw error;
      firstError = error;
    }

    try {
      response = await callProvider(attachment, mimeType, { retry: true, triggerWords });
      try {
        return parseVisionJson(response.text);
      } catch (error) {
        error.unbilledAiVision = Boolean(response.unbilledAiVision);
        throw error;
      }
    } catch (retryError) {
      if (!firstError) throw retryError;
      throw combineAiVisionErrors(firstError, retryError);
    }
  }

  async function analyzeAttachment(attachment, { triggerWords = [] } = {}) {
    const mimeType = attachmentMimeType(attachment);
    if (!SUPPORTED_IMAGE_TYPES.has(mimeType)) {
      throw new Error('No supported image attachment found.');
    }

    const cached = getCached(attachment);
    if (cached) return cached;

    const parsed = await analyzeProviderJson(attachment, mimeType, triggerWords);
    const result = {
      ...normalizeVisionResponse(parsed),
      provider,
      model,
      imageUrl: attachment.url,
      imageName: attachment.name || null,
      mimeType,
      cached: false,
    };
    setCached(attachment, result);
    return result;
  }

  return { analyzeAttachment, provider, model };
}

module.exports = {
  DEFAULT_OPENROUTER_MODEL,
  DEFAULT_GEMINI_MODEL,
  firstSupportedImageAttachment,
  createAiVisionChecker,
  decideScamFromVision,
  matchTriggerWords,
};
