import { RuntimeScreen } from '@/components/runtime-screen';
import { userFacingError } from '@/presentation/mobile-format';
import type { MobileRuntime } from '@/runtime/mobile-runtime';
import type { Goal, GoalProgress, Project } from '@workspace/domain';
import {
  Link,
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

type DetailState = Readonly<{
  goal: Goal | null;
  progress: GoalProgress | null;
  projects: readonly Project[];
  nextCursor: string | null;
  busy: boolean;
  message: string | null;
}>;

function GoalDetail({ runtime }: Readonly<{ runtime: MobileRuntime }>) {
  const router = useRouter();
  const parameters = useLocalSearchParams<{ goalId?: string | string[] }>();
  const goalId = typeof parameters.goalId === 'string' ? parameters.goalId : '';
  const [state, setState] = useState<DetailState>({
    goal: null,
    progress: null,
    projects: [],
    nextCursor: null,
    busy: false,
    message: null,
  });
  const [projectTitle, setProjectTitle] = useState('');
  const [confirmArchiveGoal, setConfirmArchiveGoal] = useState(false);
  const [confirmArchiveProjectId, setConfirmArchiveProjectId] = useState<
    string | null
  >(null);

  const load = useCallback(async () => {
    try {
      const [goal, progress, projectPage] = await Promise.all([
        runtime.goalService.get(goalId),
        runtime.goalService.progress(goalId),
        runtime.projectService.list({ goalId, limit: 50 }),
      ]);
      setState({
        goal,
        progress,
        projects: projectPage.items,
        nextCursor: projectPage.nextCursor,
        busy: false,
        message: null,
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        busy: false,
        message: userFacingError(error),
      }));
    }
  }, [goalId, runtime]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function createProject() {
    if (projectTitle.trim() === '') {
      setState((current) => ({ ...current, message: '请填写项目标题。' }));
      return;
    }
    setState((current) => ({ ...current, busy: true, message: null }));
    try {
      await runtime.projectService.create(
        {
          goalId,
          title: projectTitle.trim(),
          status: 'active',
        },
        runtime.createUserWriteContext('create_project'),
      );
      setProjectTitle('');
      await load();
    } catch (error) {
      setState((current) => ({
        ...current,
        busy: false,
        message: userFacingError(error),
      }));
    }
  }

  async function archiveProject(projectId: string) {
    setState((current) => ({ ...current, busy: true, message: null }));
    try {
      await runtime.projectService.archive(
        { projectId },
        runtime.createUserWriteContext('archive_project'),
      );
      setConfirmArchiveProjectId(null);
      await load();
    } catch (error) {
      setState((current) => ({
        ...current,
        busy: false,
        message: userFacingError(error),
      }));
    }
  }

  async function loadMoreProjects() {
    if (state.nextCursor === null) return;
    setState((current) => ({ ...current, busy: true, message: null }));
    try {
      const page = await runtime.projectService.list({
        goalId,
        cursor: state.nextCursor,
        limit: 50,
      });
      setState((current) => ({
        ...current,
        projects: [
          ...current.projects,
          ...page.items.filter(
            (project) =>
              !current.projects.some(
                (currentProject) => currentProject.id === project.id,
              ),
          ),
        ],
        nextCursor: page.nextCursor,
        busy: false,
        message: null,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        busy: false,
        message: userFacingError(error),
      }));
    }
  }

  async function archiveGoal() {
    setState((current) => ({ ...current, busy: true, message: null }));
    try {
      await runtime.goalService.archive(
        { goalId },
        runtime.createUserWriteContext('archive_goal'),
      );
      router.replace('/goals');
    } catch (error) {
      setState((current) => ({
        ...current,
        busy: false,
        message: userFacingError(error),
      }));
    }
  }

  if (state.goal === null || state.progress === null) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-100 px-8">
        {state.message === null ? (
          <ActivityIndicator color="#047857" />
        ) : (
          <Text className="text-center text-stone-700">{state.message}</Text>
        )}
      </View>
    );
  }

  const progressText =
    state.progress.completionRatio === null
      ? '暂无可汇总任务'
      : `${state.progress.completedTaskCount}/${state.progress.effectiveTaskCount} 已完成 · ${Math.round(state.progress.completionRatio * 100)}%`;

  return (
    <ScrollView
      className="flex-1 bg-stone-100"
      contentContainerClassName="gap-5 px-5 pb-12 pt-5"
    >
      <View className="rounded-3xl bg-emerald-950 p-6">
        <Text className="text-2xl font-semibold text-white">
          {state.goal.title}
        </Text>
        {state.goal.description === '' ? null : (
          <Text className="mt-2 leading-6 text-emerald-100">
            {state.goal.description}
          </Text>
        )}
        <Text className="mt-4 font-medium text-emerald-100">
          {progressText}
        </Text>
        <Text className="mt-1 text-sm text-emerald-200">
          进度只来自关联 Task；取消和分组父任务不进入分母。
        </Text>
      </View>

      <Link
        asChild
        href={{
          pathname: '/(tabs)/capture',
          params: { goalId: state.goal.id },
        }}
      >
        <Pressable
          accessibilityRole="button"
          className="items-center rounded-2xl bg-stone-950 py-4"
        >
          <Text className="font-semibold text-white">从目标拆出任务</Text>
        </Pressable>
      </Link>

      <View className="gap-3 rounded-3xl bg-white p-5">
        <Text className="text-lg font-semibold text-stone-950">新建项目</Text>
        <TextInput
          accessibilityLabel="项目标题"
          className="rounded-2xl border border-stone-300 px-4 py-3 text-stone-950"
          placeholder="项目标题"
          value={projectTitle}
          onChangeText={setProjectTitle}
        />
        <Pressable
          accessibilityRole="button"
          className="items-center rounded-2xl border border-stone-400 py-3"
          disabled={state.busy}
          onPress={() => void createProject()}
        >
          <Text className="font-semibold text-stone-900">创建项目</Text>
        </Pressable>
      </View>

      <Text className="text-xs font-semibold uppercase tracking-widest text-stone-500">
        关联项目
      </Text>
      {state.projects.length === 0 ? (
        <Text className="rounded-2xl bg-white p-4 text-stone-500">
          暂无项目；也可以直接从目标拆出任务。
        </Text>
      ) : (
        state.projects.map((project) => (
          <View
            className="gap-3 rounded-3xl border border-stone-200 bg-white p-5"
            key={project.id}
          >
            <Text className="text-lg font-semibold text-stone-950">
              {project.title}
            </Text>
            <Link
              asChild
              href={{
                pathname: '/(tabs)/capture',
                params: { goalId: state.goal!.id, projectId: project.id },
              }}
            >
              <Pressable
                accessibilityRole="button"
                className="items-center rounded-2xl border border-emerald-700 py-3"
              >
                <Text className="font-semibold text-emerald-900">
                  在此项目添加任务
                </Text>
              </Pressable>
            </Link>
            {confirmArchiveProjectId === project.id ? (
              <View className="gap-2 rounded-2xl bg-amber-50 p-3">
                <Text className="text-amber-900">
                  归档不会删除已有任务或历史。确认归档这个项目？
                </Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={state.busy}
                  onPress={() => void archiveProject(project.id)}
                >
                  <Text className="font-semibold text-amber-950">
                    确认归档项目
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setConfirmArchiveProjectId(null)}
                >
                  <Text className="text-stone-700">保留项目</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={() => setConfirmArchiveProjectId(project.id)}
              >
                <Text className="text-center font-medium text-stone-500">
                  归档项目
                </Text>
              </Pressable>
            )}
          </View>
        ))
      )}
      {state.nextCursor === null ? null : (
        <Pressable
          accessibilityRole="button"
          className="items-center rounded-2xl border border-stone-300 bg-white py-4"
          disabled={state.busy}
          onPress={() => void loadMoreProjects()}
        >
          <Text className="font-semibold text-stone-800">
            {state.busy ? '正在加载…' : '加载更多项目'}
          </Text>
        </Pressable>
      )}

      {state.message === null ? null : (
        <Text className="rounded-2xl bg-amber-50 px-4 py-3 text-amber-900">
          {state.message}
        </Text>
      )}

      {confirmArchiveGoal ? (
        <View className="gap-3 rounded-3xl border border-amber-300 bg-amber-50 p-5">
          <Text className="font-semibold text-amber-950">确认归档目标？</Text>
          <Text className="leading-5 text-amber-900">
            关联项目、任务和完成历史会保留；目标会从进行中列表移除。
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={state.busy}
            onPress={() => void archiveGoal()}
          >
            <Text className="font-semibold text-amber-950">确认归档目标</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => setConfirmArchiveGoal(false)}
          >
            <Text className="text-stone-700">保留目标</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          className="items-center py-3"
          onPress={() => setConfirmArchiveGoal(true)}
        >
          <Text className="font-medium text-amber-800">归档目标</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

export default function GoalDetailScreen() {
  return (
    <RuntimeScreen>
      {(runtime) => <GoalDetail runtime={runtime} />}
    </RuntimeScreen>
  );
}
