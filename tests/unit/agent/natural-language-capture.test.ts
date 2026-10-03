import { describe, expect, it } from 'vitest';

import type {
  AgentAbortSignal,
  ModelProvider,
  ModelResponse,
} from '@workspace/agent-core';
import {
  CapturePreviewError,
  NaturalLanguageCapturePreviewer,
  type CaptureTimeContext,
} from '@workspace/agent-tools';
import { FakeModelProvider } from '@workspace/model-runtime';

const active: AgentAbortSignal = {
  aborted: false,
  addEventListener() {},
  removeEventListener() {},
};
const timeContext = {
  referenceInstant: '2026-09-16T01:00:00.000Z',
  timeZone: 'Asia/Shanghai',
  locale: 'zh-CN',
} as const;

function scriptedPreview(
  draft: Record<string, unknown>,
  uncertainFields: string[] = [],
): ModelResponse {
  return {
    text: '',
    toolCalls: [
      {
        id: 'fixture-preview',
        name: 'capture.preview',
        argumentsJson: JSON.stringify({ draft, uncertainFields }),
      },
    ],
    usage: null,
    finishReason: 'tool_calls',
  };
}

// These expected outputs are scripts, not a Chinese parser or model accuracy test.
const timeFixtures = [
  {
    text: '明天上午九点写报告',
    context: {
      referenceInstant: '2026-12-31T15:30:00.000Z',
      timeZone: 'Asia/Shanghai',
      locale: 'zh-CN',
    },
    draft: { title: '报告', earliestStartAt: '2027-01-01T01:00:00.000Z' },
    uncertain: ['duration'],
  },
  {
    text: '明天上午九点写报告',
    context: {
      referenceInstant: '2026-12-31T15:30:00.000Z',
      timeZone: 'America/Los_Angeles',
      locale: 'zh-CN',
    },
    draft: { title: '报告', earliestStartAt: '2027-01-01T17:00:00.000Z' },
    uncertain: ['duration'],
  },
  {
    text: '本周五前准备材料',
    context: {
      referenceInstant: '2026-10-04T16:30:00.000Z',
      timeZone: 'Asia/Shanghai',
      locale: 'zh-CN',
    },
    draft: { title: '材料' },
    uncertain: ['deadline', 'duration'],
  },
  {
    text: '下周完成总结',
    context: {
      referenceInstant: '2026-12-31T01:00:00.000Z',
      timeZone: 'Asia/Shanghai',
      locale: 'zh-CN',
    },
    draft: { title: '总结' },
    uncertain: ['deadline', 'duration'],
  },
  {
    text: '明天凌晨两点半整理',
    context: {
      referenceInstant: '2026-03-07T15:00:00.000Z',
      timeZone: 'America/New_York',
      locale: 'zh-CN',
    },
    draft: { title: '整理' },
    uncertain: ['earliestStart', 'duration'],
  },
  {
    text: '明天凌晨一点半整理',
    context: {
      referenceInstant: '2026-10-31T15:00:00.000Z',
      timeZone: 'America/New_York',
      locale: 'zh-CN',
    },
    draft: { title: '整理' },
    uncertain: ['earliestStart', 'duration'],
  },
  {
    text: '十月九日前交材料，只确定日期',
    context: timeContext,
    draft: {
      title: '材料',
      deadlineLocalDate: '2026-10-09',
      deadlineTimeZone: 'Asia/Shanghai',
    },
    uncertain: ['duration'],
  },
  {
    text: '有空时看看资料',
    context: timeContext,
    draft: {
      title: '资料',
      estimatedDurationMinutes: null,
      remainingDurationMinutes: null,
    },
    uncertain: ['earliestStart', 'duration'],
  },
];

