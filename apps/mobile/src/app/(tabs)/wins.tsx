import { RuntimeScreen } from '@/components/runtime-screen';
import {
  formatInstantDate,
  formatInstantTime,
  shiftLocalDate,
  userFacingError,
} from '@/presentation/mobile-format';
import type { MobileRuntime } from '@/runtime/mobile-runtime';
import type { AchievementDetails } from '@workspace/application';
import { parseInstant } from '@workspace/domain';
import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type Period = 'today' | 'week' | 'month' | 'history';

const periods: readonly Readonly<{ key: Period; label: string }>[] = [
  { key: 'today', label: '今天' },
  { key: 'week', label: '本周' },
  { key: 'month', label: '本月' },
  { key: 'history', label: '历史' },
];

function weekStart(localDate: string): string {
  const [year, month, day] = localDate.split('-').map(Number);
  const weekday = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
  return shiftLocalDate(localDate, -(weekday === 0 ? 6 : weekday - 1));
}

function monthAfter(localDate: string): string {
  const [year, month] = localDate.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month!, 1));
  return [
    date.getUTCFullYear().toString().padStart(4, '0'),
    (date.getUTCMonth() + 1).toString().padStart(2, '0'),
    '01',
  ].join('-');
}

function durationCopy(details: AchievementDetails): string {
  const { completionRecord } = details;
  if (completionRecord.actualDurationSeconds === null) {
    return '实际投入未知';
  }
  const duration =
    completionRecord.actualDurationSeconds < 60
      ? `${completionRecord.actualDurationSeconds} 秒`
      : `${Math.round(completionRecord.actualDurationSeconds / 60)} 分钟`;
  const coverage =
    completionRecord.durationCoverage === 'complete'
      ? '完整记录'
      : completionRecord.durationCoverage === 'partial'
        ? '部分记录'
        : '覆盖未知';
  return `已记录 ${duration} · ${coverage}`;
}

