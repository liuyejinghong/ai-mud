import type { SceneObject } from "../controller/gameSelectors";

export interface ScenePanelProps {
  locationTitle: string;
  locationDescription: string;
  positionText: string;
  sceneObjects: readonly SceneObject[];
  contextualObjective: string;
}

export function ScenePanel({
  locationTitle,
  locationDescription,
  positionText,
  sceneObjects,
  contextualObjective
}: ScenePanelProps) {
  return (
    <>
      <div className="location-header">
        <p className="game-kicker">场景</p>
        <h1 id="location-title">{locationTitle}</h1>
        <p>{locationDescription}</p>
      </div>

      <section className="world-scene-panel" aria-labelledby="scene-focus-title">
        <article className="scene-narrative">
          <div className="panel-heading">
            <h2 id="scene-focus-title">当前位置</h2>
            <span>{positionText}</span>
          </div>
          <div className="scene-copy">
            <p>{locationDescription}</p>
          </div>
          <div className="scene-object-list" aria-label="当前位置可交互对象">
            {sceneObjects.length === 0 ? (
              <p className="empty-copy">暂时没有可辨认的交互对象。</p>
            ) : null}
            {sceneObjects.map((sceneObject) => (
              <div className="scene-object-card" key={sceneObject.id}>
                <strong>{sceneObject.title}</strong>
                <span>{sceneObject.body}</span>
              </div>
            ))}
          </div>
        </article>

        <aside className="scene-decision-panel" aria-labelledby="next-step-title">
          <div className="panel-heading">
            <h2 id="next-step-title">下一步</h2>
          </div>
          <p className="objective-copy">{contextualObjective}</p>
        </aside>
      </section>
    </>
  );
}
