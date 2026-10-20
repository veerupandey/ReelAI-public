import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
    fetchReelHistory,
    type ReelHistoryEntry,
    type UserProfileRecord,
    upsertUserProfile,
    fetchProjectSessions,
    type ProjectSession,
    type LocalSession,
} from '../services/userDataService';

type AuthMode = 'signIn' | 'signUp' | 'forgot' | 'reset';

const LOCAL_SESSION: LocalSession = {
    user: {
        id: 'local-user',
        email: 'local@reelai.local',
        user_metadata: { full_name: 'Local Creator' },
    },
    access_token: 'local-token',
};

interface AuthContextValue {
    session: LocalSession | null;
    loading: boolean;
    supabaseReady: boolean;
    profile: UserProfileRecord | null;
    history: ReelHistoryEntry[];
    authMode: AuthMode;
    setAuthMode: (mode: AuthMode) => void;
    signIn: (email: string, password: string) => Promise<void>;
    signUp: (email: string, password: string, fullName: string) => Promise<void>;
    signOut: () => Promise<void>;
    requestPasswordReset: (email: string) => Promise<void>;
    completePasswordReset: (newPassword: string) => Promise<void>;
    signInWithProvider: (provider: 'google' | 'github') => Promise<void>;
    refreshHistory: (forceRefresh?: boolean) => Promise<ReelHistoryEntry[]>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const projectSessionsToHistory = (
    projectSessions: ProjectSession[],
    userId: string,
): ReelHistoryEntry[] =>
    (projectSessions || []).map((ps) => ({
        id: ps.id || `session-${Date.now()}`,
        user_id: ps.user_id || userId,
        created_at: ps.created_at || new Date().toISOString(),
        mode: ps.state?.creationMode || 'unknown',
        prompt: ps.state?.userPrompt,
        topic: ps.state?.textToReelTopic || ps.state?.reelPlan?.topic,
        vibe: ps.state?.reelPlan?.vibe,
        scenes: ps.state?.media?.length || ps.state?.reelPlan?.scenes?.length || 0,
        status: 'plan_saved' as const,
        metadata: {
            plan: ps.state?.reelPlan,
            script: ps.state?.script,
            media: ps.state?.media,
            sceneDrafts: ps.state?.sceneDrafts,
            creationMode: ps.state?.creationMode,
            sessionName: ps.name,
            isProjectSession: true,
            step: ps.state?.step,
            enableVoiceover: ps.state?.enableVoiceover,
            enableCaptions: ps.state?.enableCaptions,
            selectedVoiceId: ps.state?.selectedVoiceId || ps.state?.selectedVoice,
            brandKit: ps.state?.brandKit,
            visualSettings: ps.state?.visualSettings,
            subtitleSettings: ps.state?.subtitleSettings,
            audioMix: ps.state?.audioMix,
            textToReelTopic: ps.state?.textToReelTopic,
            userPrompt: ps.state?.userPrompt,
        },
    }));

const mergeHistoryEntries = (
    historyEntries: ReelHistoryEntry[],
    sessionEntries: ReelHistoryEntry[],
): ReelHistoryEntry[] => {
    const allEntries = [...(historyEntries || []), ...sessionEntries];
    const uniqueEntries = allEntries.reduce(
        (acc, entry) => {
            const key = `${entry.topic || ''}-${entry.created_at?.slice(0, 16) || ''}`;
            if (!acc.seen.has(key)) {
                acc.seen.add(key);
                acc.entries.push(entry);
            }
            return acc;
        },
        { seen: new Set<string>(), entries: [] as ReelHistoryEntry[] },
    ).entries;

    uniqueEntries.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    return uniqueEntries;
};

export const AuthProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
    const [session, setSession] = useState<LocalSession | null>(LOCAL_SESSION);
    const [loading, setLoading] = useState(true);
    const [authMode, setAuthMode] = useState<AuthMode>('signIn');
    const [profile, setProfile] = useState<UserProfileRecord | null>(null);
    const [history, setHistory] = useState<ReelHistoryEntry[]>([]);
    const lastFetchTimeRef = useRef<number>(0);
    const CACHE_DURATION_MS = 30000;

    const hydrateUserData = useCallback(async (nextSession: LocalSession | null) => {
        if (!nextSession?.user) {
            setProfile(null);
            setHistory([]);
            return;
        }
        try {
            const [profileRecord, historyEntries, projectSessions] = await Promise.all([
                upsertUserProfile(nextSession),
                fetchReelHistory(nextSession.user.id),
                fetchProjectSessions(nextSession.user.id),
            ]);
            if (profileRecord) setProfile(profileRecord);
            const sessionEntries = projectSessionsToHistory(projectSessions, nextSession.user.id);
            setHistory(mergeHistoryEntries(historyEntries || [], sessionEntries));
            lastFetchTimeRef.current = Date.now();
        } catch (err) {
            console.error('[AuthContext] hydrateUserData failed', err);
        }
    }, []);

    useEffect(() => {
        setSession(LOCAL_SESSION);
        hydrateUserData(LOCAL_SESSION).finally(() => setLoading(false));
    }, [hydrateUserData]);

    const unsupportedAuth = async () => {
        throw new Error('Cloud auth is disabled. This build uses a local-only session.');
    };

    const signOut = async () => {
        // Local studio keeps the always-on session; clear history/profile view only.
        setProfile(null);
        setHistory([]);
        await hydrateUserData(LOCAL_SESSION);
    };

    const value = useMemo<AuthContextValue>(
        () => ({
            session,
            loading,
            supabaseReady: false,
            profile,
            history,
            authMode,
            setAuthMode,
            signIn: unsupportedAuth,
            signUp: unsupportedAuth,
            signOut,
            requestPasswordReset: unsupportedAuth,
            completePasswordReset: unsupportedAuth,
            signInWithProvider: unsupportedAuth,
            refreshHistory: async (forceRefresh: boolean = false) => {
                if (!session?.user) {
                    setHistory([]);
                    return [];
                }

                const now = Date.now();
                const cacheAge = now - lastFetchTimeRef.current;
                const hasCachedData = history.length > 0 && lastFetchTimeRef.current > 0;
                if (!forceRefresh && hasCachedData && cacheAge < CACHE_DURATION_MS) {
                    return history;
                }

                try {
                    const [historyEntries, projectSessions] = await Promise.all([
                        fetchReelHistory(session.user.id),
                        fetchProjectSessions(session.user.id),
                    ]);
                    const sessionEntries = projectSessionsToHistory(projectSessions, session.user.id);
                    const uniqueEntries = mergeHistoryEntries(historyEntries || [], sessionEntries);
                    setHistory(uniqueEntries);
                    lastFetchTimeRef.current = Date.now();
                    return uniqueEntries;
                } catch (err) {
                    console.error('[AuthContext] refreshHistory failed:', err);
                    return history;
                }
            },
        }),
        [session, loading, authMode, profile, history, hydrateUserData],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within AuthProvider');
    return ctx;
};
