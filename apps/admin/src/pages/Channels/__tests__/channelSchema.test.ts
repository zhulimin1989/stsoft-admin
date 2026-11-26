import { describe, expect, it } from 'vitest';
import { createChannelSchema, updateChannelSchema } from '@ruidong/shared';

const baseChannel = {
  name: 'OpenAI main',
  provider: 'openai',
  baseUrl: 'https://api.example.com',
  apiKey: 'sk-test',
};

describe('channel runtime schema', () => {
  it('accepts known runtime contract fields', () => {
    const result = createChannelSchema.safeParse({
      ...baseChannel,
      sdkType: 'openai_responses',
      providerProfile: 'openai_responses_native',
      servedInboundProtocols: '["responses","openai"]',
      tokenCountStrategy: 'unsupported',
    });

    expect(result.success).toBe(true);
  });

  it('preserves the provider account identity when rotating a channel key', () => {
    const result = updateChannelSchema.safeParse({
      apiKey: 'sk-rotated',
      providerAccountIdentityId: 'identity-kimi-main',
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      apiKey: 'sk-rotated',
      providerAccountIdentityId: 'identity-kimi-main',
    });
  });

  it('rejects unknown provider profile and sdk type values', () => {
    expect(createChannelSchema.safeParse({
      ...baseChannel,
      sdkType: 'openai-but-not-really',
    }).success).toBe(false);

    expect(createChannelSchema.safeParse({
      ...baseChannel,
      providerProfile: 'custom_profile',
    }).success).toBe(false);
  });

  it('validates served inbound protocol values inside string payloads', () => {
    expect(createChannelSchema.safeParse({
      ...baseChannel,
      servedInboundProtocols: '["responses","unknown_protocol"]',
    }).success).toBe(false);
  });

  it('validates explicit protocol paths', () => {
    expect(createChannelSchema.safeParse({
      ...baseChannel,
      protocolPaths: [
        { inbound_protocol: 'openai', channel: 'passthrough' },
        { inbound_protocol: 'responses', channel: 'responses_to_chat' },
      ],
    }).success).toBe(true);

    expect(createChannelSchema.safeParse({
      ...baseChannel,
      protocolPaths: [
        { inbound_protocol: 'responses', channel: 'auto' },
      ],
    }).success).toBe(false);
  });

  it('rejects unknown token count strategy', () => {
    expect(createChannelSchema.safeParse({
      ...baseChannel,
      tokenCountStrategy: 'count_it_somehow',
    }).success).toBe(false);
  });

  it('accepts explicit dedicated channels and rejects legacy dedicated strategies', () => {
    for (const dedicatedProtocolStrategy of ['passthrough', 'responses_to_chat', 'anthropic_to_chat']) {
      expect(createChannelSchema.safeParse({
        ...baseChannel,
        dedicatedClientProtocol: 'openai',
        dedicatedProtocolStrategy,
      }).success).toBe(true);
    }

    for (const dedicatedProtocolStrategy of ['auto', 'passthrough_only']) {
      expect(createChannelSchema.safeParse({
        ...baseChannel,
        dedicatedClientProtocol: 'openai',
        dedicatedProtocolStrategy,
      }).success).toBe(false);
    }
  });
});
