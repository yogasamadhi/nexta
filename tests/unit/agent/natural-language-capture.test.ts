import { describe, expect, it } from 'vitest';

import type { AgentAbortSignal } from '@workspace/agent-core';
import {
  CapturePreviewError,
  NaturalLanguageCapturePreviewer,
} from '@workspace/agent-tools';
import { FakeModelProvider } from '@workspace/model-runtime';

const active: AgentAbortSignal = {
  aborted: false,
  addEventListener() {},
  removeEventListener() {},
};

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
      previewer.preview('周五前完成报告，大概 2 小时', active),
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
      new NaturalLanguageCapturePreviewer(provider).preview('完成它', active),
    ).rejects.toBeInstanceOf(CapturePreviewError);
  });

  it('stops before a provider request when the execution window is aborted', async () => {
    const provider = new FakeModelProvider([]);
    const aborted = { ...active, aborted: true };

    await expect(
      new NaturalLanguageCapturePreviewer(provider).preview(
        '保留原文',
        aborted,
      ),
    ).rejects.toMatchObject({ code: 'aborted', retryable: true });
    expect(provider.requests).toEqual([]);
  });
});
