import { RuntimeScreen } from '@/components/runtime-screen';
import { userFacingError } from '@/presentation/mobile-format';
import { normalizeLocalDateInput } from '@/presentation/task-constraints';
import type { MobileRuntime } from '@/runtime/mobile-runtime';
import type { Goal, GoalProgress } from '@workspace/domain';
import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

type GoalItem = Readonly<{ goal: Goal; progress: GoalProgress }>;

type GoalListState = Readonly<{
  items: readonly GoalItem[];
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  saving: boolean;
  message: string | null;
}>;

const initialState: GoalListState = {
  items: [],
  nextCursor: null,
  loading: true,
  loadingMore: false,
  saving: false,
  message: null,
};

function progressCopy(progress: GoalProgress): string {
  if (progress.completionRatio === null) return '暂无可汇总任务';
  return `${progress.completedTaskCount}/${progress.effectiveTaskCount} 已完成 · ${Math.round(progress.completionRatio * 100)}%`;
}

function GoalsContent({ runtime }: Readonly<{ runtime: MobileRuntime }>) {
  const [state, setState] = useState<GoalListState>(initialState);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [targetDate, setTargetDate] = useState('');

  const load = useCallback(
    async (cursor?: string) => {
      setState((current) => ({
        ...current,
        loading: cursor === undefined,
        loadingMore: cursor !== undefined,
        message: null,
      }));
      try {
        const page = await runtime.goalService.list({
          limit: 20,
          ...(cursor === undefined ? {} : { cursor }),
        });
        const additions = await Promise.all(
          page.items.map(async (goal) => ({
            goal,
            progress: await runtime.goalService.progress(goal.id),
          })),
        );
        setState((current) => ({
          ...current,
          items:
            cursor === undefined
              ? additions
              : [
                  ...current.items,
                  ...additions.filter(
                    (item) =>
                      !current.items.some(
                        (currentItem) => currentItem.goal.id === item.goal.id,
                      ),
                  ),
                ],
          nextCursor: page.nextCursor,
          loading: false,
          loadingMore: false,
          saving: false,
          message: null,
        }));
      } catch (error) {
        setState((current) => ({
          ...current,
          loading: false,
          loadingMore: false,
          saving: false,
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

  async function createGoal() {
    if (title.trim() === '') {
      setState((current) => ({ ...current, message: '请填写目标标题。' }));
      return;
    }
    const normalizedTarget = normalizeLocalDateInput(targetDate);
    if (
      normalizedTarget !== '' &&
      !/^\d{4}-\d{2}-\d{2}$/.test(normalizedTarget)
    ) {
      setState((current) => ({
        ...current,
        message: '目标日期必须使用 YYYY-MM-DD。',
      }));
      return;
    }
    setState((current) => ({ ...current, saving: true, message: null }));
    try {
      await runtime.goalService.create(
        {
          title: title.trim(),
          description: description.trim(),
          status: 'active',
          ...(normalizedTarget === '' ? {} : { targetDate: normalizedTarget }),
        },
        runtime.createUserWriteContext('create_goal'),
      );
      setTitle('');
      setDescription('');
      setTargetDate('');
      await load();
    } catch (error) {
      setState((current) => ({
        ...current,
        saving: false,
        message: userFacingError(error),
      }));
    }
  }

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
      contentContainerClassName="gap-5 px-5 pb-12 pt-5"
    >
      <View className="gap-3 rounded-3xl bg-white p-5">
        <Text className="text-xl font-semibold text-stone-950">新建目标</Text>
        <TextInput
          accessibilityLabel="目标标题"
          className="rounded-2xl border border-stone-300 px-4 py-3 text-stone-950"
          placeholder="想持续推进的方向"
          value={title}
          onChangeText={setTitle}
        />
        <TextInput
          accessibilityLabel="目标说明"
          className="min-h-20 rounded-2xl border border-stone-300 px-4 py-3 text-stone-950"
          multiline
          placeholder="说明（可选）"
          textAlignVertical="top"
          value={description}
          onChangeText={setDescription}
        />
        <TextInput
          accessibilityLabel="目标日期"
          autoCapitalize="none"
          autoCorrect={false}
          className="rounded-2xl border border-stone-300 px-4 py-3 text-stone-950"
          placeholder="目标日期 YYYY-MM-DD（可选）"
          spellCheck={false}
          value={targetDate}
          onChangeText={setTargetDate}
        />
        <Pressable
          accessibilityRole="button"
          className="items-center rounded-2xl bg-stone-950 py-4"
          disabled={state.saving}
          onPress={() => void createGoal()}
        >
          <Text className="font-semibold text-white">
            {state.saving ? '正在创建…' : '创建目标'}
          </Text>
        </Pressable>
      </View>

      {state.message === null ? null : (
        <Text className="rounded-2xl bg-amber-50 px-4 py-3 text-amber-900">
          {state.message}
        </Text>
      )}

      <Text className="text-xs font-semibold uppercase tracking-widest text-stone-500">
        进行中的目标
      </Text>
      {state.items.length === 0 ? (
        <Text className="rounded-3xl border border-dashed border-stone-300 bg-white p-5 text-stone-500">
          还没有目标。目标只汇总真实关联任务，不需要手工填写进度。
        </Text>
      ) : (
        state.items.map(({ goal, progress }) => (
          <Link
            asChild
            key={goal.id}
            href={{ pathname: '/goal/[goalId]', params: { goalId: goal.id } }}
          >
            <Pressable
              accessibilityLabel={`打开目标 ${goal.title}`}
              accessibilityRole="button"
              className="rounded-3xl border border-stone-200 bg-white p-5"
            >
              <Text className="text-lg font-semibold text-stone-950">
                {goal.title}
              </Text>
              <Text className="mt-2 text-stone-500">
                {progressCopy(progress)}
                {goal.targetDate === null ? '' : ` · 目标 ${goal.targetDate}`}
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

export default function GoalsScreen() {
  return (
    <RuntimeScreen>
      {(runtime) => <GoalsContent runtime={runtime} />}
    </RuntimeScreen>
  );
}
