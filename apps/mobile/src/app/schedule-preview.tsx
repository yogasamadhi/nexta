import { RuntimeScreen } from '@/components/runtime-screen';
import {
  busyCompletenessLabel,
  formatDatedRange,
  previewChangeReasonLabel,
  previewDeadlineLabel,
  previewBlockTypeLabel,
  schedulePreviewSummary,
  scheduleWarningLabel,
  unscheduledReasonLabel,
  userFacingError,
} from '@/presentation/mobile-format';
import type { MobileRuntime } from '@/runtime/mobile-runtime';
import type { SchedulePreview } from '@workspace/application';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';

function PreviewContent({ runtime }: Readonly<{ runtime: MobileRuntime }>) {
  const router = useRouter();
  const parameters = useLocalSearchParams<{ previewId?: string | string[] }>();
  const previewId =
    typeof parameters.previewId === 'string' ? parameters.previewId : '';
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);

  useEffect(() => {
    let active = true;
    void runtime.scheduleService
      .getPreview(previewId)
      .then((value) => {
        if (active) setPreview(value);
      })
      .catch((error) => {
        if (active) setMessage(userFacingError(error));
      });
    return () => {
      active = false;
    };
  }, [previewId, runtime]);

  async function commit() {
    if (preview === null) return;
    setCommitting(true);
    setMessage(null);
    try {
      const result = await runtime.scheduleService.commit(
        {
          previewId: preview.previewId,
          expectedStateVersion: preview.basedOnStateVersion,
        },
        runtime.createUserWriteContext('commit_schedule'),
      );
      const suffix =
        result.calendar === 'synced' && result.notifications === 'synced'
          ? '计划已提交并同步。'
          : '计划已保存到本机；系统日历或提醒仍在处理。';
      router.replace({ pathname: '/(tabs)/today', params: { notice: suffix } });
    } catch (error) {
      setMessage(userFacingError(error));
    } finally {
      setCommitting(false);
    }
  }

  if (preview === null && message === null)
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color="#047857" />
      </View>
    );
  if (preview === null)
    return (
      <View className="flex-1 items-center justify-center bg-stone-100 px-8">
        <Text className="text-center leading-6 text-stone-700">{message}</Text>
        <Pressable
          className="mt-5 rounded-2xl bg-stone-950 px-5 py-3"
          onPress={() => router.back()}
        >
          <Text className="font-semibold text-white">返回重新预览</Text>
        </Pressable>
      </View>
    );

  const blocking =
    preview.riskAssessment.hasBlockingWarnings ||
    preview.changedBlocks.length === 0;
  return (
    <ScrollView
      className="flex-1 bg-stone-100"
      contentContainerClassName="gap-5 px-5 pb-12 pt-5"
    >
      <View className="rounded-3xl bg-white p-5">
        <Text className="text-2xl font-semibold text-stone-950">
          {schedulePreviewSummary(preview.changedBlocks)}
        </Text>
        <Text className="mt-2 text-sm text-stone-500">
          有效至 {new Date(preview.expiresAt).toLocaleTimeString('zh-CN')} ·
          版本 {preview.basedOnStateVersion}
        </Text>
        <Text className="mt-2 text-sm text-stone-500">
          调度时区：{preview.timeZone}
        </Text>
        <Text className="mt-2 text-sm text-stone-500">
          忙碌数据：
          {busyCompletenessLabel(preview.busyFreshness.completeness)}
          {preview.busyFreshness.capturedAt
            ? ` · ${new Date(preview.busyFreshness.capturedAt).toLocaleString('zh-CN')}`
            : ''}
        </Text>
        <Text className="mt-2 text-sm text-stone-700">
          截止时间：{previewDeadlineLabel(preview.warnings)}
        </Text>
        <Text className="mt-2 text-xs leading-5 text-stone-500">
          已完成、正在执行和已锁定的时间块不会由此预览移动。
        </Text>
      </View>
      <View className="gap-3">
        <Text className="text-xs font-semibold uppercase tracking-widest text-stone-500">
          变更
        </Text>
        {preview.changedBlocks.map((change) => (
          <View
            key={change.stableKey}
            className="rounded-2xl border border-stone-200 bg-white p-4"
          >
            <Text className="font-semibold text-stone-900">
              {change.after.taskTitle ??
                previewBlockTypeLabel(change.after.type)}
            </Text>
            <Text className="mt-1 text-xs font-semibold text-stone-500">
              {change.kind === 'create'
                ? '新增'
                : change.kind === 'update'
                  ? '调整'
                  : '取消'}{' '}
              · {previewBlockTypeLabel(change.after.type)}
            </Text>
            {change.kind === 'update' ? (
              <>
                <Text className="mt-2 text-stone-500">
                  原来：
                  {formatDatedRange(
                    change.before.startAt,
                    change.before.endAt,
                    preview.timeZone,
                  )}
                </Text>
                <Text className="mt-1 text-stone-700">
                  调整后：
                  {formatDatedRange(
                    change.after.startAt,
                    change.after.endAt,
                    preview.timeZone,
                  )}
                </Text>
              </>
            ) : (
              <Text className="mt-2 text-stone-700">
                {change.kind === 'cancel' ? '将取消：' : '安排：'}
                {formatDatedRange(
                  change.kind === 'cancel'
                    ? change.before.startAt
                    : change.after.startAt,
                  change.kind === 'cancel'
                    ? change.before.endAt
                    : change.after.endAt,
                  preview.timeZone,
                )}
              </Text>
            )}
            <Text className="mt-2 text-sm leading-5 text-stone-500">
              {previewChangeReasonLabel(change.after.changeReason)}
            </Text>
          </View>
        ))}
      </View>
      {preview.unscheduled.length === 0 ? null : (
        <View className="rounded-2xl bg-amber-50 p-4">
          <Text className="font-semibold text-amber-950">未能安排</Text>
          {preview.unscheduled.map((item) => (
            <View key={item.taskId} className="mt-3 gap-1">
              <Text className="text-amber-900">
                {item.taskTitle}：
                {unscheduledReasonLabel(item.reasonCode, item.remainingMinutes)}
              </Text>
              <Link
                asChild
                href={{
                  pathname: '/task/[taskId]',
                  params: { taskId: item.taskId },
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  className="self-start py-2"
                >
                  <Text className="font-semibold text-amber-950">
                    编辑任务并重新预览 →
                  </Text>
                </Pressable>
              </Link>
            </View>
          ))}
        </View>
      )}
      {preview.warnings.length === 0 ? null : (
        <View className="rounded-2xl bg-amber-50 p-4">
          <Text className="font-semibold text-amber-950">需要留意</Text>
          {preview.warnings.map((item, index) => (
            <Text key={`${item.code}-${index}`} className="mt-2 text-amber-900">
              {item.entityTitle === null ? '' : `${item.entityTitle}：`}
              {scheduleWarningLabel(item.code)}
            </Text>
          ))}
        </View>
      )}
      {message === null ? null : (
        <Text className="rounded-2xl bg-red-50 px-4 py-3 text-red-900">
          {message}
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        className={`items-center rounded-2xl py-4 ${blocking ? 'bg-stone-300' : 'bg-stone-950'}`}
        disabled={blocking || committing}
        onPress={() => void commit()}
        testID="preview-commit"
      >
        <Text className="font-semibold text-white">
          {committing
            ? '正在提交…'
            : blocking
              ? '当前预览不可提交'
              : '确认并提交计划'}
        </Text>
      </Pressable>
      <Text className="text-center text-xs leading-5 text-stone-500">
        只有点击确认才会修改本地计划；日历与提醒失败不会撤销本地提交。
      </Text>
    </ScrollView>
  );
}

export default function SchedulePreviewScreen() {
  return (
    <RuntimeScreen>
      {(runtime) => <PreviewContent runtime={runtime} />}
    </RuntimeScreen>
  );
}
