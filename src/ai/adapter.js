// Model access for the personal build. Keys live only in this browser's localStorage.
// Anthropic goes through the official SDK; DeepSeek and other OpenAI-compatible gateways
// go through their chat-completions endpoint with fetch. Both stream and can be aborted.
import { systemPrompt } from './prompts.js';
import { AI_PROVIDERS, defaultProviders } from '../state/schema.js';

// The SDK is vendored (vendor/anthropic-sdk) so the app works offline and in networks where
// esm.sh is unreachable; the CDN copy is only a fallback.
const SDK_LOCAL = new URL('../../vendor/anthropic-sdk/index.mjs', import.meta.url).href;
const SDK_URL = 'https://esm.sh/@anthropic-ai/sdk@0.133.0';
let sdkPromise = null;

export const PROVIDERS = {
  anthropic: {
    label: 'Anthropic Claude',
    keyPlaceholder: 'sk-ant-...',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
    note: '走官方 SDK。支持思考深度；翻译固定用低深度。留空 API 地址即用官方接口。',
    docs: 'https://platform.claude.com/',
  },
  deepseek: {
    label: 'DeepSeek',
    keyPlaceholder: 'sk-...',
    models: ['deepseek-v4-pro', 'deepseek-flash', 'deepseek-chat', 'deepseek-reasoner'],
    note: 'OpenAI 兼容接口，浏览器可直连。解释和总结建议用 deepseek-v4-pro（写得更好），翻译用 deepseek-flash（快且便宜）。',
    docs: 'https://api-docs.deepseek.com/',
  },
  openai: {
    label: 'OpenAI 兼容',
    keyPlaceholder: 'sk-...',
    models: ['gpt-5', 'gpt-5-mini', 'gpt-4.1', 'gpt-4o'],
    note: '任何 OpenAI 兼容网关：OpenAI 官方、OpenRouter、本地 Ollama 等。API 地址填到 /v1 为止。',
    docs: 'https://platform.openai.com/docs/api-reference',
  },
};

export const EFFORTS = [
  { id: 'low', label: '低（翻译、短回答）' },
  { id: 'medium', label: '中（默认）' },
  { id: 'high', label: '高（深入解释）' },
];

export function providerConfig(settings, id) {
  const ai = settings && settings.ai;
  if (!ai) return null;
  const pid = AI_PROVIDERS.includes(id) ? id : ai.provider;
  const cfg = { ...defaultProviders()[pid], ...((ai.providers && ai.providers[pid]) || {}) };
  return { id: pid, label: PROVIDERS[pid].label, apiKey: (cfg.apiKey || '').trim(), model: (cfg.model || '').trim() || defaultProviders()[pid].model, fastModel: (cfg.fastModel || '').trim(), baseUrl: (cfg.baseUrl || '').trim() };
}

export function aiReady(settings, id) {
  const ai = settings && settings.ai;
  if (!ai || !ai.enabled) return false;
  const cfg = providerConfig(settings, id);
  return !!(cfg && cfg.apiKey);
}

// ---------- Anthropic (official SDK) ----------
async function loadSdk() {
  if (!sdkPromise) {
    sdkPromise = import(SDK_LOCAL).catch(err => { console.warn('本地 SDK 加载失败，改用 CDN', err); return import(SDK_URL); }).then(m => m.default || m.Anthropic || m);
  }
  return sdkPromise;
}

async function anthropicClient(cfg) {
  const Anthropic = await loadSdk();
  return { Anthropic, client: new Anthropic({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl || undefined, dangerouslyAllowBrowser: true, maxRetries: 1 }) };
}

function describeAnthropicError(Anthropic, err) {
  if (!err) return '未知错误';
  if (Anthropic && typeof Anthropic === 'function') {
    if (Anthropic.APIUserAbortError && err instanceof Anthropic.APIUserAbortError) return '已取消';
    if (Anthropic.AuthenticationError && err instanceof Anthropic.AuthenticationError) return 'API Key 无效或没有权限';
    if (Anthropic.PermissionDeniedError && err instanceof Anthropic.PermissionDeniedError) return '没有权限使用这个模型';
    if (Anthropic.RateLimitError && err instanceof Anthropic.RateLimitError) return '请求过于频繁，请稍后再试';
    if (Anthropic.BadRequestError && err instanceof Anthropic.BadRequestError) return '请求被拒绝：' + (err.message || '参数错误');
    if (Anthropic.APIConnectionError && err instanceof Anthropic.APIConnectionError) return '连接不上接口，请检查网络或 API 地址';
    if (Anthropic.APIError && err instanceof Anthropic.APIError) return '接口错误 ' + (err.status || '') + '：' + (err.message || '');
  }
  return err.message || String(err);
}

