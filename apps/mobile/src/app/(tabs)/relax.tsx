import { RuntimeScreen } from '@/components/runtime-screen';
import { userFacingError } from '@/presentation/mobile-format';
import type { MobileRuntime } from '@/runtime/mobile-runtime';
import type { RelaxSession, RelaxSource, RelaxType } from '@workspace/domain';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StatusBar,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const options: readonly Readonly<{
  type: RelaxType;
  minutes: number;
  title: string;
  detail: string;
}>[] = [
  {
    type: 'breathing',
    minutes: 1,
    title: '1 分钟呼吸',
    detail: '自然呼吸，缓慢把注意力带回此刻。',
  },
  {
    type: 'pause',
    minutes: 3,
    title: '3 分钟放空',
    detail: '不解决问题，只给注意力留一点空白。',
  },
  {
    type: 'stretch',
    minutes: 5,
    title: '5 分钟拉伸',
    detail: '在舒适范围内活动肩颈和四肢。',
  },
  {
    type: 'ambient',
    minutes: 3,
    title: '环境声 / 静默',
    detail: '当前使用静默模式，不需要网络或音频权限。',
  },
];

function elapsedSeconds(session: RelaxSession, now: number): number {
  if (session.actualSeconds !== null) return session.actualSeconds;
  return Math.max(0, Math.floor((now - Date.parse(session.startedAt)) / 1_000));
}

