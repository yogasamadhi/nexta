import { RuntimeScreen } from '@/components/runtime-screen';
import {
  formatInstantTime,
  isFuturePlannedTimeBlock,
  localWeekDates,
  shiftLocalDate,
  timeBlockStatusLabel,
  timeBlockTypeLabel,
  userFacingError,
} from '@/presentation/mobile-format';
import {
  layoutTimelineItems,
  timelineHeight,
  type TimelineItemLayout,
} from '@/presentation/timeline-layout';
import type { MobileRuntime } from '@/runtime/mobile-runtime';
import type { DayTimelineView, TimeBlockSummary } from '@workspace/application';
import { parseInstant } from '@workspace/domain';
import { Link, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  LinearTransition,
  ReduceMotion,
} from 'react-native-reanimated';

const pixelsPerMinute = 1;
const blockLayoutTransition = LinearTransition.duration(180).reduceMotion(
  ReduceMotion.System,
);

function TimelineBlockCard({
  layout,
  timeZone,
  nowMs,
}: Readonly<{
  layout: TimelineItemLayout<TimeBlockSummary>;
  timeZone: string;
  nowMs: number;
}>) {
  const title = layout.item.task?.title ?? timeBlockTypeLabel(layout.item.type);
  const adjustable = isFuturePlannedTimeBlock(layout.item, nowMs);
  const action = layout.item.locked ? '解锁' : '调整';
  const content = (
    <View
      className={`flex-1 rounded-xl px-3 py-2 ${
        adjustable
          ? 'bg-emerald-700'
          : layout.item.status === 'started'
            ? 'bg-sky-800'
            : 'bg-stone-500'
      }`}
    >
      <Text className="font-semibold text-white" numberOfLines={1}>
        {title}
      </Text>
      <Text className="text-xs text-white opacity-80">
        {formatInstantTime(layout.item.startAt, timeZone)} ·{' '}
        {timeBlockStatusLabel(layout.item.status)}
        {adjustable ? ` · 点按${action}` : ' · 仅查看'}
      </Text>
    </View>
  );

  return (
    <Animated.View
      layout={blockLayoutTransition}
      style={{
        position: 'absolute',
        left: 16,
        right: 16,
        top: layout.top,
        height: Math.max(layout.height, 34),
      }}
    >
      {adjustable ? (
        <Link
          asChild
          href={{
            pathname: '/time-block/[timeBlockId]',
            params: { timeBlockId: layout.item.id },
          }}
        >
          <Pressable
            accessibilityLabel={`${action} ${title}，${timeBlockStatusLabel(layout.item.status)}，${formatInstantTime(layout.item.startAt, timeZone)} 开始`}
            accessibilityRole="button"
            className="flex-1"
          >
            {content}
          </Pressable>
        </Link>
      ) : layout.item.taskId === null ? (
        content
      ) : (
        <Link
          asChild
          href={{
            pathname: '/task/[taskId]',
            params: { taskId: layout.item.taskId },
          }}
        >
          <Pressable
            accessibilityLabel={`查看 ${title}，${timeBlockStatusLabel(layout.item.status)}，${formatInstantTime(layout.item.startAt, timeZone)} 开始`}
            accessibilityRole="button"
            className="flex-1"
          >
            {content}
          </Pressable>
        </Link>
      )}
    </Animated.View>
  );
}

