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
import { AppState, type AppStateStatus } from 'react-native';

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

function isActive(state: AppStateStatus): boolean {
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
    let appStateSubscription: ReturnType<
      typeof AppState.addEventListener
    > | null = null;

    void createMobileRuntime(options)
      .then(async (created) => {
        if (disposed) {
          await created.close();
          return;
        }
        runtime = created;
        appStateSubscription = AppState.addEventListener('change', (next) => {
          void created.integrations.setActive(isActive(next)).catch(() => {
            // Durable jobs remain pending and the next foreground transition
            // retries them. UI reads detailed channel state from Application.
          });
        });
        setState({ status: 'ready', runtime: created });
        void created.integrations
          .setActive(isActive(AppState.currentState))
          .catch(() => {
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
      if (runtime !== null) {
        void runtime.integrations
          .setActive(false)
          .then(() => runtime?.close())
          .catch(() => runtime?.close());
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
