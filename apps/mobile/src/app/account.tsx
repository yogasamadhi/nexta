import { RuntimeScreen } from '@/components/runtime-screen';
import type { MobileRuntime } from '@/runtime/mobile-runtime';
import { CloudError, type CloudLocalState } from '@workspace/application';
import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
const labels = {
  local: '仅在本地保存',
  idle: '同步已就绪',
  syncing: '正在同步',
  offline: '网络暂不可用，本地修改已保留',
  authentication: '登录已失效，请重新登录',
  conflict: '有修改需要核对',
  failed: '同步暂未完成，请重试',
};
function AccountContent({ runtime }: { runtime: MobileRuntime }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [state, setState] = useState<CloudLocalState | null>(null);
  const [, render] = useState(0);
  const account = runtime.cloudAccount;
  useEffect(() => {
    let live = true;
    const refresh = () => {
      if (live) {
        render((n) => n + 1);
        void account.local
          .state()
          .then((s) => {
            if (live) setState(s);
          })
          .catch(() => {
            if (live) setMessage('暂时无法读取同步状态。');
          });
      }
    };
    refresh();
    const unsubscribe = account.sync.subscribe(refresh);
    return () => {
      live = false;
      unsubscribe();
    };
  }, [account]);
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await work();
      setState(await account.local.state());
    } catch (e) {
      setMessage(
        e instanceof CloudError && e.code === 'credential_storage'
          ? '此开发构建无法安全保存登录凭据。请使用具备 Keychain 权限的 Development Build；本地功能仍然可用。'
          : e instanceof CloudError && e.code === 'authentication'
            ? '邮箱或密码不正确，或登录已失效。'
            : '暂未完成操作；本地数据仍然保留，请检查网络后重试。',
      );
    } finally {
      setBusy(false);
      setPassword('');
    }
  }
  return (
    <ScrollView
      className="flex-1 bg-stone-100"
      contentContainerClassName="gap-5 px-5 py-6 pb-16"
    >
      <Text className="text-3xl font-semibold text-stone-950">账号与同步</Text>
      <Text testID="cloud-sync-status" className="leading-6 text-stone-600">
        {labels[account.sync.status]}
      </Text>
      {state?.userId ? (
        <View className="gap-4 rounded-3xl bg-white p-5">
          <Text className="font-semibold">已关联账号</Text>
          <Text>
            待上传 {state.pending} 批 · 待核对 {state.conflicts} 项
          </Text>
          <Text className="text-stone-500">
            离线操作仍保存在本机。同步只在应用前台运行。
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void action(() => account.sync.wake())}
            className="rounded-2xl bg-emerald-800 p-4"
          >
            <Text className="text-center text-white">立即同步</Text>
          </Pressable>
          <Link href="/sync-conflicts" className="p-3 text-emerald-800">
            核对同步冲突与保留的分支
          </Link>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: state.projectionEnabled }}
            disabled={busy}
            onPress={() =>
              void action(() => account.setProjection(!state.projectionEnabled))
            }
            className="rounded-2xl border border-stone-300 p-4"
          >
            <Text>
              {state.projectionEnabled ? '关闭' : '开启'}
              此设备的系统日历与提醒投影
            </Text>
          </Pressable>
          <Text className="text-sm leading-5 text-stone-500">
            每台设备独立授权。多台同时开启可能各自提醒；不会复制其他设备的日历身份。
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            testID="account-sign-out"
            onPress={() => void action(() => account.logout())}
            className="p-4"
          >
            <Text className="text-center text-stone-700">
              退出账号，保留此账号本地资料
            </Text>
          </Pressable>
        </View>
      ) : null}
      <View className="gap-4 rounded-3xl bg-white p-5">
        <Text className="text-xl font-semibold">
          {register ? '内部测试注册' : '登录或切换账号'}
        </Text>
        <TextInput
          testID="account-email"
          accessibilityLabel="邮箱"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          placeholder="邮箱"
          editable={!busy}
          className="rounded-2xl border border-stone-300 p-4"
        />
        <TextInput
          testID="account-password"
          accessibilityLabel="密码"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          placeholder="密码（至少 12 个字符）"
          editable={!busy}
          className="rounded-2xl border border-stone-300 p-4"
        />
        <Text className="text-sm leading-6 text-stone-600">
          登录后将自动上传并同步本资料空间的目标、项目、任务、时间块、执行与完成记录、成就、复盘（包括备注）、精力、放松及可移植偏好。系统日历缓存、OS
          绑定、密钥和本地操作收据不会上传。当前为内部测试，尚无邮箱验证和密码找回；云端数据没有端到端加密。
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={busy || password.length < 12 || !email.trim()}
          onPress={() =>
            void action(() => account.login(email, password, register))
          }
          className="rounded-2xl bg-stone-950 p-4"
        >
          <Text className="text-center font-semibold text-white">
            {busy ? '处理中…' : register ? '注册并同步' : '登录并同步'}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          testID="account-toggle-registration"
          onPress={() => setRegister(!register)}
          className="p-3"
        >
          <Text className="text-center text-emerald-800">
            {register ? '使用已有账号' : '创建内部测试账号'}
          </Text>
        </Pressable>
      </View>
      {message ? (
        <Text
          accessibilityRole="alert"
          className="rounded-2xl bg-amber-50 p-4 text-amber-900"
        >
          {message}
        </Text>
      ) : null}
    </ScrollView>
  );
}
export default function AccountScreen() {
  return (
    <RuntimeScreen>
      {(runtime) => <AccountContent runtime={runtime} />}
    </RuntimeScreen>
  );
}
