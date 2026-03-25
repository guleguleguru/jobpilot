/**
 * ai-provider.js — AI 模型统一接口（Phase 4 重构）
 * 支持 7 种模型：DeepSeek / Gemini / 通义千问 / 智谱 GLM / Moonshot / Claude / 本地 Ollama
 * OpenAI 兼容格式共用同一调用路径，仅 baseUrl 不同；Gemini 和 Anthropic 单独处理
 */

const TIMEOUT_MS = 15000;

// ── 服务商预设配置表 ─────────────────────────────────────────

const PROVIDER_PRESETS = {
  deepseek: {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    format: 'openai',
  },
  gemini: {
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-pro'],
    format: 'gemini',
  },
  qwen: {
    name: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-turbo', 'qwen-plus', 'qwen-max'],
    format: 'openai',
  },
  zhipu: {
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4-flash', 'glm-4-plus', 'glm-4'],
    format: 'openai',
  },
  moonshot: {
    name: 'Moonshot / Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    format: 'openai',
  },
  claude: {
    name: 'Claude',
    baseUrl: 'https://api.anthropic.com',
    models: ['claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001'],
    format: 'anthropic',
  },
  ollama: {
    name: '本地 Ollama',
    baseUrl: 'http://localhost:11434/v1',
    models: ['qwen2.5:7b', 'llama3.1:8b', 'deepseek-r1:8b'],
    format: 'openai',
    noApiKey: true,
  },
};

// ── 格式 1: OpenAI 兼容（DeepSeek / 千问 / GLM / Moonshot / Ollama）──

/**
 * 调用 OpenAI 兼容格式的 API
 * @param {object[]} messages
 * @param {{ baseUrl, apiKey, model, temperature, jsonMode }} config
 * @param {AbortSignal} signal
 */
async function callOpenAI(messages, config, signal) {
  const { baseUrl, apiKey, model, temperature = 0.1, jsonMode = false } = config;

  const body = {
    model,
    messages,
    temperature,
    max_tokens: 2048,
  };

  // reasoner/thinking 模型不支持 json_object 格式
  if (jsonMode && !/reasoner|think|r1/i.test(model)) {
    body.response_format = { type: 'json_object' };
  }

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST', headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok) {
    const err = await resp.text().catch(() => resp.statusText);
    throw new Error(`${config.providerName || 'API'} 错误 ${resp.status}: ${err}`);
  }

  const data = await resp.json();
  return {
    content: data.choices?.[0]?.message?.content ?? '',
    usage: {
      promptTokens:     data.usage?.prompt_tokens     ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
    },
  };
}

// ── 格式 2: Gemini ────────────────────────────────────────────

function convertToGeminiFormat(messages) {
  let systemInstruction = null;
  const contents = [];
  for (const msg of messages) {
    if (msg.role === 'system') {
      systemInstruction = { parts: [{ text: msg.content }] };
    } else {
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      });
    }
  }
  if (!contents.length) contents.push({ role: 'user', parts: [{ text: '请开始。' }] });
  return { systemInstruction, contents };
}

