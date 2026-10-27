import { RuntimeScreen } from '@/components/runtime-screen';
import type { MobileRuntime } from '@/runtime/mobile-runtime';
import type {
  CloudConflict,
  CloudEntity,
  SyncKind,
} from '@workspace/application';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
const kindLabels: Record<SyncKind, string> = {
  operation_provenance: '操作来源',
  goal: '目标',
  project: '项目',
  task: '任务',
  time_block: '时间块',
  execution_session: '专注记录',
  execution_interval: '执行区间',
  completion_record: '完成证据',
  achievement: '成就',
  task_activity: '任务活动',
  reflection: '复盘',
  energy_check_in: '精力记录',
  relax_session: '放松记录',
  preference: '偏好',
  plan_origin: '来源计划',
};
const fieldLabels: Record<string, string> = {
  title: '标题',
  description: '说明',
  status: '状态',
  priority: '优先级',
  startAt: '开始时间',
  endAt: '结束时间',
  startedAt: '开始时间',
  endedAt: '结束时间',
  completedAt: '完成时间',
  canceledAt: '取消时间',
  estimatedDurationMinutes: '预计分钟',
  remainingDurationMinutes: '剩余分钟',
  actualDurationMinutes: '投入分钟',
  note: '备注',
  notes: '备注',
  wins: '完成亮点',
  valueJson: '偏好值',
  updatedAt: '修改时间',
  createdAt: '创建时间',
};
function displayValue(value: unknown): string {
  if (value === undefined) return '尚无共享记录';
  if (value === null || value === '') return '未设置';
  if (typeof value === 'boolean') return value ? '是' : '否';
  return typeof value === 'string' ? value : JSON.stringify(value);
}
function FactDifference({
  local,
  remote,
}: {
  local: CloudEntity;
  remote: CloudEntity | undefined;
}) {
  const fields = Object.keys(local.value).filter(
    (name) =>
      JSON.stringify(local.value[name]) !== JSON.stringify(remote?.value[name]),
  );
  return (
    <View className="gap-2 rounded-2xl bg-stone-50 p-3">
      <Text className="font-semibold">
        {kindLabels[local.kind]} ·{' '}
        {String(
          local.value.title ?? local.value.taskTitleSnapshot ?? local.key,
        )}
      </Text>
      {fields.length === 0 ? (
        <Text>内容相同，版本已发生变化。</Text>
      ) : (
        fields.map((name) => (
          <View key={name} className="gap-1">
            <Text className="text-sm font-semibold">
              {fieldLabels[name] ?? name}
            </Text>
            <Text selectable className="text-stone-700">
              本地：{displayValue(local.value[name])}
            </Text>
            <Text selectable className="text-emerald-900">
              云端：{displayValue(remote?.value[name])}
            </Text>
          </View>
        ))
      )}
    </View>
  );
}
function ConflictsContent({ runtime }: { runtime: MobileRuntime }) {
  const [items, setItems] = useState<readonly CloudConflict[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{
    id: string;
    choice: 'local' | 'cloud';
  } | null>(null);
  const sync = runtime.cloudAccount.sync;
  useEffect(() => {
    let active = true;
    const load = () => {
      void sync
        .conflicts()
        .then((rows) => {
          if (active) setItems(rows);
        })
        .catch(() => {
          if (active) setMessage('暂时无法读取冲突。');
        });
    };
    load();
    const unsubscribe = sync.subscribe(load);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [sync]);
  async function resolve() {
    if (!confirm) return;
    setBusy(true);
    try {
      await sync.resolve(confirm.id, confirm.choice);
      setItems(await sync.conflicts());
      setMessage('已记录核对结果；未采用的修改保留在冲突档案。');
      setConfirm(null);
    } catch {
      setMessage(
        '暂未解决。云端可能又有变化，或这次修改涉及不可覆盖的完成和执行事实。双方记录仍保留。',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <ScrollView
      className="flex-1 bg-stone-100"
      contentContainerClassName="gap-5 px-5 py-6 pb-16"
    >
      <Text className="text-3xl font-semibold">核对同步冲突</Text>
      <Text className="leading-6 text-stone-600">
        同一份事实在多个设备发生变化，需要你核对。不会按设备时间静默覆盖完成记录，也不会把另一台设备的计时转到这里。
      </Text>
      {items.length === 0 ? (
        <Text className="p-5">没有需要核对的冲突。</Text>
      ) : null}
      {items.map((item) => (
        <View key={item.id} className="gap-3 rounded-3xl bg-white p-5">
          <Text className="font-semibold">
            {item.status === 'open' ? '待核对' : '已归档'} ·{' '}
            {item.local.changes.length} 项本地变更
          </Text>
          {item.local.changes.map((e) => (
            <FactDifference
              key={`${e.kind}:${e.key}`}
              local={e}
              remote={item.remote.find(
                (r) => r.kind === e.kind && r.key === e.key,
              )}
            />
          ))}
          <Text className="text-sm text-stone-500">
            云端：{item.remote.length}{' '}
            项关联事实。选择云端主线会保留本地分支档案；保留本地修改仍需通过版本、执行归属和完成证据校验。
          </Text>
          {item.status === 'open' ? (
            <>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => setConfirm({ id: item.id, choice: 'cloud' })}
                className="rounded-2xl border border-stone-400 p-3"
              >
                <Text>选择云端主线，归档本地分支</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => setConfirm({ id: item.id, choice: 'local' })}
                className="rounded-2xl border border-emerald-700 p-3"
              >
                <Text>按最新版本提交本地修改</Text>
              </Pressable>
            </>
          ) : null}
        </View>
      ))}
      {confirm ? (
        <View className="gap-3 rounded-3xl bg-amber-50 p-5">
          <Text>
            确认
            {confirm.choice === 'cloud'
              ? '选择云端主线并归档本地修改'
              : '重新提交这批本地修改'}
            ？
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void resolve()}
            className="rounded-2xl bg-stone-950 p-4"
          >
            <Text className="text-white">确认核对结果</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => setConfirm(null)}
          >
            <Text>返回继续查看</Text>
          </Pressable>
        </View>
      ) : null}
      {message ? (
        <Text accessibilityRole="alert" className="p-4 text-amber-900">
          {message}
        </Text>
      ) : null}
    </ScrollView>
  );
}
export default function ConflictsScreen() {
  return (
    <RuntimeScreen>
      {(runtime) => <ConflictsContent runtime={runtime} />}
    </RuntimeScreen>
  );
}
