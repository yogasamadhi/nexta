import { RuntimeScreen } from '@/components/runtime-screen';
import type { MobileRuntime } from '@/runtime/mobile-runtime';
import {
  formatDatedRange,
  formatInstantDate,
  formatMinuteEstimate,
  timeBlockStatusLabel,
  timeBlockTypeLabel,
  userFacingError,
} from '@/presentation/mobile-format';
import {
  checkInEnabledPreferenceValueSchema,
  relaxSuggestionsEnabledPreferenceValueSchema,
  type ExecutionDetails,
  type TodayView,
  type TimeBlockSummary,
} from '@workspace/application';
import type { EnergyCheckIn, EnergyCheckInLevel } from '@workspace/domain';
import { Link, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type QueryState =
  | Readonly<{ status: 'loading'; view: null; message: null }>
  | Readonly<{ status: 'ready'; view: TodayView; message: string | null }>
  | Readonly<{ status: 'failed'; view: TodayView | null; message: string }>;

function integrationCopy(view: TodayView): string {
  const statuses = [
    view.integration.calendar.status,
    view.integration.notifications.status,
  ];
  if (statuses.includes('reconciliation_required')) return '外部同步需要核对';
  if (statuses.includes('permission_required'))
    return '计划已保存，等待系统权限';
  if (statuses.includes('failed')) return '计划已保存，外部同步稍后重试';
  if (statuses.includes('pending')) return '本地已更新，正在同步';
  if (statuses.every((status) => status === 'synced'))
    return '本地与系统已同步';
  return '本地计划可用';
}

function freshnessCopy(view: TodayView): string {
  switch (view.calendarFreshness.status) {
    case 'setup_required':
      return '需要完成排程设置';
    case 'not_configured':
      return '仅使用本地计划，不读取系统日历';
    case 'complete':
      return '日历忙碌时间已读取';
    case 'partial':
      return '日历数据不完整，预览会明确提示';
    case 'missing':
      return '尚未取得所选日历的忙碌时间';
  }
}

function BlockRow({
  block,
  timeZone,
}: Readonly<{ block: TimeBlockSummary; timeZone: string }>) {
  const title = block.task?.title ?? timeBlockTypeLabel(block.type);
  const content = (
    <View className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
      <View className="flex-row items-start justify-between gap-4">
        <View className="flex-1">
          <Text className="font-semibold text-stone-900">{title}</Text>
          <Text className="mt-1 text-sm text-stone-500">
            {formatDatedRange(block.startAt, block.endAt, timeZone)}
            {block.locked ? ' · 已锁定' : ''}
          </Text>
        </View>
        <Text className="text-xs font-medium text-stone-500">
          {timeBlockStatusLabel(block.status)}
        </Text>
      </View>
    </View>
  );

  return block.taskId === null ? (
    content
  ) : (
    <Link
      asChild
      href={{ pathname: '/task/[taskId]', params: { taskId: block.taskId } }}
    >
      <Pressable accessibilityRole="button">{content}</Pressable>
    </Link>
  );
}

function TodayContent({ runtime }: Readonly<{ runtime: MobileRuntime }>) {
  const router = useRouter();
  const [state, setState] = useState<QueryState>({
    status: 'loading',
    view: null,
    message: null,
  });
  const [scheduling, setScheduling] = useState(false);
  const [starting, setStarting] = useState(false);
  const [activeExecution, setActiveExecution] =
    useState<ExecutionDetails | null>(null);
  const [latestCheckIn, setLatestCheckIn] = useState<EnergyCheckIn | null>(
    null,
  );
  const [checkInEnabled, setCheckInEnabled] = useState(true);
  const [relaxSuggestionsEnabled, setRelaxSuggestionsEnabled] = useState(true);
  const [recordingCheckIn, setRecordingCheckIn] = useState(false);

  const load = useCallback(async () => {
    setState((current) =>
      current.view === null
        ? { status: 'loading', view: null, message: null }
        : { status: 'ready', view: current.view, message: null },
    );
    try {
      const [view, active, checkIn, checkInPreference, relaxPreference] =
        await Promise.all([
          runtime.planningQueries.getToday(),
          runtime.executionService.getActive(),
          runtime.energyCheckInService.getLatestCurrentDay(),
          runtime.preferenceService.get('wellbeing.checkIn.enabled.v1'),
          runtime.preferenceService.get(
            'wellbeing.relaxSuggestions.enabled.v1',
          ),
        ]);
      setActiveExecution(active);
      setLatestCheckIn(checkIn);
      const parsedCheckIn = checkInEnabledPreferenceValueSchema.safeParse(
        checkInPreference?.valueJson,
      );
      setCheckInEnabled(
        parsedCheckIn.success ? parsedCheckIn.data.enabled : true,
      );
      const parsedRelax =
        relaxSuggestionsEnabledPreferenceValueSchema.safeParse(
          relaxPreference?.valueJson,
        );
      setRelaxSuggestionsEnabled(
        parsedRelax.success ? parsedRelax.data.enabled : true,
      );
      setState({ status: 'ready', view, message: null });
    } catch (error) {
      setState((current) => ({
        status: 'failed',
        view: current.view,
        message: userFacingError(error),
      }));
    }
  }, [runtime]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const previewTask = useCallback(
    async (taskId: string) => {
      setScheduling(true);
      try {
        const preview = await runtime.scheduleService.preview({
          reason: 'today_candidate',
          taskIds: [taskId],
        });
        router.push({
          pathname: '/schedule-preview',
          params: { previewId: preview.previewId },
        });
      } catch (error) {
        setState((current) => ({
          status: 'failed',
          view: current.view,
          message: userFacingError(error),
        }));
      } finally {
        setScheduling(false);
      }
    },
    [router, runtime],
  );

  const startTask = useCallback(
    async (taskId: string, timeBlockId?: string) => {
      setStarting(true);
      setState((current) =>
        current.view === null
          ? { status: 'loading', view: null, message: null }
          : { status: 'ready', view: current.view, message: null },
      );
      try {
        const active = await runtime.executionService.getActive();
        const transitionRequested = active === null;
        const session =
          active?.session ??
          (
            await runtime.executionService.start(
              { taskId, ...(timeBlockId === undefined ? {} : { timeBlockId }) },
              runtime.createUserWriteContext('start_focus'),
            )
          ).session;
        router.push({
          pathname: '/focus/[sessionId]',
          params: {
            sessionId: session.id,
            ...(transitionRequested ? { transition: '1' } : {}),
          },
        });
      } catch (error) {
        const active = await runtime.executionService
          .getActive()
          .catch(() => null);
        if (active !== null) {
          router.push({
            pathname: '/focus/[sessionId]',
            params: { sessionId: active.session.id },
          });
        } else {
          setState((current) => ({
            status: 'failed',
            view: current.view,
            message: userFacingError(error),
          }));
        }
      } finally {
        setStarting(false);
      }
    },
    [router, runtime],
  );

  const recordCheckIn = useCallback(
    async (level: EnergyCheckInLevel) => {
      setRecordingCheckIn(true);
      try {
        const result = await runtime.energyCheckInService.record(
          { level },
          runtime.createUserWriteContext('energy_check_in'),
        );
        setLatestCheckIn(result.checkIn);
        setState((current) =>
          current.view === null
            ? current
            : {
                status: 'ready',
                view: current.view,
                message: '已按记录时区保存在本机，只作为可选的排程软信号。',
              },
        );
      } catch (error) {
        setState((current) => ({
          status: 'failed',
          view: current.view,
          message: userFacingError(error),
        }));
      } finally {
        setRecordingCheckIn(false);
      }
    },
    [runtime],
  );

  const adjustForCheckIn = useCallback(async () => {
    setScheduling(true);
    try {
      const preview = await runtime.scheduleService.replan({
        reason: 'energy_check_in_adjust_today',
      });
      router.push({
        pathname: '/schedule-preview',
        params: { previewId: preview.previewId },
      });
    } catch (error) {
      setState((current) => ({
        status: 'failed',
        view: current.view,
        message: userFacingError(error),
      }));
    } finally {
      setScheduling(false);
    }
  }, [router, runtime]);

  const replanToday = useCallback(async () => {
    setScheduling(true);
    try {
      const preview = await runtime.scheduleService.replan({
        reason: 'user_requested_today',
      });
      router.push({
        pathname: '/schedule-preview',
        params: { previewId: preview.previewId },
      });
    } catch (error) {
      setState((current) =>
        current.view === null
          ? current
          : {
              status: 'ready',
              view: current.view,
              message: userFacingError(error),
            },
      );
    } finally {
      setScheduling(false);
    }
  }, [router, runtime]);

  if (state.status === 'loading') {
    return (
      <SafeAreaView className="flex-1 items-center justify-center">
        <ActivityIndicator color="#047857" />
      </SafeAreaView>
    );
  }

  const view = state.view;
  if (view === null) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center px-8">
        <Text className="text-center text-base text-stone-700">
          {state.message}
        </Text>
        <Pressable
          accessibilityRole="button"
          className="mt-5 rounded-2xl bg-stone-950 px-5 py-3"
          onPress={() => void load()}
        >
          <Text className="font-semibold text-white">重试</Text>
        </Pressable>
      </SafeAreaView>
    );
  }
  const candidateTaskId =
    view.nowCard.kind === 'candidate_task' ? view.nowCard.task.id : null;
  const currentBlock =
    view.nowCard.kind === 'current_block' ? view.nowCard.block : null;
  const currentBlockRemaining =
    view.nowCard.kind === 'current_block' ? view.nowCard.remainingMinutes : 0;
  const emptyReason =
    view.nowCard.kind === 'empty' ? view.nowCard.reason : null;

  return (
    <SafeAreaView className="flex-1" edges={['top']} style={{ flex: 1 }}>
      <ScrollView
        className="flex-1"
        style={{ flex: 1 }}
        contentContainerClassName="gap-7 px-5 pb-10 pt-5"
        refreshControl={
          <RefreshControl
            refreshing={false}
            tintColor="#047857"
            onRefresh={() => void load()}
          />
        }
      >
        <View className="flex-row items-start justify-between">
          <View>
            <Text className="text-4xl font-semibold text-stone-950">今天</Text>
            <Text className="mt-1 text-base text-stone-500">
              {formatInstantDate(view.now, view.timeZone)}
            </Text>
          </View>
          <View className="flex-row gap-2">
            <Link asChild href="/inbox">
              <Pressable
                accessibilityLabel="打开任务收件箱"
                accessibilityRole="button"
                className="rounded-full border border-stone-300 bg-white px-3 py-2"
              >
                <Text className="font-medium text-stone-700">收件箱</Text>
              </Pressable>
            </Link>
            <Link asChild href="/settings">
              <Pressable
                accessibilityLabel="打开设置"
                accessibilityRole="button"
                className="rounded-full border border-stone-300 bg-white px-3 py-2"
              >
                <Text className="font-medium text-stone-700">设置</Text>
              </Pressable>
            </Link>
          </View>
        </View>

        <View className="rounded-2xl bg-emerald-50 px-4 py-3">
          <Text className="font-medium text-emerald-900">
            {integrationCopy(view)}
          </Text>
          <Text className="mt-1 text-sm text-emerald-800">
            {freshnessCopy(view)} · 时区 {view.timeZone}
          </Text>
          {view.integration.calendar.status === 'reconciliation_required' ||
          view.integration.notifications.status === 'reconciliation_required' ||
          view.integration.calendar.status === 'permission_required' ||
          view.integration.notifications.status === 'permission_required' ? (
            <Link asChild href="/settings">
              <Pressable
                accessibilityRole="button"
                className="mt-3 self-start rounded-xl border border-emerald-700 px-3 py-2"
              >
                <Text className="font-semibold text-emerald-900">
                  处理权限或同步核对
                </Text>
              </Pressable>
            </Link>
          ) : null}
        </View>

        <Pressable
          accessibilityRole="button"
          className="items-center rounded-2xl border border-stone-300 bg-white py-3"
          disabled={scheduling}
          onPress={() => void replanToday()}
        >
          <Text className="font-semibold text-stone-900">
            {scheduling ? '正在计算…' : '重新规划今天'}
          </Text>
        </Pressable>

        {state.message === null ? null : (
          <View className="rounded-2xl bg-amber-50 px-4 py-3">
            <Text className="leading-5 text-amber-900">{state.message}</Text>
          </View>
        )}

        {checkInEnabled ? (
          <View className="rounded-3xl bg-white p-5">
            <Text className="text-xs font-semibold uppercase tracking-widest text-stone-500">
              可选精力记录
            </Text>
            <Text className="mt-2 text-xl font-semibold text-stone-950">
              现在的精力怎么样？
            </Text>
            <Text className="mt-2 leading-6 text-stone-500">
              只记录主观感受，不解释成医疗或心理状态。
            </Text>
            <View className="mt-4 flex-row justify-between gap-2">
              {(['很低', '偏低', '一般', '不错', '很好'] as const).map(
                (label, index) => {
                  const level = (index + 1) as EnergyCheckInLevel;
                  const selectedLevel = latestCheckIn?.level === level;
                  return (
                    <Pressable
                      accessibilityRole="button"
                      key={label}
                      className={`flex-1 items-center rounded-xl border px-1 py-3 ${selectedLevel ? 'border-emerald-700 bg-emerald-50' : 'border-stone-200'}`}
                      disabled={recordingCheckIn}
                      onPress={() => void recordCheckIn(level)}
                    >
                      <Text
                        className={`text-xs font-medium ${selectedLevel ? 'text-emerald-900' : 'text-stone-600'}`}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  );
                },
              )}
            </View>
            {latestCheckIn === null ? null : (
              <Pressable
                accessibilityRole="button"
                className="mt-4 items-center rounded-2xl border border-stone-300 py-3"
                disabled={scheduling}
                onPress={() => void adjustForCheckIn()}
              >
                <Text className="font-semibold text-stone-900">
                  {scheduling ? '正在计算…' : '按当前状态查看调整预览'}
                </Text>
              </Pressable>
            )}
          </View>
        ) : null}

        {relaxSuggestionsEnabled ? (
          <Link
            asChild
            href={{ pathname: '/(tabs)/relax', params: { source: 'today' } }}
          >
            <Pressable
              accessibilityRole="button"
              className="rounded-3xl bg-emerald-950 px-5 py-4"
            >
              <Text className="text-lg font-semibold text-white">
                需要短暂恢复？
              </Text>
              <Text className="mt-1 text-emerald-200">
                1–5 分钟，可随时结束；不需要网络。
              </Text>
            </Pressable>
          </Link>
        ) : null}

        <View className="gap-3">
          <Text className="text-xs font-semibold uppercase tracking-widest text-stone-500">
            Now
          </Text>
          {activeExecution !== null ? (
            <View className="rounded-3xl bg-stone-950 p-5">
              <Text className="text-sm font-medium text-emerald-300">
                {activeExecution.session.status === 'paused'
                  ? '专注已暂停，记录安全保存在本地'
                  : '正在专注'}
              </Text>
              <Text className="mt-2 text-2xl font-semibold text-white">
                {activeExecution.task.title}
              </Text>
              <Pressable
                accessibilityRole="button"
                className="mt-5 items-center rounded-2xl bg-white py-3"
                onPress={() =>
                  router.push({
                    pathname: '/focus/[sessionId]',
                    params: { sessionId: activeExecution.session.id },
                  })
                }
              >
                <Text className="font-semibold text-stone-950">回到专注</Text>
              </Pressable>
            </View>
          ) : currentBlock !== null ? (
            <View className="rounded-3xl bg-stone-950 p-5">
              <Text className="text-sm font-medium text-emerald-300">
                还剩{formatMinuteEstimate(currentBlockRemaining)}
              </Text>
              <Text className="mt-2 text-2xl font-semibold text-white">
                {currentBlock.task?.title ??
                  timeBlockTypeLabel(currentBlock.type)}
              </Text>
              <Text className="mt-2 text-stone-300">
                {formatDatedRange(
                  currentBlock.startAt,
                  currentBlock.endAt,
                  view.timeZone,
                )}
              </Text>
              {currentBlock.task === null ? null : (
                <Pressable
                  accessibilityRole="button"
                  className="mt-5 items-center rounded-2xl bg-white py-3"
                  disabled={starting}
                  onPress={() =>
                    void startTask(currentBlock.task!.id, currentBlock.id)
                  }
                >
                  <Text className="font-semibold text-stone-950">
                    {starting ? '正在开始…' : '开始专注'}
                  </Text>
                </Pressable>
              )}
            </View>
          ) : view.nowCard.kind === 'candidate_task' ? (
            <View className="rounded-3xl border border-stone-200 bg-white p-5">
              <Text className="text-sm text-stone-500">可以先安排这件事</Text>
              <Text className="mt-2 text-2xl font-semibold text-stone-950">
                {view.nowCard.task.title}
              </Text>
              <Text className="mt-2 text-stone-500">
                {view.nowCard.task.remainingMinutes === null
                  ? '时长待确认'
                  : formatMinuteEstimate(view.nowCard.task.remainingMinutes)}
              </Text>
              <Pressable
                accessibilityRole="button"
                className="mt-5 items-center rounded-2xl bg-stone-950 py-3"
                disabled={scheduling}
                onPress={() => {
                  if (candidateTaskId !== null)
                    void previewTask(candidateTaskId);
                }}
              >
                <Text className="font-semibold text-white">
                  {scheduling ? '正在计算…' : '查看排程预览'}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                className="mt-3 items-center rounded-2xl border border-stone-300 py-3"
                disabled={starting}
                onPress={() => {
                  if (candidateTaskId !== null) void startTask(candidateTaskId);
                }}
              >
                <Text className="font-semibold text-stone-900">
                  {starting ? '正在开始…' : '直接开始专注'}
                </Text>
              </Pressable>
              <Link
                asChild
                href={{
                  pathname: '/task/[taskId]',
                  params: { taskId: view.nowCard.task.id },
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  className="mt-3 items-center py-2"
                >
                  <Text className="font-medium text-stone-600">编辑任务</Text>
                </Pressable>
              </Link>
            </View>
          ) : (
            <View className="rounded-3xl border border-dashed border-stone-300 bg-white p-5">
              <Text className="text-xl font-semibold text-stone-900">
                {emptyReason === 'missing_duration'
                  ? '有任务仍在等待估时'
                  : '现在没有必须执行的时间块'}
              </Text>
              <Text className="mt-2 leading-6 text-stone-500">
                添加一个任务、查看本周，或先短暂放松。
              </Text>
              <Link asChild href="/(tabs)/capture">
                <Pressable
                  accessibilityRole="button"
                  className="mt-4 self-start rounded-2xl bg-stone-950 px-5 py-3"
                >
                  <Text className="font-semibold text-white">添加任务</Text>
                </Pressable>
              </Link>
              <View className="mt-3 flex-row flex-wrap gap-2">
                <Link asChild href="/(tabs)/calendar">
                  <Pressable
                    accessibilityRole="button"
                    className="min-h-12 justify-center rounded-2xl border border-stone-300 px-4 py-2"
                  >
                    <Text className="font-semibold text-stone-800">
                      查看本周
                    </Text>
                  </Pressable>
                </Link>
                <Link
                  asChild
                  href={{
                    pathname: '/(tabs)/relax',
                    params: { source: 'today' },
                  }}
                >
                  <Pressable
                    accessibilityRole="button"
                    className="min-h-12 justify-center rounded-2xl border border-stone-300 px-4 py-2"
                  >
                    <Text className="font-semibold text-stone-800">去放松</Text>
                  </Pressable>
                </Link>
              </View>
              {emptyReason === 'missing_duration' ? (
                <Link asChild href="/inbox">
                  <Pressable
                    accessibilityRole="button"
                    className="mt-3 self-start px-1 py-2"
                  >
                    <Text className="font-semibold text-emerald-800">
                      查看待估时任务
                    </Text>
                  </Pressable>
                </Link>
              ) : null}
            </View>
          )}
        </View>

        <View className="gap-3">
          <Text className="text-xs font-semibold uppercase tracking-widest text-stone-500">
            Next
          </Text>
          {view.next.length === 0 ? (
            <Text className="rounded-2xl bg-white px-4 py-5 text-stone-500">
              暂无后续时间块
            </Text>
          ) : (
            view.next.map((block) => (
              <BlockRow key={block.id} block={block} timeZone={view.timeZone} />
            ))
          )}
        </View>

        <View className="gap-3">
          <Text className="text-xs font-semibold uppercase tracking-widest text-stone-500">
            Today&apos;s Wins
          </Text>
          {view.wins.length === 0 ? (
            <Text className="rounded-2xl bg-white px-4 py-5 text-stone-500">
              今天完成的任务会真实记录在这里
            </Text>
          ) : (
            view.wins.map((win) => (
              <View
                key={win.completionRecordId}
                className="rounded-2xl bg-white px-4 py-4"
              >
                <Text className="font-semibold text-stone-900">
                  ✓ {win.title}
                </Text>
              </View>
            ))
          )}
        </View>

        <Link asChild href="/reflection">
          <Pressable
            accessibilityRole="button"
            className="rounded-3xl border border-stone-200 bg-white p-5"
          >
            <Text className="text-lg font-semibold text-stone-950">
              1 分钟今日复盘
            </Text>
            <Text className="mt-1 leading-6 text-stone-500">
              用真实完成记录生成离线事实摘要，再补充你自己的备注。
            </Text>
          </Pressable>
        </Link>
      </ScrollView>
    </SafeAreaView>
  );
}

export default function TodayScreen() {
  return (
    <RuntimeScreen>
      {(runtime) => <TodayContent runtime={runtime} />}
    </RuntimeScreen>
  );
}
