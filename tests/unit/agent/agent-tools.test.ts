import { describe, expect, it, vi } from 'vitest';

import type { AgentToolExecutionContext } from '@workspace/agent-core';
import {
  createV1AgentToolRegistry,
  createV1AgentTools,
  v1AgentToolNames,
  type AgentToolServices,
} from '@workspace/agent-tools';

function context(
  risk: AgentToolExecutionContext['risk'] = 'read',
): AgentToolExecutionContext {
  return {
    runId: 'run-1',
    trigger: 'user_input',
    toolCallId: 'call-1',
    risk,
    authorizationId: risk === 'read' ? null : 'approval-1',
    signal: {
      aborted: false,
      addEventListener() {},
      removeEventListener() {},
    },
  };
}

function fixture() {
  const calls = {
    taskCreate: vi.fn(async () => ({ task: { id: 'task-1' } })),
    taskUpdate: vi.fn(async () => ({ task: { id: 'task-1' } })),
    taskComplete: vi.fn(async () => ({ task: { id: 'task-1' } })),
    taskList: vi.fn(async () => ({ items: [], nextCursor: null })),
    calendarBusy: vi.fn(async () => ({ events: [] })),
    preview: vi.fn(async () => ({ previewId: 'preview-1' })),
    replan: vi.fn(async () => ({ previewId: 'preview-2' })),
    commit: vi.fn(async () => ({ operationId: 'operation-1' })),
    executionStart: vi.fn(async () => ({ session: { id: 'session-1' } })),
    executionFinish: vi.fn(async () => ({ session: { id: 'session-1' } })),
    achievementCreate: vi.fn(async () => ({ achievement: { id: 'win-1' } })),
    achievementList: vi.fn(async () => ({ items: [], nextCursor: null })),
    reconcileNotifications: vi.fn(async () => ({ channel: 'notification' })),
    preferenceGet: vi.fn(async () => null),
    preferenceUpdate: vi.fn(async () => ({ preference: { id: 'pref-1' } })),
    resolveRange: vi.fn(() => ({
      start: '2026-09-11T16:00:00.000Z',
      end: '2026-09-13T16:00:00.000Z',
    })),
  };
  const services = {
    tasks: {
      create: calls.taskCreate,
      update: calls.taskUpdate,
      complete: calls.taskComplete,
      list: calls.taskList,
    },
    calendar: { listBusy: calls.calendarBusy },
    scheduler: {
      preview: calls.preview,
      replan: calls.replan,
      commit: calls.commit,
    },
    execution: {
      start: calls.executionStart,
      finish: calls.executionFinish,
    },
    achievements: {
      create: calls.achievementCreate,
      list: calls.achievementList,
    },
    notifications: {
      reconcileNotifications: calls.reconcileNotifications,
    },
    preferences: {
      get: calls.preferenceGet,
      update: calls.preferenceUpdate,
    },
    calendarScopes: [{ provider: 'system', calendarId: 'work' }],
    localDateRanges: { resolve: calls.resolveRange },
  } as unknown as AgentToolServices;
  return { services, calls };
}