describe('NaturalLanguageCapturePreviewer', () => {
  it('produces a validated non-persistent draft with explicit uncertainty', async () => {
    const provider = new FakeModelProvider([
      {
        response: {
          text: '',
          toolCalls: [
            {
              id: 'capture-1',
              name: 'capture.preview',
              argumentsJson: JSON.stringify({
                draft: {
                  title: '完成报告',
                  estimatedDurationMinutes: 120,
                  remainingDurationMinutes: 120,
                  deadlineAt: '2026-09-18T09:00:00.000Z',
                },
                uncertainFields: [],
              }),
            },
          ],
          usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
          finishReason: 'tool_calls',
        },
      },
    ]);
    const previewer = new NaturalLanguageCapturePreviewer(provider);

    await expect(
      previewer.preview('周五前完成报告，大概 2 小时', timeContext, active),
    ).resolves.toEqual({
      draft: expect.objectContaining({
        title: '完成报告',
        estimatedDurationMinutes: 120,
        remainingDurationMinutes: 120,
        deadlineAt: '2026-09-18T09:00:00.000Z',
        priority: 'normal',
        splittable: false,
        schedulingPolicy: 'flexible',
      }),
      uncertainFields: [],
      usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
    });
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]?.messages).toEqual([
      expect.objectContaining({ role: 'system' }),
      {
        role: 'system',
        content: 'Capture time context: ' + JSON.stringify(timeContext),
      },
      { role: 'user', content: '周五前完成报告，大概 2 小时' },
    ]);
    expect(JSON.stringify(provider.requests[0]?.messages)).not.toContain(
      'Achievement',
    );
    expect(provider.requests[0]?.tools.map(({ name }) => name)).toEqual([
      'capture.preview',
    ]);
  });

  it('rejects invalid or extra fields before they reach TaskService', async () => {
    const provider = new FakeModelProvider([
      {
        response: {
          text: '',
          toolCalls: [
            {
              id: 'capture-1',
              name: 'capture.preview',
              argumentsJson: JSON.stringify({
                draft: { title: 'Task', completed: true },
                uncertainFields: [],
              }),
            },
          ],
          usage: null,
          finishReason: 'tool_calls',
        },
      },
    ]);

    await expect(
      new NaturalLanguageCapturePreviewer(provider).preview(
        '完成它',
        timeContext,
        active,
      ),
    ).rejects.toBeInstanceOf(CapturePreviewError);
  });

  it('stops before a provider request when the execution window is aborted', async () => {
    const provider = new FakeModelProvider([]);
    const aborted = { ...active, aborted: true };

    await expect(
      new NaturalLanguageCapturePreviewer(provider).preview(
        '保留原文',
        timeContext,
        aborted,
      ),
    ).rejects.toMatchObject({ code: 'aborted', retryable: true });
    expect(provider.requests).toEqual([]);
  });

  it.each(timeFixtures)(
    'passes explicit context and preserves scripted uncertainty for $text / $context.timeZone',
    async ({ text, context, draft, uncertain }) => {
      const provider = new FakeModelProvider([
        { response: scriptedPreview(draft, uncertain) },
      ]);
      const result = await new NaturalLanguageCapturePreviewer(
        provider,
      ).preview(text, context, active);
      expect(result.draft).toMatchObject(draft);
      expect(result.uncertainFields).toEqual(uncertain);
      if (!('deadlineAt' in draft))
        expect(result.draft.deadlineAt).toBeUndefined();
      if (!('estimatedDurationMinutes' in draft))
        expect(result.draft.estimatedDurationMinutes).toBeUndefined();
      const messages = provider.requests[0]!.messages;
      expect(messages).toHaveLength(3);
      expect(messages[1]).toEqual({
        role: 'system',
        content: 'Capture time context: ' + JSON.stringify(context),
      });
      expect(messages[2]).toEqual({ role: 'user', content: text });
      expect(JSON.stringify(provider.requests)).not.toContain('Check-in');
    },
  );

  it.each([
    undefined,
    null,
    {},
    { ...timeContext, referenceInstant: '2026-02-30T01:00:00Z' },
    { ...timeContext, referenceInstant: '2026-10-03' },
    { ...timeContext, timeZone: '+08:00' },
    { ...timeContext, timeZone: 'Invalid/Fixture' },
    { ...timeContext, locale: 'zh_CN' },
    { ...timeContext, locale: '' },
    { ...timeContext, secret: 'fixture-secret' },
    { ...timeContext, calendarBody: 'fixture-secret' },
  ])(
    'rejects invalid or extra time context before contacting a provider: %#',
    async (context) => {
      const provider = new FakeModelProvider([]);
      const error = await new NaturalLanguageCapturePreviewer(provider)
        .preview('明天继续', context as CaptureTimeContext, active)
        .catch((value: unknown) => value);
      expect(error).toMatchObject({
        code: 'invalid_context',
        retryable: false,
      });
      expect((error as Error).message).not.toContain('fixture-secret');
      expect(provider.requests).toEqual([]);
    },
  );

  it('normalizes valid context without reading an implicit clock', async () => {
    const provider = new FakeModelProvider([
      { response: scriptedPreview({ title: '原文' }, ['duration']) },
    ]);
    await new NaturalLanguageCapturePreviewer(provider).preview(
      '原文',
      {
        referenceInstant: '2000-01-01T00:00:00Z',
        timeZone: 'UTC',
        locale: 'ZH-cn',
      },
      active,
    );
    expect(provider.requests[0]!.messages[1]!.content).toBe(
      'Capture time context: ' +
        JSON.stringify({
          referenceInstant: '2000-01-01T00:00:00.000Z',
          timeZone: 'UTC',
          locale: 'zh-CN',
        }),
    );
  });

  it.each(['authority', 'operationId', 'timeContext'])(
    'rejects a model-invented draft field %s',
    async (field) => {
      const provider = new FakeModelProvider([
        {
          response: scriptedPreview({
            title: 'Task',
            [field]: 'fixture-secret',
          }),
        },
      ]);
      const error = await new NaturalLanguageCapturePreviewer(provider)
        .preview('记录', timeContext, active)
        .catch((value: unknown) => value);
      expect(error).toMatchObject({ code: 'invalid_response' });
      expect((error as Error).message).not.toContain('fixture-secret');
    },
  );

  it('rejects late output after cancellation and sanitizes provider failures', async () => {
    const controller = new AbortController();
    const provider: ModelProvider = {
      complete: async () => {
        controller.abort();
        return scriptedPreview({ title: 'late' });
      },
      async *stream() {
        yield { type: 'done', finishReason: 'stop' };
      },
    };
    await expect(
      new NaturalLanguageCapturePreviewer(provider).preview(
        '取消',
        timeContext,
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: 'aborted' });
    const failed = new FakeModelProvider([
      {
        error: Object.assign(new Error('fixture-secret'), {
          status: 429,
          body: 'fixture-secret',
        }),
      },
    ]);
    const error = await new NaturalLanguageCapturePreviewer(failed)
      .preview('明天记录', timeContext, active)
      .catch((value: unknown) => value);
    expect(error).toMatchObject({ code: 'provider_error', retryable: true });
    expect((error as Error).message).not.toContain('fixture-secret');
    expect(error).not.toHaveProperty('cause');
  });
});
