import { RuntimeScreen } from '@/components/runtime-screen';
import {
  focusTransitionDurationMs,
  focusTransitionRemainingSeconds,
  formatMinuteEstimate,
  shouldShowMindfulTransition,
  userFacingError,
} from '@/presentation/mobile-format';
import type { MobileRuntime } from '@/runtime/mobile-runtime';
import {
  focusMindfulTransitionEnabledPreferenceValueSchema,
  type ExecutionDetails,
} from '@workspace/application';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';

function formatElapsed(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3_600);
  const minutes = Math.floor((safeSeconds % 3_600) / 60);
  const remainder = safeSeconds % 60;
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, '0')}:${remainder
        .toString()
        .padStart(2, '0')}`
    : `${minutes.toString().padStart(2, '0')}:${remainder
        .toString()
        .padStart(2, '0')}`;
}

function liveWorkSeconds(details: ExecutionDetails, now: number): number {
  if (
    details.session.status !== 'running' ||
    details.session.activeIntervalStartedAt === null
  ) {
    return details.recordedWorkSeconds;
  }
  const activeInterval = details.intervals.find(
    (interval) => interval.endAt === null && interval.kind === 'work',
  );
  if (activeInterval?.timingQuality !== 'trusted') {
    return details.recordedWorkSeconds;
  }
  return (
    details.recordedWorkSeconds +
    Math.max(0, Math.floor((now - Date.parse(activeInterval.startAt)) / 1_000))
  );
}

function FocusContent({ runtime }: Readonly<{ runtime: MobileRuntime }>) {
  const router = useRouter();
  const parameters = useLocalSearchParams<{
    sessionId?: string | string[];
    transition?: string | string[];
  }>();
  const sessionId =
    typeof parameters.sessionId === 'string' ? parameters.sessionId : '';
  const [transitionRequested] = useState(parameters.transition === '1');
  const [details, setDetails] = useState<ExecutionDetails | null>(null);
  const [now, setNow] = useState(0);
  const [busy, setBusy] = useState(false);
  const [canControl, setCanControl] = useState(false);
  useEffect(() => {
    let live = true;
    void runtime.cloudAccount
      .canControl('execution_session', sessionId)
      .then((owned) => {
        if (live) setCanControl(owned);
      });
    return () => {
      live = false;
    };
  }, [runtime, sessionId]);
  const [allEffortRecorded, setAllEffortRecorded] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [transitionEndsAtMs, setTransitionEndsAtMs] = useState<number | null>(
    null,
  );

  useEffect(() => {
    if (transitionRequested) {
      router.setParams({ transition: undefined });
    }
  }, [router, transitionRequested]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      runtime.executionService.get(sessionId),
      runtime.preferenceService.get('focus.mindfulTransition.enabled.v1'),
    ])
      .then(([value, preference]) => {
        if (!active) return;
        const parsedPreference =
          focusMindfulTransitionEnabledPreferenceValueSchema.safeParse(
            preference?.valueJson,
          );
        const enabled = parsedPreference.success
          ? parsedPreference.data.enabled
          : true;
        const observedNow = Date.now();
        setDetails(value);
        setNow(observedNow);
        setTransitionEndsAtMs(
          shouldShowMindfulTransition({
            requested: transitionRequested,
            enabled,
            sessionStatus: value.session.status,
          })
            ? observedNow + focusTransitionDurationMs
            : null,
        );
      })
      .catch((error) => {
        if (active) setMessage(userFacingError(error));
      });
    return () => {
      active = false;
    };
  }, [runtime, sessionId, transitionRequested]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const elapsedSeconds = useMemo(
    () => (details === null ? 0 : liveWorkSeconds(details, now)),
    [details, now],
  );

  async function switchPause() {
    if (details === null) return;
    setBusy(true);
    setMessage(null);
    try {
      const result =
        details.session.status === 'running'
          ? await runtime.executionService.pause(
              { sessionId: details.session.id },
              runtime.createUserWriteContext('pause_focus'),
            )
          : await runtime.executionService.resume(
              { sessionId: details.session.id },
              runtime.createUserWriteContext('resume_focus'),
            );
      setDetails({
        session: result.session,
        intervals: result.intervals,
        task: result.task,
        timeBlock: result.timeBlock,
        recordedWorkSeconds: result.recordedWorkSeconds,
      });
      setNow(Date.now());
    } catch (error) {
      setMessage(userFacingError(error));
    } finally {
      setBusy(false);
    }
  }

  async function openRelax() {
    if (details === null) return;
    setBusy(true);
    setMessage(null);
    try {
      if (details.session.status === 'running') {
        const result = await runtime.executionService.pause(
          { sessionId: details.session.id },
          runtime.createUserWriteContext('pause_for_relax'),
        );
        setDetails({
          session: result.session,
          intervals: result.intervals,
          task: result.task,
          timeBlock: result.timeBlock,
          recordedWorkSeconds: result.recordedWorkSeconds,
        });
      }
      router.push({
        pathname: '/(tabs)/relax',
        params: {
          source: 'focus',
          returnSessionId: details.session.id,
        },
      });
    } catch (error) {
      setMessage(userFacingError(error));
    } finally {
      setBusy(false);
    }
  }

  async function finishSession(replan: boolean) {
    if (details === null) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await runtime.executionService.finish(
        { sessionId: details.session.id, outcome: 'finish_session' },
        runtime.createUserWriteContext('finish_focus_session'),
      );
      if (!replan) {
        router.replace('/(tabs)/today');
        return;
      }
      try {
        const preview = await runtime.scheduleService.replan({
          reason: 'focus_needs_more_time',
          taskIds: [result.task.id],
        });
        router.replace({
          pathname: '/schedule-preview',
          params: { previewId: preview.previewId },
        });
      } catch (error) {
        setDetails({
          session: result.session,
          intervals: result.intervals,
          task: result.task,
          timeBlock: result.timeBlock,
          recordedWorkSeconds: result.recordedWorkSeconds,
        });
        setMessage(`本次专注已经保存。${userFacingError(error)}`);
      }
    } catch (error) {
      setMessage(userFacingError(error));
    } finally {
      setBusy(false);
    }
  }

  async function completeTask(recordAchievement: boolean) {
    if (details === null) return;
    setBusy(true);
    setMessage(null);
    try {
      await runtime.executionService.finish(
        {
          sessionId: details.session.id,
          outcome: 'complete_task',
          recordAchievement,
          allEffortRecorded,
        },
        runtime.createUserWriteContext(
          recordAchievement ? 'complete_focus_with_win' : 'complete_focus',
        ),
      );
      router.replace(recordAchievement ? '/(tabs)/wins' : '/(tabs)/today');
    } catch (error) {
      setMessage(userFacingError(error));
    } finally {
      setBusy(false);
    }
  }

  async function abandon() {
    if (details === null) return;
    setBusy(true);
    setMessage(null);
    try {
      await runtime.executionService.abandon(
        { sessionId: details.session.id },
        runtime.createUserWriteContext('abandon_focus'),
      );
      router.replace('/(tabs)/today');
    } catch (error) {
      setMessage(userFacingError(error));
    } finally {
      setBusy(false);
    }
  }

  if (details === null) {
    return (
      <View className="flex-1 items-center justify-center px-8">
        {message === null ? (
          <ActivityIndicator color="#047857" />
        ) : (
          <Text className="text-center text-base text-stone-700">
            {message}
          </Text>
        )}
      </View>
    );
  }

  const active =
    details.session.status === 'running' || details.session.status === 'paused';
  const estimatedMinutes =
    details.task.baselineEstimatedDurationMinutes ??
    details.task.estimatedDurationMinutes;
  const timingNeedsReview = details.intervals.some(
    (interval) => interval.timingQuality === 'needs_review',
  );
  const transitionRemaining =
    transitionEndsAtMs === null
      ? 0
      : focusTransitionRemainingSeconds(transitionEndsAtMs, now);

  if (active && transitionRemaining > 0) {
    return (
      <View className="flex-1 justify-between bg-emerald-950 px-6 pb-12 pt-16">
        <View>
          <Text className="text-center text-sm font-medium uppercase tracking-widest text-emerald-200">
            进入专注
          </Text>
          <Text className="mt-10 text-center text-3xl font-semibold leading-10 text-white">
            {details.task.title}
          </Text>
          <Text className="mt-16 text-center text-2xl leading-10 text-emerald-50">
            放下刚才的事情。{`\n`}现在只处理这一件事。
          </Text>
          <Text className="mt-10 text-center text-sm text-emerald-300">
            {transitionRemaining} 秒后进入专注计时界面
          </Text>
        </View>
        <View>
          <Pressable
            accessibilityRole="button"
            className="items-center rounded-2xl bg-white py-4"
            onPress={() => setTransitionEndsAtMs(null)}
            testID="focus-skip-transition"
          >
            <Text className="font-semibold text-emerald-950">立即开始</Text>
          </Pressable>
          <Text className="mt-4 text-center text-sm leading-5 text-emerald-300">
            这段过渡可以随时跳过，也可以在设置中关闭。
          </Text>
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-stone-950"
      contentContainerClassName="min-h-full justify-between px-6 pb-12 pt-10"
    >
      <View>
        <Text className="text-center text-sm font-medium uppercase tracking-widest text-emerald-300">
          {details.session.status === 'paused'
            ? '已暂停'
            : active
              ? '现在只处理这一件事'
              : '本次专注已结束'}
        </Text>
        <Text className="mt-8 text-center text-3xl font-semibold leading-10 text-white">
          {details.task.title}
        </Text>
        <Text
          testID="focus-elapsed"
          className="mt-12 text-center text-6xl font-light tabular-nums text-white"
        >
          {formatElapsed(elapsedSeconds)}
        </Text>
        <Text className="mt-4 text-center text-base text-stone-400">
          已记录投入
          {estimatedMinutes === null
            ? ''
            : ` · 原估 ${formatMinuteEstimate(estimatedMinutes)}`}
        </Text>
        <Text className="mt-2 text-center text-sm text-stone-500">
          {details.task.remainingDurationMinutes === null
            ? '剩余时间待确认'
            : `当前剩余${formatMinuteEstimate(details.task.remainingDurationMinutes)}`}
        </Text>
        {timingNeedsReview ? (
          <Text className="mt-6 rounded-2xl bg-amber-950 px-4 py-3 text-center leading-5 text-amber-200">
            设备时间出现变化；异常区间已标记待核对，没有计入精确耗时。
          </Text>
        ) : null}
        {message === null ? null : (
          <Text className="mt-6 rounded-2xl bg-amber-950 px-4 py-3 text-center leading-5 text-amber-200">
            {message}
          </Text>
        )}
      </View>

      <View className="mt-14 gap-3">
        {!canControl ? (
          <Text className="rounded-2xl bg-amber-950 p-4 text-amber-100">
            此专注由另一台设备发起。这里仅显示同步状态，请回到原设备暂停、结束或完成。
          </Text>
        ) : null}
        {active ? (
          <>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: allEffortRecorded }}
              className={`rounded-2xl border px-4 py-3 ${allEffortRecorded ? 'border-emerald-400 bg-emerald-950' : 'border-stone-600'}`}
              disabled={busy || !canControl}
              onPress={() => setAllEffortRecorded((current) => !current)}
            >
              <Text className="font-medium text-stone-100">
                {allEffortRecorded ? '✓ ' : ''}全部实际投入都已被计时记录
              </Text>
              <Text className="mt-1 text-sm leading-5 text-stone-400">
                只在没有漏记工作时勾选；否则会保留为部分投入。
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              className="items-center rounded-2xl bg-white py-4"
              disabled={busy || !canControl}
              onPress={() => void switchPause()}
              testID="focus-toggle-pause"
            >
              <Text className="font-semibold text-stone-950">
                {details.session.status === 'running' ? '暂停' : '继续专注'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              className="items-center rounded-2xl bg-emerald-600 py-4"
              disabled={busy || !canControl}
              onPress={() => void completeTask(true)}
              testID="focus-complete-with-win"
            >
              <Text className="font-semibold text-white">
                完成整个任务并记录成就
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              className="items-center rounded-2xl border border-emerald-700 py-4"
              disabled={busy || !canControl}
              onPress={() => void openRelax()}
            >
              <Text className="font-semibold text-emerald-200">
                暂停并短暂放松
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              className="items-center rounded-2xl border border-stone-600 py-4"
              disabled={busy || !canControl}
              onPress={() => void finishSession(false)}
            >
              <Text className="font-semibold text-stone-200">
                结束本次专注，任务未完成
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              className="items-center rounded-2xl border border-stone-600 py-4"
              disabled={busy || !canControl}
              onPress={() => void finishSession(true)}
            >
              <Text className="font-semibold text-stone-200">
                需要更多时间并重新排程
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              className="items-center py-3"
              disabled={busy || !canControl}
              onPress={() => void completeTask(false)}
            >
              <Text className="font-medium text-stone-400">
                完成任务，但不记录成就
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              className="items-center py-3"
              disabled={busy || !canControl}
              onPress={() => void abandon()}
            >
              <Text className="font-medium text-stone-500">暂时无法继续</Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            accessibilityRole="button"
            className="items-center rounded-2xl bg-white py-4"
            onPress={() => router.replace('/(tabs)/today')}
          >
            <Text className="font-semibold text-stone-950">返回今天</Text>
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}

export default function FocusScreen() {
  return (
    <RuntimeScreen>
      {(runtime) => <FocusContent runtime={runtime} />}
    </RuntimeScreen>
  );
}
