import { Platform } from 'react-native';

import { createMobileIntegrationProjectionPolicy } from './integration-policy';
import type { MobileRuntimeOptions } from './mobile-runtime';

const dayMs = 24 * 60 * 60 * 1_000;

/**
 * Replaceable DEC-012 pre-decision baseline. Every externally visible or
 * privacy-sensitive value is spelled out here so the adapters invent none.
 */
export function createMobileRuntimeOptions(): MobileRuntimeOptions {
  return {
    databaseName: 'execution-agent.sqlite',
    calendar: {
      provider: 'expo-calendar',
      ownershipMarkerNamespace: 'execution-agent.calendar-event.v1',
      maximumQuerySpanMs: 32 * dayMs,
      requiresExplicitAndroidSource: Platform.OS === 'android',
    },
    notifications: {
      ownershipMarkerNamespace: 'execution-agent.notification.v1',
      permissionRequest: {
        allowAlert: true,
        allowBadge: false,
        allowSound: false,
      },
      androidChannel:
        Platform.OS === 'android'
          ? {
              id: 'planned-blocks-v1',
              name: '计划提醒',
              description: '在已安排的专注时间开始时提醒',
              importance: 5,
              sound: null,
            }
          : null,
    },
    projectionPolicy: createMobileIntegrationProjectionPolicy({
      calendar: {
        provider: 'expo-calendar',
        ownershipKey: 'execution-agent.app-calendar.v1',
        title: '个人计划',
        color: null,
        androidSource: null,
        exposeTaskTitle: false,
        genericEventTitle: '专注时间',
      },
      notification: {
        enabled: true,
        leadMinutes: 0,
        type: 'time_block_start',
        exposeTaskTitle: false,
        genericTitle: '接下来是专注时间',
        body: null,
      },
    }),
    maximumCalendarRefreshSpanMs: 32 * dayMs,
    calendarInventoryLookbackMs: dayMs,
    calendarInventoryLookaheadMs: 31 * dayMs,
    integrationLeaseMs: 2 * 60 * 1_000,
    retryBaseDelayMs: 30 * 1_000,
    retryMaximumDelayMs: 15 * 60 * 1_000,
    providerCallTimeoutMs: 15 * 1_000,
    scheduling: {
      policyVersion: 'predecision-neutral-v1',
      gridAnchor: '1970-01-01T00:00:00.000Z',
      defaultHorizonMs: 7 * dayMs,
      maximumHorizonMs: 32 * dayMs,
      previewTtlMs: 15 * 60 * 1_000,
      granularityMinutes: 15,
      defaultMinBlockMinutes: 15,
      defaultMaxBlockMinutes: 120,
    },
  };
}