function WinsContent({ runtime }: Readonly<{ runtime: MobileRuntime }>) {
  const [period, setPeriod] = useState<Period>('today');
  const [showHidden, setShowHidden] = useState(false);
  const [items, setItems] = useState<readonly AchievementDetails[] | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const details = await runtime.achievementService.listAllDetails({
        includeHidden: period === 'history' && showHidden,
      });
      setItems(details);
      setMessage(null);
    } catch (error) {
      setMessage(userFacingError(error));
    }
  }, [period, runtime, showHidden]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const timeZone = runtime.temporal.currentTimeZone();
  const today = runtime.temporal.resolve(
    parseInstant(new Date().toISOString()),
  ).localDate;
  const visible = useMemo(() => {
    if (items === null) return [];
    if (period === 'history') return items;
    const firstLocalDate =
      period === 'today'
        ? today
        : period === 'week'
          ? weekStart(today)
          : `${today.slice(0, 7)}-01`;
    const lastLocalDate =
      period === 'today'
        ? shiftLocalDate(today, 1)
        : period === 'week'
          ? shiftLocalDate(firstLocalDate, 7)
          : monthAfter(firstLocalDate);
    const start = runtime.temporal.dayRange({
      localDate: firstLocalDate,
      timeZone,
    }).start;
    const end = runtime.temporal.dayRange({
      localDate: lastLocalDate,
      timeZone,
    }).start;
    return items.filter(
      ({ achievement }) =>
        Date.parse(achievement.occurredAt) >= Date.parse(start) &&
        Date.parse(achievement.occurredAt) < Date.parse(end),
    );
  }, [items, period, runtime.temporal, timeZone, today]);

  if (items === null && message === null) {
    return (
      <SafeAreaView
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
      >
        <ActivityIndicator color="#047857" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <ScrollView
        className="flex-1"
        style={{ flex: 1 }}
        contentContainerClassName="gap-6 px-5 pb-10 pt-5"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor="#047857"
            onRefresh={() => {
              setRefreshing(true);
              void load().finally(() => setRefreshing(false));
            }}
          />
        }
      >
        <View className="flex-row items-start justify-between">
          <View className="flex-1 pr-4">
            <Text className="text-4xl font-semibold text-stone-950">成就</Text>
            <Text className="mt-2 leading-6 text-stone-500">
              只记录有完成证据的真实进展。
            </Text>
          </View>
          <Link asChild href="/settings">
            <Pressable
              accessibilityLabel="打开设置"
              accessibilityRole="button"
              className="rounded-full border border-stone-300 bg-white px-4 py-2"
            >
              <Text className="font-medium text-stone-700">设置</Text>
            </Pressable>
          </Link>
        </View>

        <View className="flex-row rounded-2xl bg-stone-200 p-1">
          {periods.map((item) => (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              className={`flex-1 items-center rounded-xl py-2 ${
                period === item.key ? 'bg-white' : ''
              }`}
              onPress={() => setPeriod(item.key)}
            >
              <Text
                className={`text-sm font-medium ${
                  period === item.key ? 'text-stone-950' : 'text-stone-500'
                }`}
              >
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {period === 'history' ? (
          <Pressable
            accessibilityRole="button"
            className="self-start rounded-full border border-stone-300 bg-white px-4 py-2"
            onPress={() => setShowHidden((current) => !current)}
          >
            <Text className="text-sm font-medium text-stone-700">
              {showHidden ? '隐藏已收起记录' : '查看已收起记录'}
            </Text>
          </Pressable>
        ) : null}

        {message === null ? null : (
          <Text className="rounded-2xl bg-amber-50 px-4 py-3 text-amber-900">
            {message}
          </Text>
        )}

        {visible.length === 0 ? (
          <View className="rounded-3xl border border-dashed border-stone-300 bg-white px-5 py-8">
            <Text className="text-xl font-semibold text-stone-900">
              这里还没有完成记录
            </Text>
            <Text className="mt-2 leading-6 text-stone-500">
              完成整个任务并选择记录成就后，它会带着来源证据出现在这里。
            </Text>
          </View>
        ) : (
          visible.map((details) => (
            <Link
              key={details.achievement.id}
              asChild
              href={{
                pathname: '/achievement/[achievementId]',
                params: { achievementId: details.achievement.id },
              }}
            >
              <Pressable accessibilityRole="button">
                <View
                  className={`rounded-3xl border bg-white p-5 ${
                    details.achievement.hidden
                      ? 'border-stone-300 opacity-60'
                      : 'border-emerald-100'
                  }`}
                >
                  <Text className="text-xs font-semibold uppercase tracking-widest text-emerald-700">
                    {details.achievement.hidden ? '已收起' : '真实完成'}
                  </Text>
                  <Text className="mt-2 text-xl font-semibold text-stone-950">
                    {details.achievement.title}
                  </Text>
                  {details.achievement.summary === null ? null : (
                    <Text className="mt-2 leading-6 text-stone-600">
                      {details.achievement.summary}
                    </Text>
                  )}
                  <Text className="mt-4 text-sm text-stone-500">
                    {formatInstantDate(
                      details.achievement.occurredAt,
                      timeZone,
                    )}{' '}
                    {formatInstantTime(
                      details.achievement.occurredAt,
                      timeZone,
                    )}
                  </Text>
                  <Text className="mt-1 text-sm text-stone-500">
                    {durationCopy(details)}
                  </Text>
                  {details.project === null && details.goal === null ? null : (
                    <Text className="mt-1 text-sm text-stone-500">
                      {[details.project?.title, details.goal?.title]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  )}
                  <Text className="mt-4 text-xs text-stone-400">
                    来源：任务完成 · {details.completionRecord.id}
                  </Text>
                </View>
              </Pressable>
            </Link>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

export default function WinsScreen() {
  return (
    <RuntimeScreen>
      {(runtime) => <WinsContent runtime={runtime} />}
    </RuntimeScreen>
  );
}