async function callGemini(messages, config, signal) {
  const { baseUrl, apiKey, model, temperature = 0.1, jsonMode = false } = config;
  const { systemInstruction, contents } = convertToGeminiFormat(messages);

  const body = {
    contents,
    generationConfig: { temperature, maxOutputTokens: 2048 },
  };
  if (systemInstruction) body.systemInstruction = systemInstruction;
  if (jsonMode) body.generationConfig.responseMimeType = 'application/json';

  const url = `${baseUrl}/models/${model}:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok) {
    const err = await resp.text().catch(() => resp.statusText);
    throw new Error(`Gemini API 错误 ${resp.status}: ${err}`);
  }

  const data = await resp.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!content && data.candidates?.[0]?.finishReason === 'SAFETY') {
    throw new Error('Gemini 响应被安全过滤器拦截');
  }
  return {
    content,
    usage: {
      promptTokens:     data.usageMetadata?.promptTokenCount     ?? 0,
      completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    },
  };
}

// ── 格式 3: Anthropic (Claude) ───────────────────────────────

async function callAnthropic(messages, config, signal) {
  const { baseUrl, apiKey, model, temperature = 0.1 } = config;

  // 提取 system message，其余转为 Anthropic messages 格式
  let systemPrompt = '';
  const anthropicMessages = [];
  for (const msg of messages) {
    if (msg.role === 'system') {
      systemPrompt = msg.content;
    } else {
      // Anthropic 只接受 user / assistant
      anthropicMessages.push({ role: msg.role === 'assistant' ? 'assistant' : 'user', content: msg.content });
    }
  }

  const body = {
    model,
    max_tokens: 2048,
    temperature,
    messages: anthropicMessages,
  };
  if (systemPrompt) body.system = systemPrompt;

  const resp = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok) {
    const err = await resp.text().catch(() => resp.statusText);
    throw new Error(`Claude API 错误 ${resp.status}: ${err}`);
  }

  const data = await resp.json();
  return {
    content: data.content?.[0]?.text ?? '',
    usage: {
      promptTokens:     data.usage?.input_tokens  ?? 0,
      completionTokens: data.usage?.output_tokens ?? 0,
    },
  };
}

// ── Ollama 健康检查 ───────────────────────────────────────────

/**
 * 检查本地 Ollama 是否正在运行
 * @returns {Promise<boolean>}
 */
async function checkOllamaRunning() {
  try {
    const resp = await fetch('http://localhost:11434/api/tags', {
      signal: AbortSignal.timeout(3000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

// ── JSON 提取 ─────────────────────────────────────────────────

function extractJSON(text) {
  try { return JSON.parse(text.trim()); } catch (_) {}
  const fenced = text.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (fenced) { try { return JSON.parse(fenced[1].trim()); } catch (_) {} }
  const brace = text.match(/\{[\s\S]+\}/);
  if (brace)  { try { return JSON.parse(brace[0]); }          catch (_) {} }
  throw new Error(`无法从 AI 响应中提取 JSON:\n${text.slice(0, 300)}`);
}

// ── AIProvider 统一类 ─────────────────────────────────────────

class AIProvider {
  /**
   * @param {{ provider: string, apiKey?: string, model: string, temperature?: number }} config
   */
  constructor(config) {
    const preset = PROVIDER_PRESETS[config.provider] || PROVIDER_PRESETS.deepseek;
    this.config = {
      ...config,
      baseUrl:      preset.baseUrl,
      format:       preset.format,
      providerName: preset.name,
    };
  }

  /**
   * 发送消息并获取响应
   * @param {object[]} messages
   * @param {{ jsonMode?: boolean }} options
   */
  async complete(messages, options = {}) {
    const { format, provider } = this.config;
    const timeoutMs = options.timeout ?? TIMEOUT_MS;

    // Ollama 特殊预检
    if (provider === 'ollama') {
      const running = await checkOllamaRunning();
      if (!running) throw new Error('Ollama 未运行，请先执行 ollama serve');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const callConfig = { ...this.config, jsonMode: options.jsonMode ?? false };

      if (format === 'gemini')    return await callGemini(messages,    callConfig, controller.signal);
      if (format === 'anthropic') return await callAnthropic(messages, callConfig, controller.signal);
      return await callOpenAI(messages, callConfig, controller.signal); // openai 格式（默认）
    } catch (err) {
      if (err.name === 'AbortError') throw new Error(`AI 请求超时（>${timeoutMs / 1000}s）`);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 调用 AI 并强制返回解析后的 JSON 对象
   * @param {object[]} messages
   * @param {{ timeout?: number }} options
   */
  async completeJSON(messages, options = {}) {
    const { content, usage } = await this.complete(messages, { jsonMode: true, ...options });
    return { json: extractJSON(content), usage };
  }
}

export { AIProvider, PROVIDER_PRESETS, checkOllamaRunning, extractJSON };
