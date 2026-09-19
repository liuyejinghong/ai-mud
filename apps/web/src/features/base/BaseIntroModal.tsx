// 首次进入基地的剧情引导弹窗：告诉玩家「你是谁、目标是什么、怎么开始」。
// 只在还没有任何项目时显示；点「开始指挥」后本次浏览器不再打扰（localStorage）。
export function BaseIntroModal({
  baseName,
  onDismiss
}: {
  baseName: string;
  onDismiss: () => void;
}) {
  return (
    <div className="base-intro-backdrop" role="presentation">
      <section className="base-intro" role="dialog" aria-modal="true" aria-label="新手引导">
        <h2 className="base-intro-title">先遣工程队 · 就位</h2>
        <p className="base-intro-copy">
          2033 年，首批无人货运飞船降落在阿卡迪亚平原。你是地球上远程指挥这批设备的经营者——
          12 台工程机器人已经在 {baseName} 就位，随船物资堆在货场，等它们落地。
        </p>
        <p className="base-intro-goal">
          你的第一个任务：把运抵的太阳电池阵安装到建设位，让基地拥有真正的发电能力。
        </p>
        <ol className="base-intro-steps">
          <li>点右上角「恢复计时」，工程队开始工作；</li>
          <li>点地图上的「建设位 A」，选择「安装运抵的太阳能设施」开工；</li>
          <li>盯住下方项目清单——缺电或缺料时，工程队会停下来等你处理。</li>
        </ol>
        <p className="base-intro-hint">
          火星的一天约等于现实一天；离开时基地自动暂停，不会浪费物资。
        </p>
        <button type="button" className="base-primary-button" onClick={onDismiss}>
          开始指挥
        </button>
      </section>
    </div>
  );
}
