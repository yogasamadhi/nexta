import { Tabs } from 'expo-router';
import { Text } from 'react-native';

function TabGlyph({ children }: Readonly<{ children: string }>) {
  return <Text className="text-lg">{children}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#047857',
        tabBarInactiveTintColor: '#78716c',
        tabBarStyle: { height: 68, paddingBottom: 8, paddingTop: 6 },
        tabBarLabelStyle: { fontSize: 12 },
      }}
    >
      <Tabs.Screen
        name="today"
        options={{
          title: '今天',
          tabBarIcon: () => <TabGlyph>●</TabGlyph>,
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: '日历',
          tabBarIcon: () => <TabGlyph>▦</TabGlyph>,
        }}
      />
      <Tabs.Screen
        name="capture"
        options={{
          title: '添加',
          tabBarIcon: () => <TabGlyph>＋</TabGlyph>,
        }}
      />
      <Tabs.Screen
        name="wins"
        options={{
          title: '成就',
          tabBarIcon: () => <TabGlyph>✓</TabGlyph>,
        }}
      />
      <Tabs.Screen
        name="relax"
        options={{
          title: '放松',
          tabBarIcon: () => <TabGlyph>◌</TabGlyph>,
        }}
      />
    </Tabs>
  );
}
