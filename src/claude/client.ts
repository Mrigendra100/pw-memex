import Anthropic from '@anthropic-ai/sdk';
import * as dotenv from 'dotenv';

dotenv.config();

type AIProvider = 'anthropic' | 'openai' | 'gemini';

function getProvider(): AIProvider {
  const raw = (process.env.AI_PROVIDER || 'anthropic').toLowerCase();
  if (raw !== 'anthropic' && raw !== 'openai' && raw !== 'gemini') {
    throw new Error(
      `Unsupported AI_PROVIDER: "${raw}". Valid values: anthropic, openai, gemini`
    );
  }
  return raw as AIProvider;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function safeRequire(pkg: string, installCmd: string): any {
  try {
    return require(pkg);
  } catch {
    throw new Error(`${pkg} is not installed. Run: ${installCmd}`);
  }
}

// ─── Anthropic ────────────────────────────────────────────────────────────────

let _anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!_anthropicClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY is not set. Add it to your .env file or environment.'
      );
    }
    _anthropicClient = new Anthropic({ apiKey });
  }
  return _anthropicClient;
}

async function callAnthropic(
  prompt: string,
  options: { maxTokens?: number }
): Promise<string> {
  const client = getAnthropicClient();
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

  const message = await client.messages.create({
    model,
    max_tokens: options.maxTokens || 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const block = message.content[0];
  if (block.type !== 'text') {
    throw new Error(`Unexpected response type from Anthropic: ${block.type}`);
  }
  return block.text.trim();
}

// ─── OpenAI ───────────────────────────────────────────────────────────────────

/**
 * Newer OpenAI models (gpt-5 series, o1/o3/o4 reasoning models) reject the
 * legacy `max_tokens` parameter and require `max_completion_tokens` instead.
 * Legacy models (gpt-4, gpt-4o, gpt-3.5-turbo, etc.) still use `max_tokens`.
 *
 * Users can also force the new parameter name via `OPENAI_USE_COMPLETION_TOKENS=1`
 * for any custom/forked model name this heuristic doesn't recognise.
 */
function openAIUsesCompletionTokens(model: string): boolean {
  if (process.env.OPENAI_USE_COMPLETION_TOKENS === '1') return true;
  const m = model.toLowerCase();
  return (
    m.startsWith('gpt-5') ||
    m.startsWith('o1') ||
    m.startsWith('o3') ||
    m.startsWith('o4')
  );
}

async function callOpenAI(
  prompt: string,
  options: { maxTokens?: number }
): Promise<string> {
  const { default: OpenAI } = safeRequire('openai', 'npm install openai');

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set. Add it to your .env file or environment.');
  }

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL || 'gpt-4o';
  const tokenLimit = options.maxTokens || 1024;

  // Build the request body with the correct token-limit parameter for this model.
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: 'user', content: prompt }],
  };
  if (openAIUsesCompletionTokens(model)) {
    body.max_completion_tokens = tokenLimit;
  } else {
    body.max_tokens = tokenLimit;
  }

  const response = await client.chat.completions.create(body as any);
  return response.choices[0]?.message?.content?.trim() || '';
}

// ─── Gemini ───────────────────────────────────────────────────────────────────

async function callGemini(
  prompt: string,
  options: { maxTokens?: number }
): Promise<string> {
  const { GoogleGenerativeAI } = safeRequire(
    '@google/generative-ai',
    'npm install @google/generative-ai'
  );

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set. Add it to your .env file or environment.');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-pro';
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: { maxOutputTokens: options.maxTokens || 1024 },
  });

  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}

// ─── Public API (signature unchanged) ────────────────────────────────────────

export async function callClaude(
  prompt: string,
  options: { maxTokens?: number; jsonMode?: boolean } = {}
): Promise<string> {
  const provider = getProvider();

  let text: string;
  if (provider === 'anthropic') {
    text = await callAnthropic(prompt, options);
  } else if (provider === 'openai') {
    text = await callOpenAI(prompt, options);
  } else {
    text = await callGemini(prompt, options);
  }

  if (options.jsonMode) {
    // Strip markdown code fences if the model added them
    return text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  }

  return text;
}
