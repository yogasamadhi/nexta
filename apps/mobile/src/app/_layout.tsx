import { Stack } from 'expo-router';
import { StatusBar } from 'react-native';

import '../global.css';

import { GluestackUIProvider } from '../components/ui/gluestack-ui-provider';
import { MobileRuntimeProvider } from '../runtime/mobile-runtime-provider';

export default function RootLayout() {
  return (
    <GluestackUIProvider mode="system">
      <MobileRuntimeProvider>
        <StatusBar barStyle="dark-content" />
        <Stack
          screenOptions={{
            headerBackTitle: '返回',
            headerShadowVisible: false,
            headerStyle: { backgroundColor: '#f5f5f4' },
            statusBarStyle: 'dark',
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="account" options={{ title: '账号与同步' }} />
          <Stack.Screen
            name="sync-conflicts"
            options={{ title: '核对同步冲突' }}
          />
          <Stack.Screen name="settings" options={{ title: '设置' }} />
          <Stack.Screen name="inbox" options={{ title: '任务收件箱' }} />
          <Stack.Screen name="goals" options={{ title: '目标' }} />
          <Stack.Screen name="goal/[goalId]" options={{ title: '目标详情' }} />
          <Stack.Screen name="reflection" options={{ title: '今日复盘' }} />
          <Stack.Screen
            name="schedule-preview"
            options={{ title: '排程预览' }}
          />
          <Stack.Screen name="task/[taskId]" options={{ title: '编辑任务' }} />
          <Stack.Screen
            name="focus/[sessionId]"
            options={{
              title: '专注',
              headerShown: false,
              statusBarStyle: 'light',
            }}
          />
          <Stack.Screen
            name="achievement/[achievementId]"
            options={{ title: '成就详情' }}
          />
          <Stack.Screen
            name="time-block/[timeBlockId]"
            options={{ title: '调整时间块' }}
          />
        </Stack>
      </MobileRuntimeProvider>
    </GluestackUIProvider>
  );
}
