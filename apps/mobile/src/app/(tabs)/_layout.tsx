import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function TabGlyph({ children }: Readonly<{ children: string }>) {
  return <Text className="text-lg">{children}</Text>;
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#047857',
        tabBarInactiveTintColor: '#78716c',
        tabBarStyle: {
          height: 68 + insets.bottom,
          paddingBottom: Math.max(insets.bottom, 8),
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 12 },
      }}
    >
      <Tabs.Screen
        name="today"
        options={{
          title: '今天',
          tabBarButtonTestID: 'tab-today',
          tabBarIcon: () => <TabGlyph>●</TabGlyph>,
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: '日历',
          tabBarButtonTestID: 'tab-calendar',
          tabBarIcon: () => <TabGlyph>▦</TabGlyph>,
        }}
      />
      <Tabs.Screen
        name="capture"
        options={{
          title: '添加',
          tabBarButtonTestID: 'tab-capture',
          tabBarIcon: () => <TabGlyph>＋</TabGlyph>,
        }}
      />
      <Tabs.Screen
        name="wins"
        options={{
          title: '成就',
          tabBarButtonTestID: 'tab-wins',
          tabBarIcon: () => <TabGlyph>✓</TabGlyph>,
        }}
      />
      <Tabs.Screen
        name="relax"
        options={{
          title: '放松',
          tabBarButtonTestID: 'tab-relax',
          tabBarIcon: () => <TabGlyph>◌</TabGlyph>,
        }}
      />
    </Tabs>
  );
}
