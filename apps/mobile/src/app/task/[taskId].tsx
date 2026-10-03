import { RuntimeScreen } from '@/components/runtime-screen';
import { TaskConstraintFields } from '@/components/task-constraint-fields';
import {
  emptyTaskConstraintDraft,
  hasDateOnlyDeadline,
  parseTaskConstraintDraft,
  taskConstraintDraftFromTask,
  TaskConstraintDraftError,
  type TaskConstraintDraft,
} from '@/presentation/task-constraints';
import {
  formatMinuteEstimate,
  persistedTaskPreviewError,
  userFacingError,
} from '@/presentation/mobile-format';
import type { MobileRuntime } from '@/runtime/mobile-runtime';
import type { Task } from '@workspace/domain';
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

function TaskEditor({ runtime }: Readonly<{ runtime: MobileRuntime }>) {
  const router = useRouter();
  const parameters = useLocalSearchParams<{ taskId?: string | string[] }>();
  const taskId = typeof parameters.taskId === 'string' ? parameters.taskId : '';
  const [task, setTask] = useState<Task | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [estimatedDuration, setEstimatedDuration] = useState('');
  const [remainingDuration, setRemainingDuration] = useState('');
  const [constraints, setConstraints] = useState<TaskConstraintDraft>(
    emptyTaskConstraintDraft,
  );
  const [allEffortRecorded, setAllEffortRecorded] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const terminal = task?.status === 'completed' || task?.status === 'canceled';

  useEffect(() => {
    let active = true;
    void runtime.taskService
      .get(taskId)
      .then((value) => {
        if (!active) return;
        setTask(value);
        setTitle(value.title);
        setDescription(value.description ?? '');
        setEstimatedDuration(value.estimatedDurationMinutes?.toString() ?? '');
        setRemainingDuration(value.remainingDurationMinutes?.toString() ?? '');
        setConstraints(taskConstraintDraftFromTask(value, runtime.temporal));
      })
      .catch((error) => {
        if (active) setMessage(userFacingError(error));
      });
    return () => {
      active = false;
    };
  }, [runtime, taskId]);

  async function save(schedule: boolean) {
    if (task === null || terminal || title.trim() === '') return;
    const estimatedMinutes =
      estimatedDuration.trim() === '' ? null : Number(estimatedDuration);
    if (
      estimatedMinutes !== null &&
      (!Number.isFinite(estimatedMinutes) || estimatedMinutes <= 0)
    ) {
      setMessage('预计总时长必须是大于 0 的分钟数。');
      return;
    }
    const remainingMinutes =
      remainingDuration.trim() === '' ? null : Number(remainingDuration);
    if (
      remainingMinutes !== null &&
      (!Number.isFinite(remainingMinutes) || remainingMinutes <= 0)
    ) {
      setMessage('剩余估时必须是大于 0 的分钟数，或留空使用派生值。');
      return;
    }
    let parsedConstraints;
    try {
      parsedConstraints = parseTaskConstraintDraft(
        constraints,
        runtime.temporal,
      );
    } catch (error) {
      setMessage(
        error instanceof TaskConstraintDraftError
          ? error.message
          : '排程约束输入有误，请检查后重试。',
      );
      return;
    }
    if (schedule && hasDateOnlyDeadline(parsedConstraints)) {
      setMessage('只有日期的截止已保留原意，但生成排程前请补充具体截止时间。');
      return;
    }
    setBusy(true);
    setMessage(null);
    let taskPersisted = false;
    try {
      const result = await runtime.taskService.update(
        {
          taskId: task.id,
          patch: {
            title: title.trim(),
            description: description.trim() || null,
            estimatedDurationMinutes: estimatedMinutes,
            remainingDurationMinutes: remainingMinutes,
            ...parsedConstraints,
          },
        },
        runtime.createUserWriteContext('edit_task'),
      );
      taskPersisted = true;
      setTask(result.task);
      if (
        schedule &&
        (estimatedMinutes !== null || remainingMinutes !== null)
      ) {
        const preview = await runtime.scheduleService.replan({
          reason: 'manual_task_edit',
          taskIds: [task.id],
        });
        router.replace({
          pathname: '/schedule-preview',
          params: { previewId: preview.previewId },
        });
      } else router.back();
    } catch (error) {
      setMessage(
        taskPersisted
          ? persistedTaskPreviewError(error, 'updated')
          : userFacingError(error),
      );
    } finally {
      setBusy(false);
    }
  }

  async function startFocus() {
    if (task === null || terminal) return;
    setBusy(true);
    setMessage(null);
    try {
      const active = await runtime.executionService.getActive();
      const transitionRequested = active === null;
      const session =
        active?.session ??
        (
          await runtime.executionService.start(
            { taskId: task.id },
            runtime.createUserWriteContext('start_task_focus'),
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
      setMessage(userFacingError(error));
    } finally {
      setBusy(false);
    }
  }

  async function complete(recordAchievement: boolean) {
    if (task === null || task.status === 'canceled') return;
    setBusy(true);
    setMessage(null);
    try {
      await runtime.taskService.complete(
        {
          taskId: task.id,
          recordAchievement,
          ...(task.status === 'completed' ? {} : { allEffortRecorded }),
        },
        runtime.createUserWriteContext(
          recordAchievement ? 'complete_task_with_win' : 'complete_task',
        ),
      );
      router.replace(recordAchievement ? '/(tabs)/wins' : '/(tabs)/today');
    } catch (error) {
      setMessage(userFacingError(error));
    } finally {
      setBusy(false);
    }
  }

  async function cancelCurrentTask() {
    if (task === null || terminal) return;
    setBusy(true);
    setMessage(null);
    try {
      await runtime.taskService.cancel(
        { taskId: task.id },
        runtime.createUserWriteContext('cancel_task'),
      );
      router.replace('/(tabs)/today');
    } catch (error) {
      setMessage(userFacingError(error));
      setConfirmingCancel(false);
    } finally {
      setBusy(false);
    }
  }

  if (task === null && message === null)
    return <ActivityIndicator className="mt-20" color="#047857" />;
  return (
    <ScrollView
      className="flex-1 bg-stone-100"
      contentContainerClassName="gap-5 px-5 pb-12 pt-5"
    >
      <Text className="text-sm text-stone-500">
        {task?.status ?? '无法读取'}
      </Text>
      <TextInput
        accessibilityLabel="任务标题"
        className="rounded-2xl border border-stone-300 bg-white px-4 py-4 text-base text-stone-950"
        value={title}
        onChangeText={setTitle}
        editable={!terminal}
      />
      <TextInput
        accessibilityLabel="任务说明"
        multiline
        textAlignVertical="top"
        className="min-h-28 rounded-2xl border border-stone-300 bg-white px-4 py-4 text-base text-stone-950"
        value={description}
        onChangeText={setDescription}
        editable={!terminal}
      />
      <TextInput
        accessibilityLabel="预计总分钟"
        inputMode="numeric"
        className="rounded-2xl border border-stone-300 bg-white px-4 py-4 text-base text-stone-950"
        placeholder="预计总分钟（可留空）"
        value={estimatedDuration}
        onChangeText={setEstimatedDuration}
        editable={!terminal}
      />
      <View className="gap-2">
        <Text className="text-sm leading-5 text-stone-500">
          已记录实际投入：
          {task?.actualDurationMinutes === null || task === null
            ? '未知'
            : formatMinuteEstimate(task.actualDurationMinutes)}
        </Text>
        <TextInput
          accessibilityLabel="显式剩余分钟"
          inputMode="numeric"
          className="rounded-2xl border border-stone-300 bg-white px-4 py-4 text-base text-stone-950"
          placeholder="剩余分钟覆盖（可选）"
          value={remainingDuration}
          onChangeText={setRemainingDuration}
          editable={!terminal}
        />
        <Text className="text-xs leading-5 text-stone-500">
          留空时由预计总时长减去可信实际投入；原估时已用完但任务未完成时，请填写新的剩余估时。
        </Text>
      </View>
      <TaskConstraintFields
        disabled={busy || task === null || terminal}
        draft={constraints}
        onChange={setConstraints}
      />
      {message === null ? null : (
        <Text className="rounded-2xl bg-amber-50 px-4 py-3 text-amber-900">
          {message}
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        className="items-center rounded-2xl bg-stone-950 py-4"
        disabled={busy || task === null || terminal}
        onPress={() => void save(false)}
      >
        <Text className="font-semibold text-white">保存</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        className="items-center rounded-2xl border border-stone-400 py-4"
        disabled={
          busy ||
          task === null ||
          terminal ||
          (estimatedDuration.trim() === '' && remainingDuration.trim() === '')
        }
        onPress={() => void save(true)}
      >
        <Text className="font-semibold text-stone-900">保存并重新排程</Text>
      </Pressable>
      {task === null || task.status === 'canceled' ? null : task.status ===
        'completed' ? (
        <Pressable
          accessibilityRole="button"
          className="items-center rounded-2xl border border-emerald-700 bg-emerald-50 py-4"
          disabled={busy}
          onPress={() => void complete(true)}
        >
          <Text className="font-semibold text-emerald-900">记录到成就</Text>
        </Pressable>
      ) : (
        <>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: allEffortRecorded }}
            className={`rounded-2xl border px-4 py-3 ${allEffortRecorded ? 'border-emerald-700 bg-emerald-50' : 'border-stone-300 bg-white'}`}
            disabled={busy}
            onPress={() => setAllEffortRecorded((current) => !current)}
          >
            <Text className="font-medium text-stone-900">
              {allEffortRecorded ? '✓ ' : ''}全部实际投入都已被计时记录
            </Text>
            <Text className="mt-1 text-sm leading-5 text-stone-500">
              仅在确实没有漏记工作时勾选；否则统计会保留为部分或未知。
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            className="items-center rounded-2xl bg-emerald-700 py-4"
            disabled={busy}
            onPress={() => void startFocus()}
            testID="task-start-focus"
          >
            <Text className="font-semibold text-white">开始专注</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            className="items-center rounded-2xl border border-emerald-700 bg-emerald-50 py-4"
            disabled={busy}
            onPress={() => void complete(true)}
          >
            <Text className="font-semibold text-emerald-900">
              完成整个任务并记录成就
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            className="items-center rounded-2xl border border-stone-300 py-4"
            disabled={busy}
            onPress={() => void complete(false)}
          >
            <Text className="font-semibold text-stone-700">
              完成任务，但不记录成就
            </Text>
          </Pressable>
        </>
      )}
      {task === null || terminal ? null : confirmingCancel ? (
        <View className="gap-3 rounded-2xl border border-red-300 bg-red-50 p-4">
          <Text className="font-semibold text-red-950">确认取消这个任务？</Text>
          <Text className="leading-5 text-red-800">
            当前专注会结束，关联的未完成时间块会取消，并重新核对日历与提醒；不会生成完成记录或成就。
          </Text>
          <Pressable
            accessibilityRole="button"
            className="items-center rounded-2xl bg-red-700 py-4"
            disabled={busy}
            onPress={() => void cancelCurrentTask()}
          >
            <Text className="font-semibold text-white">确认取消任务</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            className="items-center py-2"
            disabled={busy}
            onPress={() => setConfirmingCancel(false)}
          >
            <Text className="font-medium text-stone-700">保留任务</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          className="items-center py-3"
          disabled={busy}
          onPress={() => setConfirmingCancel(true)}
        >
          <Text className="font-medium text-red-700">取消任务</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

export default function TaskScreen() {
  return (
    <RuntimeScreen>
      {(runtime) => <TaskEditor runtime={runtime} />}
    </RuntimeScreen>
  );
}
