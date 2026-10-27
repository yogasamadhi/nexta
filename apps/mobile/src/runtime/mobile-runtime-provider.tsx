import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { setNotificationHandler } from 'expo-notifications';
import { AppState } from 'react-native';

import {
  activeCloudProfile,
  guestDatabaseName,
  activateCloudProfile,
  deactivateCloudProfile,
} from './cloud-profiles';

import { createMobileRuntimeOptions } from './mobile-runtime-config';
import { createMobileRuntime, type MobileRuntime } from './mobile-runtime';

export type MobileRuntimeState =
  | Readonly<{ status: 'initializing'; runtime: null }>
  | Readonly<{ status: 'ready'; runtime: MobileRuntime }>
  | Readonly<{
      status: 'failed';
      runtime: null;
      errorCode: 'runtime_initialization_failed';
      retry(): void;
    }>;

const MobileRuntimeContext = createContext<MobileRuntimeState>({
  status: 'initializing',
  runtime: null,
});

setNotificationHandler({
  handleNotification: () =>
    Promise.resolve({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
});

function isActive(state: string | null | undefined): boolean {
  return state === 'active';
}

export function MobileRuntimeProvider({ children }: PropsWithChildren) {
  const options = useMemo(() => createMobileRuntimeOptions(), []);
  const [state, setState] = useState<MobileRuntimeState>({
    status: 'initializing',
    runtime: null,
  });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setState({ status: 'initializing', runtime: null });
    setAttempt((current) => current + 1);
  }, []);

  useEffect(() => {
    let disposed = false;
    let runtime: MobileRuntime | null = null;
    let cloudSubscription: (() => void) | null = null;
    let appStateSubscription: ReturnType<
      typeof AppState.addEventListener
    > | null = null;

    const open = async () => {
      const profile = await activeCloudProfile();
      const guestName = await guestDatabaseName();
      const baseURL =
        profile?.baseURL ??
        process.env.EXPO_PUBLIC_CLOUD_API_URL ??
        (__DEV__ ? 'http://127.0.0.1:8000' : 'https://cloud.invalid');
      const switchAndReopen = async (action: () => Promise<void>) => {
        if (disposed) throw new Error('Runtime is no longer active.');
        setState({ status: 'initializing', runtime: null });
        try {
          if (runtime) await runtime.close();
          await action();
          setAttempt((current) => current + 1);
        } catch {
          setState({
            status: 'failed',
            runtime: null,
            errorCode: 'runtime_initialization_failed',
            retry,
          });
        }
      };
      return createMobileRuntime({
        ...options,
        databaseName: profile?.databaseName ?? guestName,
        cloud: {
          baseURL,
          profile,
          switchProfile: (tokens) =>
            switchAndReopen(() =>
              activateCloudProfile(baseURL, tokens, guestName),
            ),
          signOut: () => switchAndReopen(deactivateCloudProfile),
        },
      });
    };
    void open()
      .then(async (created) => {
        if (disposed) {
          await created.close();
          return;
        }
        runtime = created;
        cloudSubscription = created.cloudAccount.sync.subscribe(() => {
          if (!disposed) setState({ status: 'ready', runtime: { ...created } });
        });
        appStateSubscription = AppState.addEventListener('change', (next) => {
          void created.setActive(isActive(next)).catch(() => {
            // Durable jobs remain pending and the next foreground transition
            // retries them. UI reads detailed channel state from Application.
          });
        });
        setState({ status: 'ready', runtime: created });
        void created.setActive(isActive(AppState.currentState)).catch(() => {
          // The next foreground event retries the durable queue.
        });
      })
      .catch(() => {
        if (!disposed) {
          setState({
            status: 'failed',
            runtime: null,
            errorCode: 'runtime_initialization_failed',
            retry,
          });
        }
      });

    return () => {
      disposed = true;
      appStateSubscription?.remove();
      cloudSubscription?.();
      if (runtime !== null) {
        void runtime.close();
      }
    };
  }, [attempt, options, retry]);

  return (
    <MobileRuntimeContext.Provider value={state}>
      {children}
    </MobileRuntimeContext.Provider>
  );
}

export function useMobileRuntime(): MobileRuntimeState {
  return useContext(MobileRuntimeContext);
}
