import { RuntimeScreen } from '@/components/runtime-screen';
import { TaskConstraintFields } from '@/components/task-constraint-fields';
import {
  emptyTaskConstraintDraft,
  hasDateOnlyDeadline,
  parseTaskConstraintDraft,
  TaskConstraintDraftError,
  type TaskConstraintDraft,
} from '@/presentation/task-constraints';
import {
  persistedTaskPreviewError,
  userFacingError,
} from '@/presentation/mobile-format';
import type { MobileRuntime } from '@/runtime/mobile-runtime';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

function positiveMinutes(raw: string): number | null {
  if (raw.trim() === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error('duration');
  return value;
}

function CaptureContent({ runtime }: Readonly<{ runtime: MobileRuntime }>) {
  const router = useRouter();
  const parameters = useLocalSearchParams<{
    goalId?: string | string[];
    projectId?: string | string[];
  }>();
  const goalId =
    typeof parameters.goalId === 'string' ? parameters.goalId : undefined;
  const projectId =
    typeof parameters.projectId === 'string' ? parameters.projectId : undefined;
  const [naturalInput, setNaturalInput] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [duration, setDuration] = useState('');
  const [constraints, setConstraints] = useState<TaskConstraintDraft>(
    emptyTaskConstraintDraft,
  );
  const [savedTaskId, setSavedTaskId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const continueManually = useCallback(() => {
    const preserved = naturalInput.trim();
    if (preserved === '') {
      setMessage('请先输入想记录的任务、目标或想法。');
      return;
    }
    setTitle(preserved);
    setMessage(
      'AI 尚未配置，原文已保留并转入手工确认。日期、截止时间和时长不会被猜测。',
    );
  }, [naturalInput]);

  const openPreview = useCallback(
    async (taskId: string) => {
      const preview = await runtime.scheduleService.preview({
        reason: 'manual_capture',
        taskIds: [taskId],
      });
      router.push({
        pathname: '/schedule-preview',
        params: { previewId: preview.previewId },
      });
    },
    [router, runtime],
  );

  const submit = useCallback(async () => {
    if (title.trim() === '') {
      setMessage('请先填写任务标题。');
      return;
    }
    let minutes: number | null;
    let parsedConstraints;
    try {
      minutes = positiveMinutes(duration);
      parsedConstraints = parseTaskConstraintDraft(
        constraints,
        runtime.temporal,
      );
      if (minutes !== null && hasDateOnlyDeadline(parsedConstraints)) {
        setMessage(
          '只有日期的截止已保留原意，但生成排程前请补充具体截止时间。',
        );
        return;
      }
    } catch (error) {
      if (error instanceof TaskConstraintDraftError) {
        setMessage(error.message);
        return;
      }
      setMessage('预计时长必须是大于 0 的分钟数。');
      return;
    }
    setBusy(true);
    setMessage(null);
    let taskPersisted = savedTaskId !== null;
    try {
      let taskId = savedTaskId;
      if (taskId === null) {
        const result = await runtime.taskService.create(
          {
            title: title.trim(),
            description: description.trim() || null,
            estimatedDurationMinutes: minutes,
            remainingDurationMinutes: minutes,
            ...parsedConstraints,
            ...(goalId === undefined ? {} : { goalId }),
            ...(projectId === undefined ? {} : { projectId }),
          },
          runtime.createUserWriteContext('capture_task'),
        );
        taskId = result.task.id;
        taskPersisted = true;
        setSavedTaskId(taskId);
      }
      if (minutes === null) {
        setNaturalInput('');
        setTitle('');
        setDescription('');
        setDuration('');
        setConstraints(emptyTaskConstraintDraft());
        setSavedTaskId(null);
        router.replace('/(tabs)/today');
      } else {
        await openPreview(taskId);
      }
    } catch (error) {
      setMessage(
        taskPersisted
          ? persistedTaskPreviewError(error, 'created')
          : userFacingError(error),
      );
    } finally {
      setBusy(false);
    }
  }, [
    constraints,
    description,
    duration,
    openPreview,
    goalId,
    projectId,
    router,
    runtime,
    savedTaskId,
    title,
  ]);

  return (
    <SafeAreaView className="flex-1" edges={['top']}>
      <ScrollView contentContainerClassName="gap-5 px-5 pb-12 pt-6">
        <View>
          <Text className="text-4xl font-semibold text-stone-950">
            添加任务
          </Text>
          <Text className="mt-2 leading-6 text-stone-500">
            可以先写一句自然语言；手工创建始终离线可用。没有估时的任务会先进入
            inbox。
          </Text>
        </View>
        <View className="gap-3 rounded-3xl bg-stone-100 p-4">
          <View>
            <Text className="font-semibold text-stone-900">自然语言记录</Text>
            <Text className="mt-1 text-sm leading-5 text-stone-500">
              AI 未配置 · 当前会完整保留原文，再由你确认结构化字段。
            </Text>
          </View>
          <TextInput
            accessibilityLabel="自然语言任务输入"
            className="min-h-24 rounded-2xl border border-stone-300 bg-white px-4 py-4 text-base text-stone-950"
            editable={savedTaskId === null}
            multiline
            placeholder="例如：下周五前把方案写完，大概 3 个小时"
            textAlignVertical="top"
            value={naturalInput}
            onChangeText={setNaturalInput}
          />
          <Pressable
            accessibilityRole="button"
            className="items-center rounded-2xl border border-stone-400 bg-white py-3"
            disabled={busy || savedTaskId !== null}
            onPress={continueManually}
          >
            <Text className="font-semibold text-stone-800">转入手工确认</Text>
          </Pressable>
        </View>
        <Text className="text-xs font-semibold uppercase tracking-widest text-stone-400">
          结构化预览
        </Text>
        {goalId === undefined && projectId === undefined ? null : (
          <View className="rounded-2xl bg-emerald-50 px-4 py-3">
            <Text className="font-medium text-emerald-900">
              新任务会关联到刚才选择的
              {projectId === undefined ? '目标' : '项目'}。
            </Text>
          </View>
        )}
        <View className="gap-2">
          <Text className="font-medium text-stone-700">标题</Text>
          <TextInput
            accessibilityLabel="任务标题"
            className="rounded-2xl border border-stone-300 bg-white px-4 py-4 text-base text-stone-950"
            editable={savedTaskId === null}
            placeholder="例如：整理周会方案"
            value={title}
            onChangeText={setTitle}
          />
        </View>
        <View className="gap-2">
          <Text className="font-medium text-stone-700">说明（可选）</Text>
          <TextInput
            accessibilityLabel="任务说明"
            className="min-h-28 rounded-2xl border border-stone-300 bg-white px-4 py-4 text-base text-stone-950"
            editable={savedTaskId === null}
            multiline
            textAlignVertical="top"
            value={description}
            onChangeText={setDescription}
          />
        </View>
        <View className="gap-2">
          <Text className="font-medium text-stone-700">预计分钟（可选）</Text>
          <TextInput
            accessibilityLabel="预计分钟"
            className="rounded-2xl border border-stone-300 bg-white px-4 py-4 text-base text-stone-950"
            editable={savedTaskId === null}
            inputMode="numeric"
            placeholder="例如 45"
            value={duration}
            onChangeText={setDuration}
          />
        </View>
        <TaskConstraintFields
          disabled={busy || savedTaskId !== null}
          draft={constraints}
          onChange={setConstraints}
        />
        {message === null ? null : (
          <Text className="rounded-2xl bg-amber-50 px-4 py-3 leading-5 text-amber-900">
            {message}
          </Text>
        )}
        <Pressable
          accessibilityRole="button"
          className="items-center rounded-2xl bg-stone-950 py-4"
          disabled={busy}
          onPress={() => void submit()}
        >
          <Text className="font-semibold text-white">
            {busy
              ? '正在保存…'
              : savedTaskId !== null
                ? '重新生成排程预览'
                : duration.trim() === ''
                  ? '保存到 inbox'
                  : '保存并查看排程'}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

export default function CaptureScreen() {
  return (
    <RuntimeScreen>
      {(runtime) => <CaptureContent runtime={runtime} />}
    </RuntimeScreen>
  );
}
