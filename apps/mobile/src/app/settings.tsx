import { Link } from 'expo-router';
import { RuntimeScreen } from '@/components/runtime-screen';
import { shiftLocalDate, userFacingError } from '@/presentation/mobile-format';
import {
  confirmCalendarProvisioningAbsentAndWake,
  requestCalendarPermissionAndWake,
  requestNotificationPermissionAndWake,
} from '@/runtime/integration-user-actions';
import type { MobileRuntime } from '@/runtime/mobile-runtime';
import {
  calendarBusySourcesPreferenceValueSchema,
  checkInEnabledPreferenceValueSchema,
  focusMindfulTransitionEnabledPreferenceValueSchema,
  notificationLeadMinutesPreferenceValueSchema,
  personalizationEnabledPreferenceValueSchema,
  relaxSuggestionsEnabledPreferenceValueSchema,
  schedulingWorkingHoursPreferenceValueSchema,
  type CalendarInfo,
  type CalendarPermissionState,
  type IntegrationState,
  type NotificationPermissionState,
} from '@workspace/application';
import { parseInstant, parseLocalDate } from '@workspace/domain';
import { useCallback, useEffect, useState } from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

function permissionText(status: string) {
  if (status === 'granted') return '已允许';
  if (status === 'not_determined') return '尚未询问';
  if (status === 'denied') return '已拒绝';
  return '设备不可用';
}

