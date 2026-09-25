// 首次进入基地的剧情引导弹窗：告诉玩家「你是谁、目标是什么、怎么开始」。
// 只在还没有任何项目时显示；点「开始指挥」后本次浏览器不再打扰（localStorage，按基地隔离，见 BaseApp）。
import { useRef } from "react";

// 打开时焦点落进弹窗、Tab 在弹窗内循环、Esc 可关闭——背景控件不可达（UX-01）。
const FOCUSABLE = "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

export function BaseIntroModal({
  baseName,
  onDismiss
}: {
  baseName: string;
  onDismiss: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      onDismiss();
      return;
    }
    if (event.key !== "Tab") return;
    const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (!focusables || focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (first === undefined || last === undefined) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="base-intro-backdrop" role="presentation">
      <section
        ref={dialogRef}
        onKeyDown={handleKeyDown}
        className="base-intro"
        role="dialog"
        aria-modal="true"
        aria-label="新手引导"
      >
        <h2 className="base-intro-title">先遣工程队 · 就位</h2>
        <p className="base-intro-copy">
          2033 年，首批无人货运飞船降落在阿卡迪亚平原。你是地球上远程指挥这批设备的经营者——
          12 台工程机器人已经在 {baseName}
          就位，随船物资已经入库。地图上那些已建成的阵列、储能间、仓储棚，只是让基地「活着」的骨架。
        </p>
        <p className="base-intro-goal">
          你的第一个任务：把运抵的太阳电池阵安装到建设位 A，让基地现有的 15 kW 峰值发电能力再增加 5 kW。
        </p>
        <ol className="base-intro-steps">
          <li>在时间控制区点「恢复计时」，工程队开始工作；</li>
          <li>点地图上的「建设位 A」（虚线框），选择「安装运抵的太阳能设施」开工；</li>
          <li>查看项目进度——缺电或缺料时，工程队会停下来等你处理。</li>
        </ol>
        <p className="base-intro-hint">
          火星的一天约等于现实一天；离开时基地自动暂停，不会浪费物资。现在就能接外部订单赚账款、采购材料、制造新机器人，边建设边经营前哨。
        </p>
        <button type="button" className="base-primary-button" autoFocus onClick={onDismiss}>
          开始指挥
        </button>
      </section>
    </div>
  );
}
