import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { User } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { getSupabase, getSupabaseError } from '../lib/supabase';

export type AppRole = 'author' | 'admin';
export interface Profile {
  id: string;
  first_name: string;
  last_name: string;
  affiliation: string | null;
}
interface AuthState {
  user: User | null;
  profile: Profile | null;
  role: AppRole | null;
  loading: boolean;
  error: string | null;
}
interface AuthContextValue extends AuthState {
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}
const empty: AuthState = { user: null, profile: null, role: null, loading: true, error: null };
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(empty);
  const queryClient = useQueryClient();
  const epoch = useRef(0);
  const mounted = useRef(true);
  const identity = useRef<string | null>(null);
  const previousRole = useRef<AppRole | null>(null);
  const invalidate = useCallback(() => {
    ++epoch.current;
  }, []);

  const clearPrivateState = useCallback(() => {
    const privateQueries = {
      predicate: (query: { queryKey: readonly unknown[] }) =>
        !['articles', 'article'].includes(String(query.queryKey[0])),
    };
    void queryClient.cancelQueries(privateQueries);
    queryClient.removeQueries(privateQueries);
    identity.current = null;
    previousRole.current = null;
  }, [queryClient]);

  const refresh = useCallback(async () => {
    const sequence = ++epoch.current;
    const configurationError = getSupabaseError();
    if (configurationError) {
      setState({ ...empty, loading: false, error: configurationError });
      return;
    }
    try {
      const client = getSupabase();
      // getSession waits for SDK callback processing. Identity is then verified by Auth.
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionData.session) {
        if (mounted.current && epoch.current === sequence) {
          clearPrivateState();
          setState({ ...empty, loading: false });
        }
        return;
      }
      const { data: verified, error: userError } = await client.auth.getUser();
      if (userError || !verified.user)
        throw userError || new Error('Your session has expired. Please sign in again.');
      const [profileResult, roleResult] = await Promise.all([
        client
          .from('profiles')
          .select('id,first_name,last_name,affiliation')
          .eq('id', verified.user.id)
          .single(),
        client.rpc('my_role'),
      ]);
      if (profileResult.error)
        throw new Error(
          'Your profile could not be loaded. Retry, or contact support if the problem continues.',
        );
      if (roleResult.error || !['author', 'admin'].includes(String(roleResult.data)))
        throw new Error(
          'Your account access could not be verified. Please retry or contact support.',
        );
      if (!mounted.current || sequence !== epoch.current) return;
      if (
        identity.current &&
        (identity.current !== verified.user.id || previousRole.current !== roleResult.data)
      )
        clearPrivateState();
      identity.current = verified.user.id;
      previousRole.current = roleResult.data as AppRole;
      setState({
        user: verified.user,
        profile: profileResult.data as Profile,
        role: roleResult.data as AppRole,
        loading: false,
        error: null,
      });
    } catch (error) {
      if (!mounted.current || sequence !== epoch.current) return;
      clearPrivateState();
      setState({
        ...empty,
        loading: false,
        error:
          error instanceof Error
            ? error.message
            : 'Account access could not be verified. Please retry.',
      });
    }
  }, [clearPrivateState]);

  useEffect(() => {
    mounted.current = true;
    if (getSupabaseError()) {
      void refresh();
      return () => {
        mounted.current = false;
      };
    }
    const client = getSupabase();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const { data: listener } = client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        ++epoch.current;
        clearPrivateState();
        setState({ ...empty, loading: false });
      } else {
        if (identity.current !== session.user.id) setState(empty);
        // Never call another Auth API from inside the locked Auth event callback.
        clearTimeout(timer);
        timer = setTimeout(() => {
          void refresh();
        }, 0);
      }
    });
    void refresh();
    const onFocus = () => {
      void refresh();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    const roleRefresh = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 60_000);
    return () => {
      mounted.current = false;
      invalidate();
      clearTimeout(timer);
      clearInterval(roleRefresh);
      listener.subscription.unsubscribe();
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [clearPrivateState, invalidate, refresh]);

  const signOut = useCallback(async () => {
    ++epoch.current;
    clearPrivateState();
    setState({ ...empty, loading: false });
    const client = getSupabase();
    await client.removeAllChannels();
    const { error } = await client.auth.signOut();
    if (error) {
      await client.auth.signOut({ scope: 'local' });
      throw new Error(
        'This browser has been signed out. Other sessions could not be ended; check your connection and try again.',
      );
    }
  }, [clearPrivateState]);

  return (
    <AuthContext.Provider value={{ ...state, refresh, signOut }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider');
  return value;
}
