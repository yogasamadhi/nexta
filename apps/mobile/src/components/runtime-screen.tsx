import type { MobileRuntime } from '@/runtime/mobile-runtime';
import { useMobileRuntime } from '@/runtime/mobile-runtime-provider';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export function RuntimeScreen({
  children,
}: Readonly<{ children: (runtime: MobileRuntime) => ReactNode }>) {
  const state = useMobileRuntime();

  if (state.status === 'initializing') {
    return (
      <SafeAreaView
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f5f5f4',
          paddingHorizontal: 32,
        }}
      >
        <ActivityIndicator color="#047857" />
        <Text className="mt-4 text-base text-stone-600">正在打开本地计划…</Text>
      </SafeAreaView>
    );
  }

  if (state.status === 'failed') {
    return (
      <SafeAreaView
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f5f5f4',
          paddingHorizontal: 32,
        }}
      >
        <Text className="text-center text-2xl font-semibold text-stone-950">
          本地数据暂时无法打开
        </Text>
        <Text className="mt-3 text-center text-base leading-6 text-stone-600">
          计划没有被发送到云端。请重试打开设备上的本地数据库。
        </Text>
        <Pressable
          accessibilityRole="button"
          className="mt-6 rounded-2xl bg-stone-950 px-6 py-3"
          onPress={state.retry}
        >
          <Text className="font-semibold text-white">重试</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return <View className="flex-1 bg-stone-100">{children(state.runtime)}</View>;
}
