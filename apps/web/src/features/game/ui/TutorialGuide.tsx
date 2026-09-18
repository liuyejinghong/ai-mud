import { useEffect, useMemo, useState } from "react";
import type { GameStateDto } from "@ai-mud/shared";

export const TUTORIAL_VERSION = "v0.10.6";

interface TutorialSnapshot extends Pick<GameStateDto, "currentAction" | "inventory" | "log"> {
  character: NonNullable<GameStateDto["character"]>;
}

interface StoredTutorialState {
  progress: number;
  collapsed: boolean;
}

interface TutorialStep {
  title: string;
  description: string;
}

const tutorialSteps: readonly TutorialStep[] = [
  { title: "离开哨站", description: "前往旧矿坑或腐林，开始第一次野外探索。" },
  { title: "走过一格", description: "用 W、A、S、D 或地图按钮移动一次。" },
  { title: "完成一轮采集", description: "在资源点开始采集，等本轮进度结算。" },
  { title: "检查收获", description: "打开背包，确认刚刚获得的物资已经入账。" },
  { title: "回到哨站", description: "返回哨站，再处理 NPC、集市和装备。" }
];

function storageKey(characterId: string) {
  return `ai-mud:tutorial:${TUTORIAL_VERSION}:${characterId}`;
}

function defaultTutorialState(): StoredTutorialState {
  return { progress: 0, collapsed: false };
}

function readTutorialState(key: string): StoredTutorialState {
  if (typeof window === "undefined") return defaultTutorialState();
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return defaultTutorialState();
    const parsed = JSON.parse(raw) as Partial<StoredTutorialState>;
    return {
      progress: Number.isFinite(parsed.progress) ? Math.max(0, Math.floor(parsed.progress!)) : 0,
      collapsed: parsed.collapsed === true
    };
  } catch {
    return defaultTutorialState();
  }
}

function writeTutorialState(key: string, state: StoredTutorialState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // A blocked localStorage must not block the game HUD.
  }
}

export function inferTutorialProgress(state: TutorialSnapshot) {
  let progress = 0;
  const location = state.character.currentLocation;
  const hasEventType = (eventType: string) =>
    state.log.some((entry) => entry.eventType === eventType);

  if (location !== "blackpine_outpost") progress = 1;
  if (hasEventType("character.move")) progress = Math.max(progress, 2);
  if (state.currentAction?.actionType === "gathering" || hasEventType("action.gathering.start")) {
    progress = Math.max(progress, 3);
  }
  if (progress >= 3 && state.inventory.length > 0) {
    progress = Math.max(progress, 4);
  }
  if (location === "blackpine_outpost" && progress >= 4 && hasEventType("zone.return")) {
    progress = tutorialSteps.length;
  }

  return Math.min(tutorialSteps.length, progress);
}

export interface TutorialGuideProps {
  characterId: string;
  state: TutorialSnapshot;
}

export function TutorialGuide({ characterId, state }: TutorialGuideProps) {
  const key = useMemo(() => storageKey(characterId), [characterId]);
  const [storedState, setStoredState] = useState<StoredTutorialState>(() => readTutorialState(key));
  const observedProgress = inferTutorialProgress(state);

  useEffect(() => {
    setStoredState(readTutorialState(key));
  }, [key]);

  useEffect(() => {
    setStoredState((current) => {
      const next = {
        ...current,
        progress: Math.max(current.progress, observedProgress)
      };
      if (next.progress !== current.progress) writeTutorialState(key, next);
      return next;
    });
  }, [key, observedProgress]);

  if (storedState.progress >= tutorialSteps.length) return null;

  const step = tutorialSteps[storedState.progress] ?? tutorialSteps[0]!;
  const reset = () => {
    const next = defaultTutorialState();
    writeTutorialState(key, next);
    setStoredState(next);
  };

  return (
    <section className="tutorial-guide" aria-labelledby="tutorial-guide-title">
      <div className="panel-heading">
        <h2 id="tutorial-guide-title">新手引导</h2>
        <span>{storedState.progress + 1}/{tutorialSteps.length}</span>
      </div>
      <div className="tutorial-guide-actions">
        <button
          type="button"
          className="game-secondary-button"
          aria-expanded={!storedState.collapsed}
          onClick={() => {
            const next = { ...storedState, collapsed: !storedState.collapsed };
            writeTutorialState(key, next);
            setStoredState(next);
          }}
        >
          {storedState.collapsed ? "展开" : "收起"}
        </button>
        <button type="button" className="game-secondary-button" onClick={reset}>重置</button>
      </div>
      {!storedState.collapsed ? (
        <div className="tutorial-guide-current">
          <strong>{step.title}</strong>
          <p>{step.description}</p>
        </div>
      ) : null}
    </section>
  );
}
