import { useEffect, useRef, useState } from "react";
import type { GameStateDto, GameSyncEventDto, GameSyncResponseDto } from "@ai-mud/shared";
import { getGameSync } from "../gameApi";

export interface UseGameSyncOptions {
  enabled?: boolean;
  initialCursor?: number;
  activeAction?: GameStateDto["currentAction"];
  idleIntervalMs?: number;
  activeIntervalMs?: number;
  fetchSync?: (cursor?: number) => Promise<GameSyncResponseDto>;
  onState?: (state: GameStateDto) => void;
  onEvents?: (events: GameSyncEventDto[]) => void;
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
    onEvents
  } = options;
  const cursorRef = useRef(initialCursor);
  const timerRef = useRef<number | null>(null);
  const [cursor, setCursor] = useState(initialCursor);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<Error | null>(null);

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

        cursorRef.current = next.nextCursor;
        setCursor(next.nextCursor);
        setError(null);
        if (next.state) onState?.(next.state);
        if (next.events.length > 0) onEvents?.(next.events);
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
  }, [activeAction, activeIntervalMs, enabled, fetchSync, idleIntervalMs, onEvents, onState]);

  return { cursor, isSyncing, error };
}