function CalendarContent({ runtime }: Readonly<{ runtime: MobileRuntime }>) {
  const router = useRouter();
  const local = useMemo(
    () => runtime.temporal.resolve(parseInstant(new Date().toISOString())),
    [runtime],
  );
  const [date, setDate] = useState(local.localDate as string);
  const [view, setView] = useState<DayTimelineView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [observedNowMs, setObservedNowMs] = useState(Date.now);
  const weekDates = useMemo(() => localWeekDates(date), [date]);

  const load = useCallback(async () => {
    try {
      setError(null);
      setObservedNowMs(Date.now());
      setView(
        await runtime.planningQueries.getDayTimeline({
          localDate: date,
          timeZone: local.timeZone,
        }),
      );
    } catch (caught) {
      setError(userFacingError(caught));
    }
  }, [date, local.timeZone, runtime]);

  useFocusEffect(useCallback(() => void load(), [load]));

  const replanDay = useCallback(async () => {
    if (view === null || view.localDate !== date) return;
    setScheduling(true);
    setError(null);
    try {
      const preview = await runtime.scheduleService.replan({
        reason: 'user_requested_calendar_day',
        timeRange: {
          start: view.range.start,
          end: view.range.end,
        },
      });
      router.push({
        pathname: '/schedule-preview',
        params: { previewId: preview.previewId },
      });
    } catch (caught) {
      setError(userFacingError(caught));
    } finally {
      setScheduling(false);
    }
  }, [date, router, runtime, view]);

  const renderedView = view?.localDate === date ? view : null;

  if (renderedView === null && error === null) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center">
        <ActivityIndicator color="#047857" />
      </SafeAreaView>
    );
  }

  const range = renderedView?.range;
  const blockLayouts = range
    ? layoutTimelineItems({
        ...range,
        rangeStart: range.start,
        rangeEnd: range.end,
        pixelsPerMinute,
        items: renderedView.blocks,
      })
    : [];
  const busyLayouts = range
    ? layoutTimelineItems({
        ...range,
        rangeStart: range.start,
        rangeEnd: range.end,
        pixelsPerMinute,
        items: renderedView.busy,
      })
    : [];
  const height = range
    ? timelineHeight(range.start, range.end, pixelsPerMinute)
    : 0;
  const ticks = range
    ? Array.from(
        {
          length:
            Math.ceil(
              (Date.parse(range.end) - Date.parse(range.start)) / 3_600_000,
            ) + 1,
        },
        (_, index) =>
          new Date(Date.parse(range.start) + index * 3_600_000).toISOString(),
      ).filter((instant) => Date.parse(instant) <= Date.parse(range.end))
    : [];

  return (
    <SafeAreaView className="flex-1" edges={['top']} style={{ flex: 1 }}>
      <View className="flex-row items-center justify-between px-5 py-5">
        <Pressable
          accessibilityLabel="前一天"
          accessibilityRole="button"
          onPress={() => setDate(shiftLocalDate(date, -1))}
        >
          <Text className="text-lg">‹</Text>
        </Pressable>
        <View className="items-center">
          <Text className="text-2xl font-semibold text-stone-950">{date}</Text>
          <Text className="text-sm text-stone-500">{local.timeZone}</Text>
        </View>
        <Pressable
          accessibilityLabel="后一天"
          accessibilityRole="button"
          onPress={() => setDate(shiftLocalDate(date, 1))}
        >
          <Text className="text-lg">›</Text>
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="button"
        className="mx-5 mb-3 items-center rounded-2xl border border-stone-300 bg-white py-3"
        disabled={renderedView === null || scheduling}
        onPress={() => void replanDay()}
      >
        <Text className="font-semibold text-stone-900">
          {scheduling ? '正在计算…' : '重新规划这一天'}
        </Text>
      </Pressable>
      <View className="mx-5 mb-4 flex-row rounded-2xl bg-stone-200 p-1">
        {weekDates.map((weekDate) => {
          const selected = weekDate === date;
          const day = Number(weekDate.slice(-2));
          const weekday = new Intl.DateTimeFormat('zh-CN', {
            timeZone: 'UTC',
            weekday: 'short',
          }).format(new Date(`${weekDate}T00:00:00.000Z`));
          return (
            <Pressable
              key={weekDate}
              accessibilityLabel={`选择 ${weekDate} ${weekday}`}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              className={`min-h-12 flex-1 items-center justify-center rounded-xl ${selected ? 'bg-white' : ''}`}
              onPress={() => setDate(weekDate)}
            >
              <Text
                className={`text-xs ${selected ? 'font-semibold text-stone-950' : 'text-stone-500'}`}
              >
                {weekday}
              </Text>
              <Text
                className={`mt-1 text-sm ${selected ? 'font-semibold text-emerald-800' : 'text-stone-700'}`}
              >
                {day}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {error === null ? null : (
        <Text className="mx-5 mb-3 rounded-2xl bg-amber-50 px-4 py-3 text-amber-900">
          {error}
        </Text>
      )}
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-5 pb-12"
        style={{ flex: 1 }}
      >
        <View style={{ height }} className="ml-12 border-l border-stone-300">
          {ticks.map((instant) => {
            const top =
              ((Date.parse(instant) - Date.parse(range!.start)) / 60_000) *
              pixelsPerMinute;
            return (
              <View
                key={instant}
                className="absolute -left-12 right-0 flex-row items-center"
                style={{ top }}
              >
                <Text className="w-11 text-xs text-stone-400">
                  {formatInstantTime(instant, local.timeZone)}
                </Text>
                <View className="h-px flex-1 bg-stone-200" />
              </View>
            );
          })}
          {busyLayouts.map((item) => (
            <View
              key={item.item.id}
              className="absolute left-2 right-2 rounded-lg bg-stone-300 px-2 py-1"
              style={{ top: item.top, height: Math.max(item.height, 18) }}
            >
              <Text className="text-xs text-stone-600">系统日历忙碌</Text>
            </View>
          ))}
          {blockLayouts.map((layout) => (
            <TimelineBlockCard
              key={layout.item.id}
              layout={layout}
              nowMs={observedNowMs}
              timeZone={local.timeZone}
            />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export default function CalendarScreen() {
  return (
    <RuntimeScreen>
      {(runtime) => <CalendarContent runtime={runtime} />}
    </RuntimeScreen>
  );
}
