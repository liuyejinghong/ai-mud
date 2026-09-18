import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ChatMessageDto,
  GameStateDto,
  GameSyncEventDto,
  GameSyncResponseDto,
  LeaderboardEntryDto,
  OfflineReportDto,
  PresenceDto
} from "@ai-mud/shared";
import { getGameSync } from "../gameApi";

export interface LobbySyncPayload {
  chat: ChatMessageDto[];
  presence: PresenceDto[];
  leaderboards: {
    level: LeaderboardEntryDto[];
    wealth: LeaderboardEntryDto[];
  };
}

export interface UseGameSyncOptions {
  enabled?: boolean;
  initialCursor?: number;
  characterId?: string | null;
  activeAction?: GameStateDto["currentAction"];
  idleIntervalMs?: number;
  activeIntervalMs?: number;
  fetchSync?: (cursor?: number, signal?: AbortSignal) => Promise<GameSyncResponseDto>;
  onState?: (state: GameStateDto, response: GameSyncResponseDto) => void;
  onEvents?: (events: GameSyncEventDto[]) => void;
  onLobby?: (payload: LobbySyncPayload) => void;
  onOfflineReport?: (report: OfflineReportDto) => void;
}

export function useGameSync(options: UseGameSyncOptions = {}) {
  const {
    enabled = true,
    initialCursor = 0,
    characterId = null,
    activeAction = null,
    idleIntervalMs = 15_000,
    activeIntervalMs = 3_000,
    fetchSync = getGameSync,
    onState,
    onEvents,
    onLobby,
    onOfflineReport
  } = options;
  const activeActionId = activeAction?.id ?? null;
  const actionIsActive = activeAction?.status === "active";
  const cursorRef = useRef(initialCursor);
  const lastEpochRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const mountedRef = useRef(false);
  const rescheduleRef = useRef<(() => void) | null>(null);
  const fetchSyncRef = useRef(fetchSync);
  const intervalMsRef = useRef(actionIsActive ? activeIntervalMs : idleIntervalMs);
  const callbacksRef = useRef({ onState, onEvents, onLobby, onOfflineReport });
  const [cursor, setCursor] = useState(initialCursor);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  fetchSyncRef.current = fetchSync;
  intervalMsRef.current = actionIsActive ? activeIntervalMs : idleIntervalMs;
  callbacksRef.current = { onState, onEvents, onLobby, onOfflineReport };

  const applyResponse = useCallback((next: GameSyncResponseDto) => {
    if (!mountedRef.current) return;

    const epoch = next.worldEpoch ?? null;
    if (epoch !== null && lastEpochRef.current !== null && epoch < lastEpochRef.current) {
      return;
    }
    if (epoch !== null) {
      lastEpochRef.current = epoch;
    }
    cursorRef.current = next.nextCursor;
    setCursor(next.nextCursor);
    setError(null);
    const callbacks = callbacksRef.current;
    if (next.state) callbacks.onState?.(next.state, next);
    if (next.events.length > 0) callbacks.onEvents?.(next.events);
    if (next.offlineReport) callbacks.onOfflineReport?.(next.offlineReport);
    if (next.chat || next.presence || next.leaderboards) {
      callbacks.onLobby?.({
        chat: next.chat ?? [],
        presence: next.presence ?? [],
        leaderboards: {
          level: next.leaderboards?.level ?? [],
          wealth: next.leaderboards?.wealth ?? []
        }
      });
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    cursorRef.current = initialCursor;
    setCursor(initialCursor);
  }, [initialCursor]);

  useEffect(() => {
    lastEpochRef.current = null;
  }, [characterId]);

  useEffect(() => {
    if (!enabled) {
      setIsSyncing(false);
      return undefined;
    }

    let cancelled = false;
    let failures = 0;
    let inFlight = false;
    let controller: AbortController | null = null;

    const clearTimer = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const nextDelay = () =>
      failures === 0
        ? intervalMsRef.current
        : Math.min(intervalMsRef.current * 2 ** failures, 60_000);

    const schedule = () => {
      clearTimer();
      if (!cancelled && !inFlight) {
        timerRef.current = window.setTimeout(() => {
          void poll();
        }, nextDelay());
      }
    };

    const poll = async () => {
      if (cancelled || inFlight) return;

      clearTimer();
      inFlight = true;
      setIsSyncing(true);
      controller = typeof AbortController === "undefined" ? null : new AbortController();
      try {
        const next = await fetchSyncRef.current(
          cursorRef.current > 0 ? cursorRef.current : undefined,
          controller?.signal
        );
        if (cancelled) return;

        failures = 0;
        applyResponse(next);
      } catch (caught) {
        if (!cancelled) {
          failures += 1;
          setError(caught instanceof Error ? caught : new Error("Game sync failed"));
        }
      } finally {
        controller = null;
        inFlight = false;
        if (!cancelled) {
          setIsSyncing(false);
          schedule();
        }
      }
    };

    rescheduleRef.current = schedule;
    void poll();

    return () => {
      cancelled = true;
      rescheduleRef.current = null;
      clearTimer();
      controller?.abort();
    };
  }, [applyResponse, enabled]);

  useEffect(() => {
    rescheduleRef.current?.();
  }, [activeActionId, actionIsActive, activeIntervalMs, idleIntervalMs]);

  return { cursor, isSyncing, error, applyResponse };
}
