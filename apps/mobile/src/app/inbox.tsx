import { RuntimeScreen } from '@/components/runtime-screen';
import {
  formatMinuteEstimate,
  userFacingError,
} from '@/presentation/mobile-format';
import type { MobileRuntime } from '@/runtime/mobile-runtime';
import type { Task } from '@workspace/domain';
import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';

type InboxState = Readonly<{
  items: readonly Task[];
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  message: string | null;
}>;

const initialState: InboxState = {
  items: [],
  nextCursor: null,
  loading: true,
  loadingMore: false,
  message: null,
};

function durationCopy(task: Task): string {
  if (task.estimatedDurationMinutes === null) return '等待补充预计时长';
  return `预计 ${formatMinuteEstimate(task.estimatedDurationMinutes)}`;
}

function InboxContent({ runtime }: Readonly<{ runtime: MobileRuntime }>) {
  const [state, setState] = useState<InboxState>(initialState);

  const load = useCallback(
    async (cursor?: string) => {
      setState((current) => ({
        ...current,
        loading: cursor === undefined,
        loadingMore: cursor !== undefined,
        message: null,
      }));
      try {
        const page = await runtime.taskService.list({
          status: 'inbox',
          limit: 20,
          ...(cursor === undefined ? {} : { cursor }),
        });
        setState((current) => {
          const items =
            cursor === undefined
              ? page.items
              : [
                  ...current.items,
                  ...page.items.filter(
                    (task) =>
                      !current.items.some(
                        (currentTask) => currentTask.id === task.id,
                      ),
                  ),
                ];
          return {
            items,
            nextCursor: page.nextCursor,
            loading: false,
            loadingMore: false,
            message: null,
          };
        });
      } catch (error) {
        setState((current) => ({
          ...current,
          loading: false,
          loadingMore: false,
          message: userFacingError(error),
        }));
      }
    },
    [runtime],
  );

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (state.loading && state.items.length === 0) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-100">
        <ActivityIndicator color="#047857" />
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-stone-100"
      contentContainerClassName="gap-4 px-5 pb-12 pt-5"
    >
      <View className="rounded-3xl bg-emerald-50 p-5">
        <Text className="text-xl font-semibold text-emerald-950">
          先收下，再补完整
        </Text>
        <Text className="mt-2 leading-6 text-emerald-800">
          这里仅显示尚未进入计划的任务。补充预计时长后，可从任务页重新排程。
        </Text>
        <Link asChild href="/goals">
          <Pressable
            accessibilityRole="button"
            className="mt-3 self-start py-2"
          >
            <Text className="font-semibold text-emerald-950">
              管理目标与项目 →
            </Text>
          </Pressable>
        </Link>
      </View>

      {state.message === null ? null : (
        <View className="rounded-2xl bg-amber-50 px-4 py-3">
          <Text className="text-amber-900">{state.message}</Text>
          <Pressable
            accessibilityRole="button"
            className="mt-3 self-start py-2"
            onPress={() => void load()}
          >
            <Text className="font-semibold text-amber-950">重试</Text>
          </Pressable>
        </View>
      )}

      {state.items.length === 0 ? (
        <View className="rounded-3xl border border-dashed border-stone-300 bg-white p-5">
          <Text className="text-xl font-semibold text-stone-900">
            收件箱是空的
          </Text>
          <Text className="mt-2 leading-6 text-stone-500">
            新任务可以先保存到这里，不需要一次填写所有约束。
          </Text>
          <Link asChild href="/(tabs)/capture">
            <Pressable
              accessibilityRole="button"
              className="mt-4 self-start rounded-2xl bg-stone-950 px-5 py-3"
            >
              <Text className="font-semibold text-white">添加任务</Text>
            </Pressable>
          </Link>
        </View>
      ) : (
        state.items.map((task) => (
          <Link
            asChild
            key={task.id}
            href={{ pathname: '/task/[taskId]', params: { taskId: task.id } }}
          >
            <Pressable
              accessibilityLabel={`编辑任务 ${task.title}`}
              accessibilityRole="button"
              className="rounded-3xl border border-stone-200 bg-white p-5"
            >
              <Text className="text-lg font-semibold text-stone-950">
                {task.title}
              </Text>
              <Text className="mt-2 text-stone-500">{durationCopy(task)}</Text>
              <Text className="mt-3 font-medium text-emerald-800">
                打开编辑 →
              </Text>
            </Pressable>
          </Link>
        ))
      )}

      {state.nextCursor === null ? null : (
        <Pressable
          accessibilityRole="button"
          className="items-center rounded-2xl border border-stone-300 bg-white py-4"
          disabled={state.loadingMore}
          onPress={() => void load(state.nextCursor ?? undefined)}
        >
          <Text className="font-semibold text-stone-800">
            {state.loadingMore ? '正在加载…' : '加载更多'}
          </Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

export default function InboxScreen() {
  return (
    <RuntimeScreen>
      {(runtime) => <InboxContent runtime={runtime} />}
    </RuntimeScreen>
  );
}