function dataUrlParts(dataUrl) {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(String(dataUrl || ''));
  return m ? { mime: m[1], data: m[3] } : null;
}

async function streamAnthropic({ cfg, settings, system, user, effort, maxTokens, onDelta, signal, started, images = [] }) {
  const { Anthropic, client } = await anthropicClient(cfg);
  const content = images.length
    ? [...images.map(dataUrlParts).filter(Boolean).map(x => ({ type: 'image', source: { type: 'base64', media_type: x.mime, data: x.data } })), { type: 'text', text: user }]
    : user;
  const params = {
    model: cfg.model,
    max_tokens: maxTokens || 16000,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content }],
    thinking: { type: 'adaptive' },
    output_config: { effort: effort || settings.ai.effort || 'medium' },
    // Server-side refusal fallback: a classifier decline is re-run on Anthropic's recommended model.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  };
  const stream = client.beta.messages.stream(params);
  if (signal) {
    if (signal.aborted) stream.abort();
    else signal.addEventListener('abort', () => stream.abort(), { once: true });
  }
  stream.on('text', t => { if (onDelta) onDelta(t); });
  try {
    const msg = await stream.finalMessage();
    const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
    return {
      ok: msg.stop_reason !== 'refusal', refused: msg.stop_reason === 'refusal', truncated: msg.stop_reason === 'max_tokens',
      text, model: msg.model, latencyMs: Math.round(performance.now() - started), usage: msg.usage,
      error: msg.stop_reason === 'refusal' ? '模型拒绝了这个请求' + (msg.stop_details && msg.stop_details.explanation ? '：' + msg.stop_details.explanation : '') : '',
    };
  } catch (err) {
    const aborted = !!(Anthropic.APIUserAbortError && err instanceof Anthropic.APIUserAbortError);
    return { ok: false, text: '', model: cfg.model, latencyMs: Math.round(performance.now() - started), error: describeAnthropicError(Anthropic, err), aborted };
  }
}

async function testAnthropic(cfg) {
  const { Anthropic, client } = await anthropicClient(cfg);
  const started = performance.now();
  try {
    const msg = await client.messages.create({ model: cfg.model, max_tokens: 1024, output_config: { effort: 'low' }, messages: [{ role: 'user', content: '回复“连接正常”四个字。' }] });
    const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
    return { ok: true, text, model: msg.model, latencyMs: Math.round(performance.now() - started), usage: msg.usage };
  } catch (err) {
    return { ok: false, error: describeAnthropicError(Anthropic, err), latencyMs: Math.round(performance.now() - started) };
  }
}

// ---------- OpenAI-compatible (DeepSeek, OpenAI, gateways) ----------
function chatUrl(cfg) {
  return (cfg.baseUrl || defaultProviders()[cfg.id].baseUrl).replace(/\/+$/, '') + '/chat/completions';
}

async function readError(res) {
  let msg = '';
  try { const j = await res.json(); msg = (j.error && (j.error.message || j.error.type)) || j.message || ''; } catch {}
  if (res.status === 401) return 'API Key 无效' + (msg ? '：' + msg : '');
  if (res.status === 402) return '账户余额不足，请到平台充值';
  if (res.status === 403) return '没有权限' + (msg ? '：' + msg : '');
  if (res.status === 404) return '接口地址或模型不存在' + (msg ? '：' + msg : '');
  if (res.status === 429) return '请求过于频繁或额度用完' + (msg ? '：' + msg : '');
  if (res.status >= 500) return '平台服务端错误 ' + res.status + (msg ? '：' + msg : '');
  return '请求被拒绝 ' + res.status + (msg ? '：' + msg : '');
}

function describeFetchError(err) {
  if (err && err.name === 'AbortError') return '已取消';
  if (err instanceof TypeError) return '连接不上接口：网络问题，或该平台不允许浏览器直连（CORS）';
  return (err && err.message) || String(err);
}

