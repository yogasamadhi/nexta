import { RuntimeScreen } from '@/components/runtime-screen';
import { userFacingError } from '@/presentation/mobile-format';
import type { MobileRuntime } from '@/runtime/mobile-runtime';
import type { DailyReflection } from '@workspace/domain';
import { parseInstant } from '@workspace/domain';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

function ReflectionContent({ runtime }: Readonly<{ runtime: MobileRuntime }>) {
  const router = useRouter();
  const day = useMemo(() => {
    const local = runtime.temporal.resolve(
      parseInstant(new Date().toISOString()),
    );
    return {
      ...local,
      range: runtime.temporal.dayRange({
        localDate: local.localDate,
        timeZone: local.timeZone,
      }),
    };
  }, [runtime]);
  const [reflection, setReflection] = useState<DailyReflection | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const current = await runtime.reflectionService.getForDay(day);
      setReflection(current);
      setNote(current?.userNote ?? '');
      setMessage(null);
    } catch (error) {
      setMessage(userFacingError(error));
    } finally {
      setLoading(false);
    }
  }, [day, runtime]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function refresh() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await runtime.reflectionService.refresh(
        { ...day, userNote: note },
        runtime.createUserWriteContext('refresh_reflection'),
      );
      setReflection(result.reflection);
      setNote(result.reflection.userNote ?? '');
      setMessage('已按本地完成事实更新。');
    } catch (error) {
      setMessage(userFacingError(error));
    } finally {
      setBusy(false);
    }
  }

  async function adjust() {
    setBusy(true);
    setMessage(null);
    try {
      const preview = await runtime.scheduleService.replan({
        reason: 'daily_reflection_adjustment',
      });
      router.push({
        pathname: '/schedule-preview',
        params: { previewId: preview.previewId },
      });
    } catch (error) {
      setMessage(userFacingError(error));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color="#047857" />
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-stone-100"
      contentContainerClassName="gap-5 px-5 pb-12 pt-6"
    >
      <View>
        <Text className="text-4xl font-semibold text-stone-950">今日复盘</Text>
        <Text className="mt-2 leading-6 text-stone-500">
          不到一分钟。事实来自本机完成记录；离线也能使用。
        </Text>
      </View>
      {message === null ? null : (
        <Text className="rounded-2xl bg-emerald-50 px-4 py-3 text-emerald-900">
          {message}
        </Text>
      )}
      {reflection === null ? (
        <View className="rounded-3xl border border-dashed border-stone-300 bg-white p-5">
          <Text className="text-xl font-semibold text-stone-900">
            还没有今天的事实摘要
          </Text>
          <Text className="mt-2 leading-6 text-stone-500">
            生成时只会使用今天真实存在的
            CompletionRecord，不会补写未发生的成果或未知耗时。
          </Text>
        </View>
      ) : (
        <>
          <View className="rounded-3xl bg-white p-5">
            <Text className="text-xs font-semibold uppercase tracking-widest text-stone-400">
              今天完成了什么
            </Text>
            <Text className="mt-3 text-lg leading-7 text-stone-900">
              {reflection.summary}
            </Text>
            <View className="mt-4 gap-2">
              {reflection.wins.map((win) => (
                <Text
                  key={win.completionRecordId}
                  className="rounded-2xl bg-emerald-50 px-4 py-3 font-medium text-emerald-900"
                >
                  ✓ {win.title}
                </Text>
              ))}
            </View>
          </View>
          <View className="rounded-3xl bg-white p-5">
            <Text className="text-xs font-semibold uppercase tracking-widest text-stone-400">
              明天需要调整什么
            </Text>
            <Text className="mt-3 leading-6 text-stone-700">
              {reflection.adjustmentSuggestion ?? '暂时没有本地建议。'}
            </Text>
          </View>
        </>
      )}
      <View className="rounded-3xl bg-white p-5">
        <Text className="font-semibold text-stone-900">哪件事值得记住？</Text>
        <TextInput
          accessibilityLabel="复盘备注"
          className="mt-3 min-h-28 rounded-2xl border border-stone-300 px-4 py-3 text-stone-950"
          multiline
          maxLength={4_000}
          onChangeText={setNote}
          placeholder="可选，只写你自己的观察"
          textAlignVertical="top"
          value={note}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        className="items-center rounded-2xl bg-stone-950 py-4"
        disabled={busy}
        onPress={() => void refresh()}
      >
        <Text className="font-semibold text-white">
          {busy
            ? '正在保存…'
            : reflection === null
              ? '生成事实摘要'
              : '保存并刷新事实'}
        </Text>
      </Pressable>
      {reflection === null ? null : (
        <Pressable
          accessibilityRole="button"
          className="items-center rounded-2xl border border-stone-300 py-4"
          disabled={busy}
          onPress={() => void adjust()}
        >
          <Text className="font-semibold text-stone-900">查看调整计划预览</Text>
        </Pressable>
      )}
      <Text className="text-sm leading-5 text-stone-400">
        复盘用于行为反馈和下一步安排，不提供诊断、治疗承诺或人格评价。
      </Text>
    </ScrollView>
  );
}

export default function ReflectionScreen() {
  return (
    <RuntimeScreen>
      {(runtime) => <ReflectionContent runtime={runtime} />}
    </RuntimeScreen>
  );
}
