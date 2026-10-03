import { RuntimeScreen } from '@/components/runtime-screen';
import {
  formatDatedRange,
  isFuturePlannedTimeBlock,
  timeBlockStatusLabel,
  timeBlockTypeLabel,
  userFacingError,
} from '@/presentation/mobile-format';
import { adjustTimelineInterval } from '@/presentation/timeline-adjustment';
import type { MobileRuntime } from '@/runtime/mobile-runtime';
import type {
  TimeBlockAdjustmentPreview,
  TimeBlockAdjustmentService,
} from '@workspace/application';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  PanResponder,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';

type Target = Awaited<ReturnType<TimeBlockAdjustmentService['getTarget']>>;

function TaskEditorLink({ taskId }: Readonly<{ taskId: string | null }>) {
  if (taskId === null) return null;
  return (
    <Link asChild href={{ pathname: '/task/[taskId]', params: { taskId } }}>
      <Pressable
        accessibilityRole="button"
        className="items-center rounded-2xl border border-stone-300 py-3"
      >
        <Text className="font-semibold text-stone-800">查看与编辑任务</Text>
      </Pressable>
    </Link>
  );
}

function AdjustmentContent({ runtime }: Readonly<{ runtime: MobileRuntime }>) {
  const router = useRouter();
  const parameters = useLocalSearchParams<{
    timeBlockId?: string | string[];
  }>();
  const id =
    typeof parameters.timeBlockId === 'string' ? parameters.timeBlockId : '';
  const timeZone = runtime.temporal.currentTimeZone();
  const [target, setTarget] = useState<Target | null>(null);
  const [interval, setInterval] = useState<Readonly<{
    startAt: string;
    endAt: string;
  }> | null>(null);
  const [preview, setPreview] = useState<TimeBlockAdjustmentPreview | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openedAtMs] = useState(Date.now);
  const [gesture, setGesture] = useState<Readonly<{
    kind: 'move' | 'resize_start' | 'resize_end';
    deltaPixels: number;
  }> | null>(null);

  useEffect(() => {
    let active = true;
    void runtime.timeBlockAdjustments
      .getTarget(id)
      .then((value) => {
        if (!active) return;
        setTarget(value);
        setInterval({
          startAt: value.block.startAt,
          endAt: value.block.endAt,
        });
      })
      .catch((error) => {
        if (active) setMessage(userFacingError(error));
      });
    return () => {
      active = false;
    };
  }, [id, runtime]);

  const responders = useMemo(() => {
    const create = (kind: 'move' | 'resize_start' | 'resize_end') =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          setPreview(null);
        },
        onPanResponderMove: (_event, gesture) => {
          setGesture({ kind, deltaPixels: gesture.dy });
        },
        onPanResponderRelease: (_event, released) => {
          if (interval !== null) {
            setInterval(
              adjustTimelineInterval({
                kind,
                ...interval,
                deltaMinutes: released.dy / 2,
                granularityMinutes: 15,
                minimumMinutes: 15,
              }),
            );
          }
          setGesture(null);
        },
        onPanResponderTerminate: () => {
          setGesture(null);
        },
      });
    return {
      move: create('move'),
      resizeStart: create('resize_start'),
      resizeEnd: create('resize_end'),
    };
  }, [interval]);

  async function makePreview() {
    if (target === null || interval === null) return;
    setBusy(true);
    setMessage(null);
    try {
      setPreview(
        await runtime.timeBlockAdjustments.preview({
          timeBlockId: target.block.id,
          ...interval,
        }),
      );
    } catch (error) {
      setMessage(userFacingError(error));
    } finally {
      setBusy(false);
    }
  }

  function adjustBy(
    kind: 'move' | 'resize_start' | 'resize_end',
    deltaMinutes: number,
  ) {
    setPreview(null);
    setInterval((current) =>
      current === null
        ? null
        : adjustTimelineInterval({
            kind,
            ...current,
            deltaMinutes,
            granularityMinutes: 15,
            minimumMinutes: 15,
          }),
    );
  }

  async function commit() {
    if (preview === null) return;
    setBusy(true);
    setMessage(null);
    try {
      await runtime.timeBlockAdjustments.commit(
        {
          previewId: preview.previewId,
          expectedStateVersion: preview.basedOnStateVersion,
        },
        runtime.createUserWriteContext('adjust_time_block'),
      );
      router.back();
    } catch (error) {
      setMessage(userFacingError(error));
    } finally {
      setBusy(false);
    }
  }

  async function unlock() {
    if (target === null) return;
    setBusy(true);
    setMessage(null);
    try {
      await runtime.timeBlockAdjustments.unlock(
        {
          timeBlockId: target.block.id,
          expectedStateVersion: target.stateVersion,
        },
        runtime.createUserWriteContext('unlock_time_block'),
      );
      router.back();
    } catch (error) {
      setMessage(userFacingError(error));
    } finally {
      setBusy(false);
    }
  }

  if (target === null || interval === null) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-100 px-8">
        {message === null ? (
          <ActivityIndicator color="#047857" />
        ) : (
          <Text className="text-center text-stone-700">{message}</Text>
        )}
      </View>
    );
  }

  if (!isFuturePlannedTimeBlock(target.block, openedAtMs)) {
    return (
      <View className="flex-1 justify-center bg-stone-100 px-5">
        <View className="rounded-3xl bg-white p-6">
          <Text className="text-2xl font-semibold text-stone-950">
            此时间块仅供查看
          </Text>
          <Text className="mt-3 leading-6 text-stone-500">
            {timeBlockTypeLabel(target.block.type)} ·{' '}
            {timeBlockStatusLabel(target.block.status)}
            {'\n'}
            {formatDatedRange(
              target.block.startAt,
              target.block.endAt,
              timeZone,
            )}
            {'\n'}已开始、已结束或开始时间已到的时间块不能移动、缩放或解锁。
          </Text>
          <View className="mt-5">
            <TaskEditorLink taskId={target.block.taskId} />
          </View>
        </View>
      </View>
    );
  }

  if (target.block.locked) {
    return (
      <View className="flex-1 justify-center bg-stone-100 px-5">
        <View className="rounded-3xl bg-white p-6">
          <Text className="text-2xl font-semibold text-stone-950">
            此时间块已锁定
          </Text>
          <Text className="mt-3 leading-6 text-stone-500">
            {formatDatedRange(
              target.block.startAt,
              target.block.endAt,
              timeZone,
            )}
            {'\n'}解锁后，后续 Replan 才能移动它。解锁本身不会改变时间。
          </Text>
          {message === null ? null : (
            <Text className="mt-4 text-amber-800">{message}</Text>
          )}
          <Pressable
            accessibilityRole="button"
            className="mt-6 items-center rounded-2xl bg-stone-950 py-4"
            disabled={busy}
            onPress={() => void unlock()}
          >
            <Text className="font-semibold text-white">
              {busy ? '正在解锁…' : '明确解锁'}
            </Text>
          </Pressable>
          <View className="mt-3">
            <TaskEditorLink taskId={target.block.taskId} />
          </View>
        </View>
      </View>
    );
  }

  const visibleInterval =
    gesture === null
      ? interval
      : adjustTimelineInterval({
          kind: gesture.kind,
          ...interval,
          deltaMinutes: gesture.deltaPixels / 2,
          granularityMinutes: 15,
          minimumMinutes: 15,
        });
  const blockHeight = Math.max(
    96,
    ((Date.parse(visibleInterval.endAt) - Date.parse(visibleInterval.startAt)) /
      60_000) *
      2,
  );

  return (
    <ScrollView
      className="flex-1 bg-stone-100"
      contentContainerClassName="gap-5 px-5 pb-12 pt-5"
    >
      <Text className="leading-6 text-stone-500">
        拖动中间区域移动整块；拖动上下边缘缩放。每格 15 分钟，提交后自动锁定。
      </Text>
      <TaskEditorLink taskId={target.block.taskId} />
      <View className="items-center rounded-3xl bg-white p-6">
        <Text className="mb-4 font-medium text-stone-700">
          {formatDatedRange(
            visibleInterval.startAt,
            visibleInterval.endAt,
            timeZone,
          )}
        </Text>
        <View
          className="w-full rounded-2xl bg-emerald-700"
          style={{
            height: blockHeight + 64,
            transform:
              gesture?.kind === 'move'
                ? [{ translateY: gesture.deltaPixels }]
                : [],
          }}
        >
          <View
            accessibilityLabel="拖动开始时间"
            className="h-8 items-center justify-center rounded-t-2xl bg-emerald-900"
            {...responders.resizeStart.panHandlers}
          >
            <Text className="text-xs text-emerald-100">缩放开始 · ≡</Text>
          </View>
          <View
            accessibilityLabel="拖动整个时间块"
            className="flex-1 items-center justify-center"
            {...responders.move.panHandlers}
          >
            <Text className="font-semibold text-white">拖动移动</Text>
          </View>
          <View
            accessibilityLabel="拖动结束时间"
            className="h-8 items-center justify-center rounded-b-2xl bg-emerald-900"
            {...responders.resizeEnd.panHandlers}
          >
            <Text className="text-xs text-emerald-100">缩放结束 · ≡</Text>
          </View>
        </View>
      </View>
      <View className="gap-4 rounded-3xl bg-white p-5">
        <Text className="font-semibold text-stone-900">精调 15 分钟</Text>
        <View className="flex-row gap-3">
          <Pressable
            accessibilityLabel="前移 15 分钟"
            accessibilityRole="button"
            className="flex-1 items-center rounded-2xl border border-stone-300 py-3"
            onPress={() => adjustBy('move', -15)}
          >
            <Text className="font-medium text-stone-800">整块前移</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="后移 15 分钟"
            accessibilityRole="button"
            className="flex-1 items-center rounded-2xl border border-stone-300 py-3"
            onPress={() => adjustBy('move', 15)}
          >
            <Text className="font-medium text-stone-800">整块后移</Text>
          </Pressable>
        </View>
        <View className="flex-row gap-3">
          <Pressable
            accessibilityLabel="开始时间提前 15 分钟"
            accessibilityRole="button"
            className="flex-1 items-center rounded-2xl border border-stone-300 py-3"
            onPress={() => adjustBy('resize_start', -15)}
          >
            <Text className="font-medium text-stone-800">开始提前</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="开始时间延后 15 分钟"
            accessibilityRole="button"
            className="flex-1 items-center rounded-2xl border border-stone-300 py-3"
            onPress={() => adjustBy('resize_start', 15)}
          >
            <Text className="font-medium text-stone-800">开始延后</Text>
          </Pressable>
        </View>
        <View className="flex-row gap-3">
          <Pressable
            accessibilityLabel="结束时间提前 15 分钟"
            accessibilityRole="button"
            className="flex-1 items-center rounded-2xl border border-stone-300 py-3"
            onPress={() => adjustBy('resize_end', -15)}
          >
            <Text className="font-medium text-stone-800">结束提前</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="结束时间延后 15 分钟"
            accessibilityRole="button"
            className="flex-1 items-center rounded-2xl border border-stone-300 py-3"
            onPress={() => adjustBy('resize_end', 15)}
          >
            <Text className="font-medium text-stone-800">结束延后</Text>
          </Pressable>
        </View>
      </View>
      {preview === null ? null : (
        <View className="rounded-3xl bg-emerald-50 p-5">
          <Text className="font-semibold text-emerald-950">调整预览</Text>
          <Text className="mt-2 text-emerald-900">
            原来：
            {formatDatedRange(
              preview.before.startAt,
              preview.before.endAt,
              timeZone,
            )}
            {'\n'}调整：
            {formatDatedRange(
              preview.after.startAt,
              preview.after.endAt,
              timeZone,
            )}
            {'\n'}结果：提交后锁定
          </Text>
          <Text className="mt-2 text-sm text-emerald-800">
            日历忙碌数据：{preview.busyFreshness.completeness}
            {preview.busyFreshness.capturedAt === null
              ? ' · 尚无完整快照'
              : ` · ${new Date(preview.busyFreshness.capturedAt).toLocaleString('zh-CN')}`}
          </Text>
        </View>
      )}
      {message === null ? null : (
        <Text className="rounded-2xl bg-amber-50 px-4 py-3 text-amber-900">
          {message}
        </Text>
      )}
      {preview === null ? (
        <Pressable
          accessibilityRole="button"
          className="items-center rounded-2xl bg-stone-950 py-4"
          disabled={busy}
          onPress={() => void makePreview()}
        >
          <Text className="font-semibold text-white">
            {busy ? '正在校验…' : '查看调整预览'}
          </Text>
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          className="items-center rounded-2xl bg-stone-950 py-4"
          disabled={busy}
          onPress={() => void commit()}
        >
          <Text className="font-semibold text-white">
            {busy ? '正在提交…' : '确认调整并锁定'}
          </Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

export default function TimeBlockAdjustmentScreen() {
  return (
    <RuntimeScreen>
      {(runtime) => <AdjustmentContent runtime={runtime} />}
    </RuntimeScreen>
  );
}