describe('V1 Agent tools', () => {
  it('registers the complete documented matrix with schemas and risk floors', () => {
    const { services } = fixture();
    const tools = createV1AgentTools(services);
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    expect([...byName.keys()]).toEqual(v1AgentToolNames);
    expect(createV1AgentToolRegistry(services).definitions()).toHaveLength(15);
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.inputJsonSchema).toEqual(expect.any(Object));
      expect(tool.inputSchema).toHaveProperty('parse');
      expect(tool.outputSchema).toHaveProperty('parse');
    }
    expect(
      Object.fromEntries(tools.map((tool) => [tool.name, tool.risk])),
    ).toEqual({
      'task.create': 'low_write',
      'task.update': 'low_write',
      'task.complete': 'high_write',
      'task.list': 'read',
      'calendar.listBusy': 'read',
      'scheduler.preview': 'read',
      'scheduler.replan': 'read',
      'scheduler.commit': 'high_write',
      'execution.start': 'low_write',
      'execution.complete': 'high_write',
      'achievement.create': 'low_write',
      'achievement.list': 'read',
      'notification.reschedule': 'low_write',
      'preference.read': 'read',
      'preference.update': 'high_write',
    });
  });

  it('rejects model-supplied authority and derives write identity from the host context', async () => {
    const { services, calls } = fixture();
    const tool = createV1AgentToolRegistry(services).get('task.create')!;
    expect(() =>
      tool.inputSchema.parse({
        title: 'Captured task',
        operationId: 'model-controlled',
      }),
    ).toThrow();

    await tool.execute(
      tool.inputSchema.parse({ title: 'Captured task' }),
      context('low_write'),
    );

    expect(calls.taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Captured task' }),
      {
        operationId: 'agent:run-1:call-1',
        authority: {
          kind: 'agent_authorized',
          authorizationId: 'approval-1',
        },
      },
    );
  });

  it('upgrades scheduling-impacting Task patches conservatively', () => {
    const { services } = fixture();
    const tool = createV1AgentToolRegistry(services).get('task.update')!;

    expect(
      tool.assessRisk?.({ taskId: 'task-1', patch: { title: 'Rename' } }),
    ).toBe('low_write');
    expect(
      tool.assessRisk?.({
        taskId: 'task-1',
        patch: { deadlineAt: '2026-09-13T00:00:00.000Z' },
      }),
    ).toBe('high_write');
  });

  it('enforces the host calendar scope and returns only cached busy data', async () => {
    const { services, calls } = fixture();
    const tool = createV1AgentToolRegistry(services).get('calendar.listBusy')!;
    const range = {
      start: '2026-09-12T00:00:00.000Z',
      end: '2026-09-13T00:00:00.000Z',
    };

    await expect(
      tool.execute(
        tool.inputSchema.parse({
          provider: 'system',
          calendarId: 'private',
          range,
        }),
        context(),
      ),
    ).rejects.toMatchObject({ code: 'permission_required' });
    expect(calls.calendarBusy).not.toHaveBeenCalled();

    await tool.execute(
      tool.inputSchema.parse({
        provider: 'system',
        calendarId: 'work',
        range,
      }),
      context(),
    );
    expect(calls.calendarBusy).toHaveBeenCalledWith({
      provider: 'system',
      calendarId: 'work',
      range,
      limit: 100,
    });
  });

  it('resolves local Achievement dates outside pure application code and paginates', async () => {
    const { services, calls } = fixture();
    const tool = createV1AgentToolRegistry(services).get('achievement.list')!;
    await tool.execute(
      tool.inputSchema.parse({
        localDateRange: { start: '2026-09-12', end: '2026-09-13' },
        timeZone: 'Asia/Shanghai',
        limit: 10,
      }),
      context(),
    );

    expect(calls.resolveRange).toHaveBeenCalledWith({
      start: '2026-09-12',
      endInclusive: '2026-09-13',
      timeZone: 'Asia/Shanghai',
    });
    expect(calls.achievementList).toHaveBeenCalledWith({
      range: {
        start: '2026-09-11T16:00:00.000Z',
        end: '2026-09-13T16:00:00.000Z',
      },
      limit: 10,
    });
  });

  it('requires write authorization even for a bounded notification wake-up', async () => {
    const { services, calls } = fixture();
    const tool = createV1AgentToolRegistry(services).get(
      'notification.reschedule',
    )!;
    await expect(
      tool.execute({ planRevision: 3 }, context()),
    ).rejects.toMatchObject({ code: 'permission_required' });
    expect(calls.reconcileNotifications).not.toHaveBeenCalled();

    await tool.execute({ planRevision: 3 }, context('low_write'));
    expect(calls.reconcileNotifications).toHaveBeenCalledWith(3);
  });
});
