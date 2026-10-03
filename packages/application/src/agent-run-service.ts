import {
  agentRunStatusValues,
  agentRunTriggerValues,
  checkpointAgentRun,
  createAgentRun,
  finishAgentRun,
  parseAgentRunId,
  type AgentRun,
} from '@workspace/domain';
import { z } from 'zod';

import { ApplicationError } from './errors';
import type { ApplicationUnitOfWork, Clock } from './ports';
import {
  parseBoundaryInput,
  protectApplicationCall,
  readClock,
} from './service-support';

const nonEmptyString = z.string().trim().min(1);
const turnCountSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

export const startAgentRunInputSchema = z
  .object({
    runId: nonEmptyString,
    trigger: z.enum(agentRunTriggerValues),
    modelProvider: nonEmptyString.nullable().optional(),
  })
  .strict();

export const checkpointAgentRunInputSchema = z
  .object({ runId: nonEmptyString, turnCount: turnCountSchema })
  .strict();

export const finishAgentRunInputSchema = z
  .object({
    runId: nonEmptyString,
    status: z.enum(agentRunStatusValues).exclude(['running']),
    turnCount: turnCountSchema,
    errorCode: nonEmptyString.nullable().optional(),
  })
  .strict();

export type StartAgentRunMetadataInput = z.input<
  typeof startAgentRunInputSchema
>;
export type CheckpointAgentRunMetadataInput = z.input<
  typeof checkpointAgentRunInputSchema
>;
export type FinishAgentRunMetadataInput = z.input<
  typeof finishAgentRunInputSchema
>;

export type AgentRunMetadataServiceDependencies = Readonly<{
  unitOfWork: ApplicationUnitOfWork;
  clock: Clock;
}>;

function conflict(message: string): ApplicationError {
  return new ApplicationError('invalid_transition', message, {
    retryable: false,
  });
}

export class AgentRunMetadataService {
  readonly #dependencies: AgentRunMetadataServiceDependencies;

  constructor(dependencies: AgentRunMetadataServiceDependencies) {
    this.#dependencies = dependencies;
  }

  start(input: StartAgentRunMetadataInput): Promise<AgentRun> {
    return protectApplicationCall(undefined, async () => {
      const parsed = parseBoundaryInput(
        startAgentRunInputSchema,
        input,
        'AgentRun start input',
      );
      const id = parseAgentRunId(parsed.runId);
      return this.#dependencies.unitOfWork.transaction(async (transaction) => {
        const existing = await transaction.agentRuns.findById(id);
        if (existing !== null) {
          if (
            existing.status === 'running' &&
            existing.trigger === parsed.trigger &&
            existing.modelProvider === (parsed.modelProvider ?? null)
          ) {
            return existing;
          }
          throw conflict('AgentRun ID already belongs to another run.');
        }
        const run = createAgentRun({
          id,
          startedAt: readClock(this.#dependencies.clock),
          trigger: parsed.trigger,
          modelProvider: parsed.modelProvider,
        });
        await transaction.agentRuns.insert(run);
        return run;
      });
    });
  }

  checkpoint(input: CheckpointAgentRunMetadataInput): Promise<AgentRun> {
    return protectApplicationCall(undefined, async () => {
      const parsed = parseBoundaryInput(
        checkpointAgentRunInputSchema,
        input,
        'AgentRun checkpoint input',
      );
      return this.#dependencies.unitOfWork.transaction(async (transaction) => {
        const current = await transaction.agentRuns.findById(
          parseAgentRunId(parsed.runId),
        );
        if (current === null) {
          throw new ApplicationError('not_found', 'AgentRun was not found.', {
            retryable: false,
          });
        }
        const next = checkpointAgentRun(current, parsed.turnCount);
        if (next !== current) await transaction.agentRuns.update(next);
        return next;
      });
    });
  }

  finish(input: FinishAgentRunMetadataInput): Promise<AgentRun> {
    return protectApplicationCall(undefined, async () => {
      const parsed = parseBoundaryInput(
        finishAgentRunInputSchema,
        input,
        'AgentRun finish input',
      );
      return this.#dependencies.unitOfWork.transaction(async (transaction) => {
        const current = await transaction.agentRuns.findById(
          parseAgentRunId(parsed.runId),
        );
        if (current === null) {
          throw new ApplicationError('not_found', 'AgentRun was not found.', {
            retryable: false,
          });
        }
        if (current.status !== 'running') {
          if (
            current.status === parsed.status &&
            current.turnCount === parsed.turnCount &&
            current.errorCode === (parsed.errorCode ?? null)
          ) {
            return current;
          }
          throw conflict('AgentRun is already terminal with another result.');
        }
        const next = finishAgentRun(current, {
          status: parsed.status,
          endedAt: readClock(this.#dependencies.clock),
          turnCount: parsed.turnCount,
          errorCode: parsed.errorCode,
        });
        await transaction.agentRuns.update(next);
        return next;
      });
    });
  }

  get(runId: string): Promise<AgentRun> {
    return protectApplicationCall(undefined, async () =>
      this.#dependencies.unitOfWork.transaction(async (transaction) => {
        const run = await transaction.agentRuns.findById(
          parseAgentRunId(runId),
        );
        if (run === null) {
          throw new ApplicationError('not_found', 'AgentRun was not found.', {
            retryable: false,
          });
        }
        return run;
      }),
    );
  }

  listRunning(): Promise<readonly AgentRun[]> {
    return protectApplicationCall(undefined, () =>
      this.#dependencies.unitOfWork.transaction((transaction) =>
        transaction.agentRuns.listRunning(),
      ),
    );
  }
}