function RelaxContent({ runtime }: Readonly<{ runtime: MobileRuntime }>) {
  const router = useRouter();
  const params = useLocalSearchParams<{
    source?: string | string[];
    returnSessionId?: string | string[];
  }>();
  const requestedSource =
    typeof params.source === 'string' ? params.source : 'relax_tab';
  const source: RelaxSource = ['today', 'focus', 'relax_tab'].includes(
    requestedSource,
  )
    ? (requestedSource as RelaxSource)
    : 'relax_tab';
  const returnSessionId =
    typeof params.returnSessionId === 'string' ? params.returnSessionId : null;
  const [session, setSession] = useState<RelaxSession | null>(null);
  const [finished, setFinished] = useState<RelaxSession | null>(null);
  const [now, setNow] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [focused, setFocused] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSession(await runtime.relaxService.getActive());
      setMessage(null);
    } catch (error) {
      setMessage(userFacingError(error));
    } finally {
      setLoading(false);
    }
  }, [runtime]);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      void load();
      return () => setFocused(false);
    }, [load]),
  );

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const elapsed = useMemo(
    () => (session === null ? 0 : elapsedSeconds(session, now)),
    [now, session],
  );

  async function start(type: RelaxType, plannedMinutes: number) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await runtime.relaxService.start(
        { type, plannedMinutes, source },
        runtime.createUserWriteContext('start_relax'),
      );
      setSession(result.session);
      setFinished(null);
      setNow(Date.parse(result.session.startedAt));
    } catch (error) {
      setMessage(userFacingError(error));
    } finally {
      setBusy(false);
    }
  }

  async function end(outcome: 'completed' | 'abandoned') {
    if (session === null) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await runtime.relaxService.end(
        { sessionId: session.id, outcome },
        runtime.createUserWriteContext(
          outcome === 'completed' ? 'complete_relax' : 'leave_relax',
        ),
      );
      setSession(null);
      setFinished(result.session);
      if (outcome === 'abandoned') router.replace('/(tabs)/today');
    } catch (error) {
      setMessage(userFacingError(error));
    } finally {
      setBusy(false);
    }
  }

  async function returnToTask() {
    if (returnSessionId !== null) {
      try {
        const details = await runtime.executionService.get(returnSessionId);
        if (details.session.status === 'paused') {
          await runtime.executionService.resume(
            { sessionId: details.session.id },
            runtime.createUserWriteContext('resume_after_relax'),
          );
          router.replace({
            pathname: '/focus/[sessionId]',
            params: { sessionId: details.session.id },
          });
          return;
        }
      } catch (error) {
        setMessage(`放松记录已保存。${userFacingError(error)}`);
        return;
      }
    }
    router.replace('/(tabs)/today');
  }

  async function adjustToday() {
    setBusy(true);
    setMessage(null);
    try {
      const preview = await runtime.scheduleService.replan({
        reason: 'relax_completed_adjust_today',
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
      <SafeAreaView
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
      >
        <ActivityIndicator color="#047857" />
      </SafeAreaView>
    );
  }

  if (session !== null) {
    const remaining = Math.max(session.plannedMinutes * 60 - elapsed, 0);
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: '#022c22' }}
        edges={['top']}
      >
        {focused ? <StatusBar barStyle="light-content" /> : null}
        <ScrollView
          className="flex-1"
          contentContainerClassName="justify-between gap-8 px-6 pb-10 pt-10"
          contentContainerStyle={{ flexGrow: 1 }}
        >
          <View>
            <Text className="text-center text-sm font-medium uppercase tracking-widest text-emerald-200">
              短暂恢复
            </Text>
            <Text className="mt-8 text-center text-4xl font-semibold text-white">
              {options.find((option) => option.type === session.type)?.title ??
                '放松'}
            </Text>
            <Text className="mt-5 text-center text-lg leading-7 text-emerald-100">
              {options.find((option) => option.type === session.type)?.detail}
            </Text>
            <Text className="mt-16 text-center text-6xl font-light tabular-nums text-white">
              {Math.floor(remaining / 60)
                .toString()
                .padStart(2, '0')}
              :{(remaining % 60).toString().padStart(2, '0')}
            </Text>
            <Text className="mt-4 text-center text-emerald-200">
              {remaining === 0 ? '时间到了，可以从容结束' : '无需追求任何状态'}
            </Text>
          </View>
          <View className="gap-3">
            {message === null ? null : (
              <Text className="rounded-2xl bg-amber-950 px-4 py-3 text-amber-100">
                {message}
              </Text>
            )}
            <Pressable
              accessibilityRole="button"
              className="items-center rounded-2xl bg-white py-4"
              disabled={busy}
              onPress={() => void end('completed')}
            >
              <Text className="font-semibold text-emerald-950">结束放松</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              className="items-center py-3"
              disabled={busy}
              onPress={() => void end('abandoned')}
            >
              <Text className="font-medium text-emerald-300">现在离开</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (finished !== null) {
    return (
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView contentContainerClassName="gap-4 px-5 pb-12 pt-8">
          <Text className="text-4xl font-semibold text-stone-950">
            现在怎么样？
          </Text>
          <Text className="leading-6 text-stone-500">
            已在本机记录 {finished.actualSeconds ?? 0}{' '}
            秒。它不会被解释成医疗或心理状态。
          </Text>
          {finished.timingQuality === 'needs_review' ? (
            <Text className="rounded-2xl bg-amber-50 px-4 py-3 text-amber-900">
              设备时间发生倒退，本次时长已标记待核对。
            </Text>
          ) : null}
          {message === null ? null : (
            <Text className="rounded-2xl bg-amber-50 px-4 py-3 text-amber-900">
              {message}
            </Text>
          )}
          <Pressable
            accessibilityRole="button"
            className="mt-4 items-center rounded-2xl bg-stone-950 py-4"
            disabled={busy}
            onPress={() => void returnToTask()}
          >
            <Text className="font-semibold text-white">
              {returnSessionId === null ? '开始任务' : '返回并继续任务'}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            className="items-center rounded-2xl border border-stone-300 py-4"
            disabled={busy}
            onPress={() => void start(finished.type, finished.plannedMinutes)}
          >
            <Text className="font-semibold text-stone-900">再休息一会</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            className="items-center rounded-2xl border border-stone-300 py-4"
            disabled={busy}
            onPress={() => void adjustToday()}
          >
            <Text className="font-semibold text-stone-900">调整今天</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
      <ScrollView contentContainerClassName="gap-4 px-5 pb-12 pt-6">
        <Text className="text-4xl font-semibold text-stone-950">放松</Text>
        <Text className="text-lg text-stone-500">现在需要什么？</Text>
        {message === null ? null : (
          <Text className="rounded-2xl bg-amber-50 px-4 py-3 text-amber-900">
            {message}
          </Text>
        )}
        {options.map((option) => (
          <Pressable
            accessibilityRole="button"
            key={option.type}
            className="rounded-3xl border border-stone-200 bg-white p-5"
            disabled={busy}
            onPress={() => void start(option.type, option.minutes)}
          >
            <Text className="text-xl font-semibold text-stone-950">
              {option.title}
            </Text>
            <Text className="mt-2 leading-6 text-stone-500">
              {option.detail}
            </Text>
          </Pressable>
        ))}
        <Text className="mt-2 text-sm leading-5 text-stone-400">
          放松是可选的恢复支持，不是课程、诊断或治疗。
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

export default function RelaxScreen() {
  return (
    <RuntimeScreen>
      {(runtime) => <RelaxContent runtime={runtime} />}
    </RuntimeScreen>
  );
}
