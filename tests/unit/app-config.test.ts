import { describe, expect, it } from 'vitest';

import {
  ANDROID_VERSION_CODE,
  APP_VERSION,
  IOS_BUILD_NUMBER,
  createAppConfig,
  resolveAppVariant,
} from '../../apps/mobile/app.config';

describe('resolveAppVariant', () => {
  it.each(['development', 'preview', 'production'] as const)(
    'accepts the %s build variant',
    (variant) => {
      expect(resolveAppVariant(variant)).toBe(variant);
    },
  );

  it('defaults an unset variant to development', () => {
    expect(resolveAppVariant()).toBe('development');
  });

  it('rejects an unknown build variant', () => {
    expect(() => resolveAppVariant('staging')).toThrowError(
      /Unsupported APP_VARIANT/,
    );
  });

  it('rejects an explicitly empty build variant', () => {
    expect(() => resolveAppVariant('')).toThrowError(/Unsupported APP_VARIANT/);
  });

  it.each(['development', 'preview', 'production'] as const)(
    'resolves a versioned, OTA-disabled %s store configuration',
    (variant) => {
      const config = createAppConfig({}, variant);

      expect(config).toMatchObject({
        version: APP_VERSION,
        extra: { environment: variant },
        updates: { enabled: false },
        ios: {
          buildNumber: IOS_BUILD_NUMBER,
          infoPlist: { UIViewControllerBasedStatusBarAppearance: true },
        },
        android: { versionCode: ANDROID_VERSION_CODE },
      });
      // Expo SDK 58 ships the UIKit scene life cycle by default, so the
      // deprecated `ios.enableSceneSupport` build property must stay absent.
      expect(JSON.stringify(config.plugins ?? [])).not.toContain(
        'enableSceneSupport',
      );
    },
  );

  it('uses distinct install identities for all variants', () => {
    const configs = ['development', 'preview', 'production'].map((variant) =>
      createAppConfig({}, variant),
    );
    expect(
      new Set(configs.flatMap((config) => [config.ios?.bundleIdentifier])).size,
    ).toBe(3);
    expect(
      new Set(configs.flatMap((config) => [config.android?.package])).size,
    ).toBe(3);
  });
});
