import { z } from 'zod';

import { postJson } from './transport.js';

export const EndpointSchema = z.strictObject({
  id: z.string(),
  provider: z.enum(['anthropic', 'azure', 'onprem']),
  url: z.url(),
  residency: z.string().min(1),
  models: z.array(z.string()).min(1),
  addresses: z.array(z.string()).min(1),
});
export type Endpoint = z.infer<typeof EndpointSchema>;
export interface Completion {
  text: string;
  inputTokens: number;
  outputTokens: number;
}
export interface LlmProvider {
  complete(
    endpoint: Endpoint,
    key: string,
    model: string,
    system: string,
    data: string,
    maxTokens: number,
    signal: AbortSignal,
  ): Promise<Completion>;
}
const usage = z.number().int().nonnegative().max(10_000_000);
const ClaudeSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  usage: z.object({ input_tokens: usage, output_tokens: usage }),
});
const OpenAiSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
  usage: z.object({ prompt_tokens: usage, completion_tokens: usage }),
});
export class JsonLlmProvider implements LlmProvider {
  async complete(
    endpoint: Endpoint,
    key: string,
    model: string,
    system: string,
    data: string,
    maxTokens: number,
    signal: AbortSignal,
  ): Promise<Completion> {
    const claude = endpoint.provider === 'anthropic';
    const raw = await postJson(
      endpoint.url,
      endpoint.addresses,
      claude
        ? { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: data }] }
        : {
            model,
            ...(endpoint.provider === 'onprem'
              ? { max_tokens: maxTokens }
              : { max_completion_tokens: maxTokens }),
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: data },
            ],
            stream: false,
          },
      claude
        ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
        : endpoint.provider === 'azure'
          ? { 'api-key': key }
          : { authorization: `Bearer ${key}` },
      signal,
    );
    if (claude) {
      const parsed = ClaudeSchema.parse(raw);
      return {
        text: parsed.content
          .filter((x) => x.type === 'text')
          .map((x) => x.text ?? '')
          .join(''),
        inputTokens: parsed.usage.input_tokens,
        outputTokens: parsed.usage.output_tokens,
      };
    }
    const parsed = OpenAiSchema.parse(raw);
    const choice = parsed.choices[0];
    if (!choice) throw new Error('EMPTY_CHOICES');
    return {
      text: choice.message.content ?? '',
      inputTokens: parsed.usage.prompt_tokens,
      outputTokens: parsed.usage.completion_tokens,
    };
  }
}
