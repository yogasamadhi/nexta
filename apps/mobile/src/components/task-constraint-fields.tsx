import type { TaskConstraintDraft } from '@/presentation/task-constraints';
import { Pressable, Text, TextInput, View } from 'react-native';

type Props = Readonly<{
  draft: TaskConstraintDraft;
  disabled: boolean;
  onChange: (draft: TaskConstraintDraft) => void;
}>;

export function TaskConstraintFields({ draft, disabled, onChange }: Props) {
  const update = <Key extends keyof TaskConstraintDraft>(
    key: Key,
    value: TaskConstraintDraft[Key],
  ) => onChange({ ...draft, [key]: value });

  return (
    <View className="gap-4 rounded-3xl bg-white p-5">
      <View>
        <Text className="text-lg font-semibold text-stone-950">排程约束</Text>
        <Text className="mt-1 leading-5 text-stone-500">
          日期按设备时区解释。只有日期的截止会保留原意；补充时间后才作为精确硬截止排程。
        </Text>
      </View>

      <View className="gap-2">
        <Text className="font-medium text-stone-700">最早开始（可选）</Text>
        <View className="flex-row gap-3">
          <TextInput
            accessibilityLabel="最早开始日期"
            autoCapitalize="none"
            autoCorrect={false}
            className="flex-1 rounded-2xl border border-stone-300 px-4 py-3 text-stone-950"
            editable={!disabled}
            placeholder="YYYY-MM-DD"
            spellCheck={false}
            value={draft.earliestDate}
            onChangeText={(value) => update('earliestDate', value)}
          />
          <TextInput
            accessibilityLabel="最早开始时间"
            autoCapitalize="none"
            autoCorrect={false}
            className="w-28 rounded-2xl border border-stone-300 px-4 py-3 text-stone-950"
            editable={!disabled}
            placeholder="HH:MM"
            spellCheck={false}
            value={draft.earliestTime}
            onChangeText={(value) => update('earliestTime', value)}
          />
        </View>
      </View>

      <View className="gap-2">
        <Text className="font-medium text-stone-700">截止（可选）</Text>
        <View className="flex-row gap-3">
          <TextInput
            accessibilityLabel="截止日期"
            autoCapitalize="none"
            autoCorrect={false}
            className="flex-1 rounded-2xl border border-stone-300 px-4 py-3 text-stone-950"
            editable={!disabled}
            placeholder="YYYY-MM-DD"
            spellCheck={false}
            value={draft.deadlineDate}
            onChangeText={(value) => update('deadlineDate', value)}
          />
          <TextInput
            accessibilityLabel="截止时间"
            autoCapitalize="none"
            autoCorrect={false}
            className="w-28 rounded-2xl border border-stone-300 px-4 py-3 text-stone-950"
            editable={!disabled}
            placeholder="可留空"
            spellCheck={false}
            value={draft.deadlineTime}
            onChangeText={(value) => update('deadlineTime', value)}
          />
        </View>
      </View>

      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: draft.splittable }}
        className={`rounded-2xl border px-4 py-3 ${draft.splittable ? 'border-emerald-700 bg-emerald-50' : 'border-stone-300'}`}
        disabled={disabled}
        onPress={() => update('splittable', !draft.splittable)}
      >
        <Text className="font-medium text-stone-900">
          {draft.splittable ? '✓ ' : ''}允许拆成多个时间块
        </Text>
        <Text className="mt-1 text-sm text-stone-500">
          当前默认关闭；是否改为产品默认仍待 DEC-011。
        </Text>
      </Pressable>

      <View className="flex-row gap-3">
        <View className="flex-1 gap-2">
          <Text className="font-medium text-stone-700">最短块分钟</Text>
          <TextInput
            accessibilityLabel="最短时间块分钟"
            className="rounded-2xl border border-stone-300 px-4 py-3 text-stone-950"
            editable={!disabled}
            inputMode="numeric"
            placeholder="可留空"
            value={draft.minBlockMinutes}
            onChangeText={(value) => update('minBlockMinutes', value)}
          />
        </View>
        <View className="flex-1 gap-2">
          <Text className="font-medium text-stone-700">最长块分钟</Text>
          <TextInput
            accessibilityLabel="最长时间块分钟"
            className="rounded-2xl border border-stone-300 px-4 py-3 text-stone-950"
            editable={!disabled}
            inputMode="numeric"
            placeholder="可留空"
            value={draft.maxBlockMinutes}
            onChangeText={(value) => update('maxBlockMinutes', value)}
          />
        </View>
      </View>

      <View className="gap-2">
        <Text className="font-medium text-stone-700">任务分类（可选）</Text>
        <TextInput
          accessibilityLabel="任务分类"
          className="rounded-2xl border border-stone-300 px-4 py-3 text-stone-950"
          editable={!disabled}
          placeholder="例如：写作"
          value={draft.categoryKey}
          onChangeText={(value) => update('categoryKey', value)}
        />
      </View>

      <View className="gap-2">
        <Text className="font-medium text-stone-700">精力需求（可选）</Text>
        <TextInput
          accessibilityLabel="任务精力需求"
          className="rounded-2xl border border-stone-300 px-4 py-3 text-stone-950"
          editable={!disabled}
          placeholder="当前仅保存，不启用未评审权重"
          value={draft.energyDemand}
          onChangeText={(value) => update('energyDemand', value)}
        />
      </View>
    </View>
  );
}