function SettingsContent({ runtime }: Readonly<{ runtime: MobileRuntime }>) {
  const [timeZone] = useState(
    () => runtime.temporal.currentTimeZone() as string,
  );
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('18:00');
  const [calendars, setCalendars] = useState<readonly CalendarInfo[]>([]);
  const [knownSources, setKnownSources] = useState<
    readonly Readonly<{ provider: string; calendarId: string }>[]
  >([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [calendarPermission, setCalendarPermission] =
    useState<CalendarPermissionState | null>(null);
  const [notificationPermission, setNotificationPermission] =
    useState<NotificationPermissionState | null>(null);
  const [integrationState, setIntegrationState] =
    useState<IntegrationState | null>(null);
  const [notificationLeadMinutes, setNotificationLeadMinutes] = useState('0');
  const [focusMindfulTransitionEnabled, setFocusMindfulTransitionEnabled] =
    useState(true);
  const [personalizationEnabled, setPersonalizationEnabled] = useState(false);
  const [checkInEnabled, setCheckInEnabled] = useState(true);
  const [relaxSuggestionsEnabled, setRelaxSuggestionsEnabled] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmMissingCalendar, setConfirmMissingCalendar] = useState(false);

  const readExternalState = useCallback(async () => {
    const [calendar, notification, integration] = await Promise.all([
      runtime.calendarService.getPermissionState(),
      runtime.integrationService.getNotificationPermissionState(),
      runtime.integrationService.getCurrentStatus(),
    ]);
    const listed =
      calendar.read.status === 'granted'
        ? await runtime.calendarService.listCalendars()
        : [];
    return { calendar, notification, integration, listed };
  }, [runtime]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      runtime.preferenceService.get('scheduling.workingHours.v1'),
      runtime.preferenceService.get('calendar.busySources.v1'),
      runtime.preferenceService.get('notification.leadMinutes.v1'),
      runtime.preferenceService.get('focus.mindfulTransition.enabled.v1'),
      runtime.preferenceService.get('personalization.enabled.v1'),
      runtime.preferenceService.get('wellbeing.checkIn.enabled.v1'),
      runtime.preferenceService.get('wellbeing.relaxSuggestions.enabled.v1'),
      readExternalState(),
    ])
      .then(
        ([
          hours,
          sources,
          notificationLead,
          focusTransition,
          personalization,
          checkIn,
          relaxSuggestions,
          permissions,
        ]) => {
          if (!active) return;
          setCalendarPermission(permissions.calendar);
          setNotificationPermission(permissions.notification);
          setIntegrationState(permissions.integration);
          setCalendars(permissions.listed);
          const parsedHours =
            schedulingWorkingHoursPreferenceValueSchema.safeParse(
              hours?.valueJson,
            );
          if (parsedHours.success && parsedHours.data.rules[0]) {
            setStart(parsedHours.data.rules[0].startLocalTime);
            setEnd(parsedHours.data.rules[0].endLocalTime);
          }
          const parsedSources =
            calendarBusySourcesPreferenceValueSchema.safeParse(
              sources?.valueJson,
            );
          if (parsedSources.success)
            setKnownSources(parsedSources.data.sources);
          if (parsedSources.success)
            setSelected(
              new Set(
                parsedSources.data.sources
                  .filter((source) => source.enabled)
                  .map(
                    (source) => `${source.provider}\u0000${source.calendarId}`,
                  ),
              ),
            );
          const parsedNotificationLead =
            notificationLeadMinutesPreferenceValueSchema.safeParse(
              notificationLead?.valueJson,
            );
          setNotificationLeadMinutes(
            parsedNotificationLead.success
              ? String(parsedNotificationLead.data.leadMinutes)
              : '0',
          );
          const parsedFocusTransition =
            focusMindfulTransitionEnabledPreferenceValueSchema.safeParse(
              focusTransition?.valueJson,
            );
          setFocusMindfulTransitionEnabled(
            parsedFocusTransition.success
              ? parsedFocusTransition.data.enabled
              : true,
          );
          const parsedPersonalization =
            personalizationEnabledPreferenceValueSchema.safeParse(
              personalization?.valueJson,
            );
          setPersonalizationEnabled(
            parsedPersonalization.success
              ? parsedPersonalization.data.enabled
              : false,
          );
          const parsedCheckIn = checkInEnabledPreferenceValueSchema.safeParse(
            checkIn?.valueJson,
          );
          setCheckInEnabled(
            parsedCheckIn.success ? parsedCheckIn.data.enabled : true,
          );
          const parsedRelax =
            relaxSuggestionsEnabledPreferenceValueSchema.safeParse(
              relaxSuggestions?.valueJson,
            );
          setRelaxSuggestionsEnabled(
            parsedRelax.success ? parsedRelax.data.enabled : true,
          );
        },
      )
      .catch((error) => {
        if (active) setMessage(userFacingError(error));
      });
    return () => {
      active = false;
    };
  }, [readExternalState, runtime]);

  async function requestCalendar(access: 'read' | 'write') {
    setBusy(true);
    setMessage(null);
    try {
      await requestCalendarPermissionAndWake(
        runtime.calendarService,
        runtime.integrations,
        access,
      );
      const permissions = await readExternalState();
      setCalendarPermission(permissions.calendar);
      setNotificationPermission(permissions.notification);
      setIntegrationState(permissions.integration);
      setCalendars(permissions.listed);
    } catch (error) {
      setMessage(userFacingError(error));
    } finally {
      setBusy(false);
    }
  }

  async function requestNotifications() {
    setBusy(true);
    setMessage(null);
    try {
      setNotificationPermission(
        await requestNotificationPermissionAndWake(
          runtime.integrationService,
          runtime.integrations,
        ),
      );
      setIntegrationState(await runtime.integrationService.getCurrentStatus());
    } catch (error) {
      setMessage(userFacingError(error));
    } finally {
      setBusy(false);
    }
  }

  async function confirmCalendarIsMissing() {
    const jobId = integrationState?.calendar.jobId;
    if (
      jobId === null ||
      jobId === undefined ||
      integrationState?.calendar.status !== 'reconciliation_required' ||
      integrationState.calendar.lastErrorCode !==
        'calendar_provisioning_unknown'
    ) {
      setConfirmMissingCalendar(false);
      setMessage('待核对状态已经变化，请刷新后再检查。');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await confirmCalendarProvisioningAbsentAndWake(
        runtime.integrationService,
        runtime.integrations,
        jobId,
        runtime.createUserWriteContext('confirm_calendar_missing'),
      );
      setConfirmMissingCalendar(false);
      setIntegrationState(await runtime.integrationService.getCurrentStatus());
      setMessage(
        result.requeuedJobCount > 0
          ? '已释放待核对记录并重新尝试同步；本地计划始终保留。'
          : '已保存核对结果；当前没有需要重新排队的同步作业。',
      );
    } catch (error) {
      setMessage(userFacingError(error));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const normalizedLead = notificationLeadMinutes.trim();
      const parsedLead = notificationLeadMinutesPreferenceValueSchema.safeParse(
        {
          leadMinutes: /^\d+$/.test(normalizedLead)
            ? Number(normalizedLead)
            : Number.NaN,
        },
      );
      if (!parsedLead.success) {
        setMessage('提醒提前量必须是 0–1440 之间的整数分钟。');
        return;
      }
      await runtime.preferenceService.update(
        { key: 'scheduling.timeZone.v1', value: { timeZone } },
        runtime.createUserWriteContext('save_timezone'),
      );
      await runtime.preferenceService.update(
        {
          key: 'scheduling.workingHours.v1',
          value: {
            timeZone,
            rules: [
              {
                id: 'weekday-default',
                weekdays: [1, 2, 3, 4, 5],
                startLocalTime: start,
                endLocalTime: end,
                energyLevel: null,
              },
            ],
          },
        },
        runtime.createUserWriteContext('save_working_hours'),
      );
      const sources = new Map(
        knownSources.map((source) => [
          `${source.provider}\u0000${source.calendarId}`,
          source,
        ]),
      );
      for (const calendar of calendars) {
        sources.set(`${calendar.provider}\u0000${calendar.calendarId}`, {
          provider: calendar.provider,
          calendarId: calendar.calendarId,
        });
      }
      await runtime.preferenceService.update(
        {
          key: 'calendar.busySources.v1',
          value: {
            sources: [...sources.values()].map((source) => ({
              ...source,
              enabled: selected.has(
                `${source.provider}\u0000${source.calendarId}`,
              ),
            })),
          },
        },
        runtime.createUserWriteContext('save_busy_sources'),
      );
      await runtime.preferenceService.update(
        {
          key: 'notification.leadMinutes.v1',
          value: parsedLead.data,
        },
        runtime.createUserWriteContext('save_notification_lead'),
      );
      await runtime.preferenceService.update(
        {
          key: 'focus.mindfulTransition.enabled.v1',
          value: { enabled: focusMindfulTransitionEnabled },
        },
        runtime.createUserWriteContext('save_focus_transition'),
      );
      await runtime.preferenceService.update(
        {
          key: 'personalization.enabled.v1',
          value: { enabled: personalizationEnabled },
        },
        runtime.createUserWriteContext('save_personalization'),
      );
      await runtime.preferenceService.update(
        {
          key: 'wellbeing.checkIn.enabled.v1',
          value: { enabled: checkInEnabled },
        },
        runtime.createUserWriteContext('save_check_in'),
      );
      await runtime.preferenceService.update(
        {
          key: 'wellbeing.relaxSuggestions.enabled.v1',
          value: { enabled: relaxSuggestionsEnabled },
        },
        runtime.createUserWriteContext('save_relax_suggestions'),
      );
      const selectedCalendars = calendars.filter((calendar) =>
        selected.has(`${calendar.provider}\u0000${calendar.calendarId}`),
      );
      if (
        selectedCalendars.length > 0 &&
        calendarPermission?.read.status === 'granted'
      ) {
        const local = runtime.temporal.resolve(
          parseInstant(new Date().toISOString()),
        );
        const first = runtime.temporal.dayRange({
          localDate: local.localDate,
          timeZone: local.timeZone,
        });
        const last = runtime.temporal.dayRange({
          localDate: parseLocalDate(shiftLocalDate(local.localDate, 29)),
          timeZone: local.timeZone,
        });
        const refreshes = await Promise.allSettled(
          selectedCalendars.map((calendar) =>
            runtime.calendarService.refreshBusy({
              provider: calendar.provider,
              calendarId: calendar.calendarId,
              range: { start: first.start, end: last.end },
            }),
          ),
        );
        const failed = refreshes.filter(
          (result) => result.status === 'rejected',
        ).length;
        setMessage(
          failed === 0
            ? `排程设置已保存，并刷新 ${refreshes.length} 个日历。`
            : `排程设置已保存；${failed} 个日历暂未刷新，可稍后重试。`,
        );
      } else {
        setMessage(
          selected.size === 0
            ? '已保存：仅使用本地计划，不读取系统日历。'
            : '排程设置已保存；获得读取权限后可刷新忙碌时间。',
        );
      }
    } catch (error) {
      setMessage(userFacingError(error));
    } finally {
      setBusy(false);
    }
  }

  function toggle(calendar: CalendarInfo) {
    const key = `${calendar.provider}\u0000${calendar.calendarId}`;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const calendarStatus = calendarPermission?.read.status ?? 'not_determined';
  return (
    <ScrollView
      className="flex-1 bg-stone-100"
      contentContainerClassName="gap-6 px-5 pb-12 pt-5"
    >
      <Link
        href="/account"
        className="mb-4 rounded-2xl bg-white p-4 text-lg text-emerald-800"
      >
        账号、云端同步与设备提醒
      </Link>
      <View className="rounded-3xl bg-white p-5">
        <Text className="text-xl font-semibold text-stone-950">排程边界</Text>
        <Text className="mt-2 leading-6 text-stone-500">
          时区 {timeZone}。工作时间允许跨午夜；当前界面使用周一至周五。
        </Text>
        <View className="mt-4 flex-row gap-3">
          <TextInput
            accessibilityLabel="工作开始时间"
            testID="settings-work-start"
            className="flex-1 rounded-2xl border border-stone-300 px-4 py-3 text-stone-950"
            value={start}
            onChangeText={setStart}
            placeholder="09:00"
          />
          <TextInput
            accessibilityLabel="工作结束时间"
            testID="settings-work-end"
            className="flex-1 rounded-2xl border border-stone-300 px-4 py-3 text-stone-950"
            value={end}
            onChangeText={setEnd}
            placeholder="18:00"
          />
        </View>
      </View>
      <View className="rounded-3xl bg-white p-5">
        <Text className="text-xl font-semibold text-stone-950">系统日历</Text>
        <Text className="mt-2 leading-6 text-stone-500">
          用于避开已占用时间。只有点击下方按钮才会触发系统权限框；拒绝后仍可离线规划。
        </Text>
        <Text className="mt-3 font-medium text-stone-700">
          读取权限：{permissionText(calendarStatus)}
        </Text>
        {calendarPermission?.read.settingsRequired ? (
          <Pressable
            accessibilityRole="button"
            className="mt-3 min-h-12 justify-center self-start rounded-xl bg-stone-200 px-4 py-2"
            onPress={() => void Linking.openSettings()}
          >
            <Text>前往系统设置</Text>
          </Pressable>
        ) : calendarStatus !== 'granted' ? (
          <Pressable
            accessibilityRole="button"
            className="mt-3 min-h-12 justify-center self-start rounded-xl bg-stone-950 px-4 py-2"
            disabled={busy}
            onPress={() => void requestCalendar('read')}
          >
            <Text className="text-white">允许读取日历</Text>
          </Pressable>
        ) : null}
        <Text className="mt-3 font-medium text-stone-700">
          写入 App 计划日历：
          {permissionText(calendarPermission?.write.status ?? 'not_determined')}
        </Text>
        {calendarPermission?.write.settingsRequired ? (
          <Pressable
            accessibilityRole="button"
            className="mt-3 min-h-12 justify-center self-start rounded-xl bg-stone-200 px-4 py-2"
            onPress={() => void Linking.openSettings()}
          >
            <Text>前往系统设置</Text>
          </Pressable>
        ) : calendarPermission?.write.status !== 'granted' ? (
          <Pressable
            accessibilityRole="button"
            className="mt-3 min-h-12 justify-center self-start rounded-xl border border-stone-400 px-4 py-2"
            disabled={busy}
            onPress={() => void requestCalendar('write')}
          >
            <Text className="text-stone-900">允许写入计划日历</Text>
          </Pressable>
        ) : null}
        <View className="mt-4 gap-2">
          {calendars
            .filter((calendar) => calendar.allowsRead)
            .map((calendar) => {
              const key = `${calendar.provider}\u0000${calendar.calendarId}`;
              const enabled = selected.has(key);
              return (
                <Pressable
                  key={key}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: enabled }}
                  className={`rounded-2xl border px-4 py-3 ${enabled ? 'border-emerald-600 bg-emerald-50' : 'border-stone-200'}`}
                  onPress={() => toggle(calendar)}
                >
                  <Text className="font-medium text-stone-900">
                    {enabled ? '✓ ' : ''}
                    {calendar.title}
                  </Text>
                </Pressable>
              );
            })}
        </View>
        {integrationState?.calendar.status === 'reconciliation_required' ? (
          <View className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-4">
            <Text className="font-semibold text-amber-950">
              日历同步结果需要核对
            </Text>
            <Text className="mt-2 leading-5 text-amber-900">
              计划已经保存在本机。请先打开系统 Calendar，检查是否已经存在由本
              App 创建的计划日历或事件；不要通过重复保存计划来重试。
            </Text>
            {integrationState.calendar.lastErrorCode ===
              'calendar_provisioning_unknown' &&
            integrationState.calendar.jobId !== null ? (
              confirmMissingCalendar ? (
                <View className="mt-4 gap-3">
                  <Text className="leading-5 text-amber-950">
                    只有在你确认系统 Calendar 中确实不存在该 App
                    的计划日历后，才继续。系统会释放这次不确定写入并重新创建；如果已经存在或无法确认，请保留待核对状态。
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    className="items-center rounded-xl bg-amber-900 px-4 py-3"
                    disabled={busy}
                    onPress={() => void confirmCalendarIsMissing()}
                  >
                    <Text className="font-semibold text-white">
                      确认不存在并重新尝试
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    className="items-center rounded-xl border border-amber-500 px-4 py-3"
                    disabled={busy}
                    onPress={() => setConfirmMissingCalendar(false)}
                  >
                    <Text className="font-semibold text-amber-950">
                      保留待核对状态
                    </Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  className="mt-4 items-center rounded-xl border border-amber-600 px-4 py-3"
                  disabled={busy}
                  onPress={() => setConfirmMissingCalendar(true)}
                >
                  <Text className="font-semibold text-amber-950">
                    我已检查系统 Calendar
                  </Text>
                </Pressable>
              )
            ) : (
              <Text className="mt-3 text-sm leading-5 text-amber-900">
                当前冲突不能自动解除；请保留该状态，并从日历或计划预览核对差异。
              </Text>
            )}
          </View>
        ) : null}
      </View>
      <View className="rounded-3xl bg-white p-5">
        <Text className="text-xl font-semibold text-stone-950">专注过渡</Text>
        <Text className="mt-2 leading-6 text-stone-500">
          新建专注后可先显示 10
          秒低干扰过渡；可以立即跳过。恢复已有专注或从放松返回时不会重复显示。
        </Text>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: focusMindfulTransitionEnabled }}
          className={`mt-4 rounded-2xl border px-4 py-3 ${focusMindfulTransitionEnabled ? 'border-emerald-600 bg-emerald-50' : 'border-stone-300'}`}
          onPress={() =>
            setFocusMindfulTransitionEnabled((current) => !current)
          }
        >
          <Text className="font-medium text-stone-900">
            {focusMindfulTransitionEnabled ? '✓ ' : ''}新建专注时显示 10 秒过渡
          </Text>
        </Pressable>
      </View>
      <View className="rounded-3xl bg-white p-5">
        <Text className="text-xl font-semibold text-stone-950">个性化排程</Text>
        <Text className="mt-2 leading-6 text-stone-500">
          只使用本机的真实执行统计，不生成性格或心理标签。统计窗口、阈值与权重仍待产品评审，当前不会影响排程。
        </Text>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: personalizationEnabled }}
          className={`mt-4 rounded-2xl border px-4 py-3 ${personalizationEnabled ? 'border-amber-600 bg-amber-50' : 'border-emerald-700 bg-emerald-50'}`}
          onPress={() => {
            if (personalizationEnabled) setPersonalizationEnabled(false);
            else
              setMessage('个性化仍保持关闭；完成统计规则评审后才会开放启用。');
          }}
        >
          <Text className="font-medium text-stone-900">
            {personalizationEnabled ? '关闭个性化排程' : '个性化排程已关闭'}
          </Text>
        </Pressable>
      </View>
      <View className="rounded-3xl bg-white p-5">
        <Text className="text-xl font-semibold text-stone-950">提醒</Text>
        <Text className="mt-2 leading-6 text-stone-500">
          提醒只投影未来的计划时间块，默认不在锁屏显示任务详情且不播放声音。修改提前量后，已有计划的提醒会重新核对。
        </Text>
        <Text className="mt-4 font-medium text-stone-700">
          提前分钟数（0–1440）
        </Text>
        <TextInput
          accessibilityLabel="提醒提前分钟数"
          className="mt-2 rounded-2xl border border-stone-300 px-4 py-3 text-stone-950"
          inputMode="numeric"
          value={notificationLeadMinutes}
          onChangeText={setNotificationLeadMinutes}
          placeholder="0"
        />
        <Text className="mt-3 font-medium text-stone-700">
          通知权限：
          {permissionText(notificationPermission?.status ?? 'not_determined')}
        </Text>
        {notificationPermission?.settingsRequired ? (
          <Pressable
            accessibilityRole="button"
            className="mt-3 min-h-12 justify-center self-start rounded-xl bg-stone-200 px-4 py-2"
            onPress={() => void Linking.openSettings()}
          >
            <Text>前往系统设置</Text>
          </Pressable>
        ) : notificationPermission?.status !== 'granted' ? (
          <Pressable
            accessibilityRole="button"
            className="mt-3 min-h-12 justify-center self-start rounded-xl bg-stone-950 px-4 py-2"
            disabled={busy}
            onPress={() => void requestNotifications()}
          >
            <Text className="text-white">允许发送提醒</Text>
          </Pressable>
        ) : null}
      </View>
      <View className="rounded-3xl bg-white p-5">
        <Text className="text-xl font-semibold text-stone-950">可持续节奏</Text>
        <Text className="mt-2 leading-6 text-stone-500">
          精力记录与短时放松都是可选的行为信息，不代表医疗或心理状态，也不会阻止你使用任务和专注功能。
        </Text>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: checkInEnabled }}
          className={`mt-4 rounded-2xl border px-4 py-3 ${checkInEnabled ? 'border-emerald-600 bg-emerald-50' : 'border-stone-300'}`}
          onPress={() => setCheckInEnabled((current) => !current)}
        >
          <Text className="font-medium text-stone-900">
            {checkInEnabled ? '✓ ' : ''}在今天页显示可选精力记录
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: relaxSuggestionsEnabled }}
          className={`mt-3 rounded-2xl border px-4 py-3 ${relaxSuggestionsEnabled ? 'border-emerald-600 bg-emerald-50' : 'border-stone-300'}`}
          onPress={() => setRelaxSuggestionsEnabled((current) => !current)}
        >
          <Text className="font-medium text-stone-900">
            {relaxSuggestionsEnabled ? '✓ ' : ''}显示可选的短时放松入口
          </Text>
        </Pressable>
      </View>
      {message === null ? null : (
        <Text className="rounded-2xl bg-emerald-50 px-4 py-3 leading-5 text-emerald-900">
          {message}
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        className="items-center rounded-2xl bg-stone-950 py-4"
        disabled={busy}
        onPress={() => void save()}
        testID="settings-save"
      >
        <Text className="font-semibold text-white">
          {busy ? '处理中…' : '保存设置'}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

export default function SettingsScreen() {
  return (
    <RuntimeScreen>
      {(runtime) => <SettingsContent runtime={runtime} />}
    </RuntimeScreen>
  );
}
