import { RuntimeScreen } from '@/components/runtime-screen';
import {
  formatInstantDate,
  formatInstantTime,
  userFacingError,
} from '@/presentation/mobile-format';
import type { MobileRuntime } from '@/runtime/mobile-runtime';
import type { AchievementDetails } from '@workspace/application';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

function evidenceDuration(details: AchievementDetails): string {
  const { completionRecord } = details;
  if (completionRecord.actualDurationSeconds === null) {
    return '没有计时证据，实际投入保持未知';
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
  return `已记录投入 ${duration} · ${coverage}`;
}

function AchievementContent({ runtime }: Readonly<{ runtime: MobileRuntime }>) {
  const router = useRouter();
  const parameters = useLocalSearchParams<{
    achievementId?: string | string[];
  }>();
  const achievementId =
    typeof parameters.achievementId === 'string'
      ? parameters.achievementId
      : '';
  const [details, setDetails] = useState<AchievementDetails | null>(null);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void runtime.achievementService
      .getDetails(achievementId)
      .then((value) => {
        if (!active) return;
        setDetails(value);
        setTitle(value.achievement.title);
        setSummary(value.achievement.summary ?? '');
      })
      .catch((error) => {
        if (active) setMessage(userFacingError(error));
      });
    return () => {
      active = false;
    };
  }, [achievementId, runtime]);

  async function save() {
    if (details === null || title.trim() === '') return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await runtime.achievementService.update(
        {
          achievementId: details.achievement.id,
          patch: {
            title: title.trim(),
            summary: summary.trim() || null,
          },
        },
        runtime.createUserWriteContext('edit_achievement'),
      );
      setDetails({ ...details, achievement: result.achievement });
      setTitle(result.achievement.title);
      setSummary(result.achievement.summary ?? '');
      router.replace('/(tabs)/wins');
    } catch (error) {
      setMessage(userFacingError(error));
    } finally {
      setBusy(false);
    }
  }

  async function toggleHidden() {
    if (details === null) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await runtime.achievementService.setHidden(
        {
          achievementId: details.achievement.id,
          hidden: !details.achievement.hidden,
        },
        runtime.createUserWriteContext('set_achievement_visibility'),
      );
      setDetails({ ...details, achievement: result.achievement });
      router.replace('/(tabs)/wins');
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

  const timeZone = runtime.temporal.currentTimeZone();
  return (
    <ScrollView
      className="flex-1 bg-stone-100"
      contentContainerClassName="gap-5 px-5 pb-12 pt-5"
    >
      <View className="rounded-3xl bg-emerald-50 p-5">
        <Text className="text-xs font-semibold uppercase tracking-widest text-emerald-700">
          可追溯完成证据
        </Text>
        <Text className="mt-3 text-lg font-semibold text-stone-950">
          {details.completionRecord.taskTitleSnapshot}
        </Text>
        <Text className="mt-2 text-stone-600">
          {formatInstantDate(details.achievement.occurredAt, timeZone)}{' '}
          {formatInstantTime(details.achievement.occurredAt, timeZone)}
        </Text>
        <Text className="mt-1 text-stone-600">{evidenceDuration(details)}</Text>
        {details.project === null && details.goal === null ? null : (
          <Text className="mt-1 text-stone-600">
            {[details.project?.title, details.goal?.title]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        )}
        <Text className="mt-4 text-xs text-stone-500">
          CompletionRecord · {details.completionRecord.id}
        </Text>
      </View>

      <View className="gap-2">
        <Text className="text-sm font-medium text-stone-700">成就标题</Text>
        <TextInput
          accessibilityLabel="成就标题"
          className="rounded-2xl border border-stone-300 bg-white px-4 py-4 text-base text-stone-950"
          value={title}
          onChangeText={setTitle}
        />
      </View>
      <View className="gap-2">
        <Text className="text-sm font-medium text-stone-700">我的备注</Text>
        <TextInput
          accessibilityLabel="成就备注"
          multiline
          textAlignVertical="top"
          className="min-h-28 rounded-2xl border border-stone-300 bg-white px-4 py-4 text-base text-stone-950"
          placeholder="可选，不会改变完成事实"
          value={summary}
          onChangeText={setSummary}
        />
      </View>

      {message === null ? null : (
        <Text className="rounded-2xl bg-amber-50 px-4 py-3 leading-5 text-amber-900">
          {message}
        </Text>
      )}

      <Pressable
        accessibilityRole="button"
        className="items-center rounded-2xl bg-stone-950 py-4"
        disabled={busy || title.trim() === ''}
        onPress={() => void save()}
      >
        <Text className="font-semibold text-white">保存表达</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        className="items-center rounded-2xl border border-stone-400 py-4"
        disabled={busy}
        onPress={() => void toggleHidden()}
      >
        <Text className="font-semibold text-stone-700">
          {details.achievement.hidden ? '恢复到成就回顾' : '从默认回顾中收起'}
        </Text>
      </Pressable>
      <Text className="text-center text-xs leading-5 text-stone-500">
        收起或编辑只影响展示，不会删除 Task 或 CompletionRecord。
      </Text>
    </ScrollView>
  );
}

export default function AchievementScreen() {
  return (
    <RuntimeScreen>
      {(runtime) => <AchievementContent runtime={runtime} />}
    </RuntimeScreen>
  );
}
