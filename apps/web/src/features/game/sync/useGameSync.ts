import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ChatMessageDto,
  GameStateDto,
  GameSyncEventDto,
  GameSyncResponseDto,
  LeaderboardEntryDto,
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
  activeAction?: GameStateDto["currentAction"];
  idleIntervalMs?: number;
  activeIntervalMs?: number;
  fetchSync?: (cursor?: number) => Promise<GameSyncResponseDto>;
  onState?: (state: GameStateDto) => void;
  onEvents?: (events: GameSyncEventDto[]) => void;
  onLobby?: (payload: LobbySyncPayload) => void;
}

export function useGameSync(options: UseGameSyncOptions = {}) {
  const {
    enabled = true,
    initialCursor = 0,
    activeAction = null,
    idleIntervalMs = 15_000,
    activeIntervalMs = 3_000,
    fetchSync = getGameSync,
    onState,
    onEvents,
    onLobby
  } = options;
  const cursorRef = useRef(initialCursor);
  const timerRef = useRef<number | null>(null);
  const [cursor, setCursor] = useState(initialCursor);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const applyResponse = useCallback(
    (next: GameSyncResponseDto) => {
      cursorRef.current = next.nextCursor;
      setCursor(next.nextCursor);
      setError(null);
      if (next.state) onState?.(next.state);
      if (next.events.length > 0) onEvents?.(next.events);
      if (next.chat || next.presence || next.leaderboards) {
        onLobby?.({
          chat: next.chat ?? [],
          presence: next.presence ?? [],
          leaderboards: {
            level: next.leaderboards?.level ?? [],
            wealth: next.leaderboards?.wealth ?? []
          }
        });
      }
    },
    [onEvents, onLobby, onState]
  );

  useEffect(() => {
    cursorRef.current = initialCursor;
    setCursor(initialCursor);
  }, [initialCursor]);

  useEffect(() => {
    if (!enabled) return undefined;

    let cancelled = false;
    const intervalMs = activeAction ? activeIntervalMs : idleIntervalMs;

    const clearTimer = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const schedule = () => {
      clearTimer();
      if (!cancelled) {
        timerRef.current = window.setTimeout(() => {
          void poll();
        }, intervalMs);
      }
    };

    const poll = async () => {
      setIsSyncing(true);
      try {
        const next = await fetchSync(cursorRef.current > 0 ? cursorRef.current : undefined);
        if (cancelled) return;

        applyResponse(next);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught : new Error("Game sync failed"));
        }
      } finally {
        if (!cancelled) {
          setIsSyncing(false);
          schedule();
        }
      }
    };

    void poll();

    return () => {
      cancelled = true;
      clearTimer();
    };
  }, [activeAction, activeIntervalMs, applyResponse, enabled, fetchSync, idleIntervalMs]);

  return { cursor, isSyncing, error, applyResponse };
}