// Some platforms return control characters inside JSON strings; fall back to a cleaned parse.
function parseJsonLoose(text) {
  try { return JSON.parse(text); } catch { return JSON.parse(String(text).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').replace(/\n|\t/g, ' ')); }
}

// DeepSeek's V4 models reason by default (several seconds even for one sentence). Turn it off for
// quick tasks and low effort; keep it for deeper explanations.
function extraBodyFor(cfg, { fast, effort }) {
  if (cfg.id === 'deepseek' && (fast || effort === 'low')) return { thinking: { type: 'disabled' } };
  return {};
}

async function streamOpenAI({ cfg, system, user, maxTokens, onDelta, onStatus, signal, started, fast, effort, images = [] }) {
  // Platforms cap max_tokens differently; start high and step down if the platform rejects the value.
  const candidates = [maxTokens || 16000, 8192, 4096].filter((v, i, a) => a.indexOf(v) === i && v > 0);
  const userContent = images.length ? [...images.map(url => ({ type: 'image_url', image_url: { url } })), { type: 'text', text: user }] : user;
  let res = null;
  for (let i = 0; i < candidates.length; i++) {
    try {
      res = await fetch(chatUrl(cfg), {
        method: 'POST', signal,
        headers: { 'Authorization': 'Bearer ' + cfg.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: cfg.model, messages: [{ role: 'system', content: system }, { role: 'user', content: userContent }], stream: true, max_tokens: candidates[i], ...extraBodyFor(cfg, { fast, effort }) }),
      });
    } catch (err) {
      return { ok: false, text: '', model: cfg.model, latencyMs: Math.round(performance.now() - started), error: describeFetchError(err), aborted: err && err.name === 'AbortError' };
    }
    if (res.status === 400 && i < candidates.length - 1) {
      let msg = '';
      try { msg = JSON.stringify(await res.clone().json()); } catch {}
      if (/max_tokens|maximum.*tokens|max tokens/i.test(msg)) continue;
    }
    break;
  }
  if (!res.ok) return { ok: false, text: '', model: cfg.model, latencyMs: Math.round(performance.now() - started), error: await readError(res) };
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', text = '', finish = null, model = cfg.model, usage = null, thinkingSeen = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let j;
        try { j = parseJsonLoose(data); } catch { continue; }
        if (j.error) throw new Error(j.error.message || '平台返回错误');
        if (j.model) model = j.model;
        if (j.usage) usage = j.usage;
        const ch = j.choices && j.choices[0];
        if (!ch) continue;
        const d = ch.delta || {};
        if (typeof d.reasoning_content === 'string' && d.reasoning_content && !thinkingSeen) { thinkingSeen = true; if (onStatus) onStatus('thinking'); }
        if (typeof d.content === 'string' && d.content) { if (thinkingSeen && !text && onStatus) onStatus('answering'); text += d.content; if (onDelta) onDelta(d.content); }
        if (ch.finish_reason) finish = ch.finish_reason;
      }
    }
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    return { ok: false, text, model, latencyMs: Math.round(performance.now() - started), error: describeFetchError(err), aborted };
  }
  return { ok: finish !== 'content_filter', refused: finish === 'content_filter', truncated: finish === 'length', text, model, usage, latencyMs: Math.round(performance.now() - started), error: finish === 'content_filter' ? '平台的内容过滤拒绝了这个请求' : '' };
}

async function testOpenAI(cfg) {
  const started = performance.now();
  try {
    const res = await fetch(chatUrl(cfg), {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + cfg.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: '回复“连接正常”四个字。' }], stream: false, max_tokens: 1024, ...extraBodyFor(cfg, { fast: true }) }),
    });
    if (!res.ok) return { ok: false, error: await readError(res), latencyMs: Math.round(performance.now() - started) };
    const j = parseJsonLoose(await res.text());
    const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    return { ok: true, text, model: j.model || cfg.model, latencyMs: Math.round(performance.now() - started), usage: j.usage };
  } catch (err) {
    return { ok: false, error: describeFetchError(err), latencyMs: Math.round(performance.now() - started) };
  }
}

// ---------- public API ----------
// Streams an answer with the current provider. onDelta(text) receives each chunk.
// fast=true uses the provider's quick model (translation) when one is configured.
export async function streamAnswer({ settings, user, effort, maxTokens, onDelta, onStatus, signal, provider, fast = false, system = null, images = [] }) {
  const base = providerConfig(settings, provider);
  const cfg = base && fast && base.fastModel ? { ...base, model: base.fastModel } : base;
  const started = performance.now();
  if (!cfg || !cfg.apiKey) return { ok: false, text: '', model: '', latencyMs: 0, error: '当前平台没有填写 API Key' };
  const sys = system || systemPrompt(settings);
  const args = { cfg, settings, system: sys, user, effort, maxTokens, onDelta, onStatus, signal, started, fast, images };
  const result = cfg.id === 'anthropic' ? await streamAnthropic(args) : await streamOpenAI(args);
  return { ...result, provider: cfg.id };
}

export async function testConnection(settings, provider) {
  const cfg = providerConfig(settings, provider);
  if (!cfg || !cfg.apiKey) return { ok: false, error: '没有填写 API Key' };
  const r = cfg.id === 'anthropic' ? await testAnthropic(cfg) : await testOpenAI(cfg);
  return { ...r, provider: cfg.id };
}
