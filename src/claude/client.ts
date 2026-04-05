import Anthropic from '@anthropic-ai/sdk';
import * as dotenv from 'dotenv';

dotenv.config();

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY is not set. Add it to your .env file or environment.'
      );
    }
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

export async function callClaude(
  prompt: string,
  options: { maxTokens?: number; jsonMode?: boolean } = {}
): Promise<string> {
  const client = getClient();
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

  const message = await client.messages.create({
    model,
    max_tokens: options.maxTokens || 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const block = message.content[0];
  if (block.type !== 'text') {
    throw new Error(`Unexpected response type from Claude: ${block.type}`);
  }

  const text = block.text.trim();

  if (options.jsonMode) {
    // Strip markdown code fences if the model added them
    return text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  }

  return text;
}
