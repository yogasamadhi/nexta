import type { ConfigContext, ExpoConfig } from 'expo/config';

const variants = ['development', 'preview', 'production'] as const;
type AppVariant = (typeof variants)[number];

export const APP_VERSION = '0.1.0';
export const IOS_BUILD_NUMBER = '1';
export const ANDROID_VERSION_CODE = 1;

export function resolveAppVariant(requestedVariant?: string): AppVariant {
  if (requestedVariant === undefined) {
    return 'development';
  }

  if (!variants.includes(requestedVariant as AppVariant)) {
    throw new Error(
      `Unsupported APP_VARIANT "${requestedVariant}". Expected one of: ${variants.join(', ')}.`,
    );
  }

  return requestedVariant as AppVariant;
}

export function createAppConfig(
  config: ConfigContext['config'],
  requestedVariant?: string,
): ExpoConfig {
  const variant = resolveAppVariant(requestedVariant);
  const suffix = variant === 'production' ? '' : `.${variant}`;
  const displaySuffix = variant === 'production' ? '' : ` (${variant})`;

  return {
    ...config,
    name: `Execution Agent${displaySuffix}`,
    slug: 'personal-execution-agent',
    version: APP_VERSION,
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: `execution-agent${variant === 'production' ? '' : `-${variant}`}`,
    userInterfaceStyle: 'automatic',
    extra: {
      environment: variant,
    },
    updates: {
      enabled: false,
    },
    ios: {
      bundleIdentifier: `com.personalexecution.agent${suffix}`,
      buildNumber: IOS_BUILD_NUMBER,
      icon: './assets/expo.icon',
      infoPlist: {
        NSCalendarsFullAccessUsageDescription:
          'Read busy times and maintain events created by this app after you grant access.',
      },
    },
    android: {
      package: `com.personalexecution.agent${suffix}`,
      versionCode: ANDROID_VERSION_CODE,
      adaptiveIcon: {
        backgroundColor: '#F2EEE6',
        foregroundImage: './assets/images/android-icon-foreground.png',
        backgroundImage: './assets/images/android-icon-background.png',
        monochromeImage: './assets/images/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
    },
    plugins: [
      'expo-router',
      'expo-dev-client',
      ['expo-build-properties', { ios: { enableSceneSupport: true } }],
      'expo-sqlite',
      'expo-secure-store',
      'expo-notifications',
      'expo-background-task',
      [
        'expo-splash-screen',
        {
          backgroundColor: '#F2EEE6',
          image: './assets/images/splash-icon.png',
          imageWidth: 76,
        },
      ],
    ],
    experiments: {
      reactCompiler: true,
      typedRoutes: true,
    },
  };
}

export default ({ config }: ConfigContext): ExpoConfig =>
  createAppConfig(config, process.env.APP_VARIANT);
