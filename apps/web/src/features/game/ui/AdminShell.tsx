import { useRef, useState, type KeyboardEvent } from "react";
import { AccountOpsAdmin } from "../../admin/AccountOpsAdmin";
import { ActivationCodeAdmin } from "../../admin/ActivationCodeAdmin";
import { AiCallAdmin } from "../../admin/AiCallAdmin";
import { AiLayerStatusAdmin } from "../../admin/AiLayerStatusAdmin";
import { AssetLedgerHealthAdmin } from "../../admin/AssetLedgerHealthAdmin";
import { EconomyAdmin } from "../../admin/EconomyAdmin";
import { NpcAdmin } from "../../admin/NpcAdmin";
import { NpcMemoryAdmin } from "../../admin/NpcMemoryAdmin";
import { ContentAdminPanel } from "../../admin/ContentAdminPanel";
import { SystemAnnouncementAdmin } from "../../admin/SystemAnnouncementAdmin";
import { WorldHealthAdmin } from "../../admin/WorldHealthAdmin";
import "../../admin/ActivationCodeAdmin.css";
import "./AdminShell.css";

// 第 0 阶段车道 C2（评审 ARCH-boundaries-01）：旧“世界重置”页签已下线。它只清旧黑松世界的表、不清任何
// 基地数据（达不到重开《余电》试玩的目的），修复前还会把共享 tick 时钟拨回 1970、令全部基地停产。
// 服务端路由仅在 LEGACY_WORLD_ENABLED=true 时注册，管理台不再提供按钮；组件 WorldResetAdmin 归档保留。
const adminTabs = [
  { id: "world-health", label: "世界健康" },
  { id: "system-announcement", label: "系统公告" },
  { id: "account-ops", label: "账号运营" },
  { id: "activation-code", label: "激活码" },
  { id: "economy", label: "经济监控" },
  { id: "asset-ledger", label: "账本守恒" },
  { id: "npc", label: "NPC 监控" },
  { id: "ai-layer", label: "AI 状态" },
  { id: "ai-call", label: "AI 日志" },
  { id: "npc-memory", label: "NPC 记忆" },
  { id: "content-workshop", label: "内容工坊" }
] as const;

type AdminTabId = (typeof adminTabs)[number]["id"];

function AdminPanel({ activeTab, csrfToken }: { activeTab: AdminTabId; csrfToken: string }) {
  switch (activeTab) {
    case "world-health":
      return <WorldHealthAdmin />;
    case "system-announcement":
      return <SystemAnnouncementAdmin csrfToken={csrfToken} />;
    case "account-ops":
      return <AccountOpsAdmin csrfToken={csrfToken} />;
    case "activation-code":
      return <ActivationCodeAdmin csrfToken={csrfToken} />;
    case "economy":
      return <EconomyAdmin />;
    case "asset-ledger":
      return <AssetLedgerHealthAdmin />;
    case "npc":
      return <NpcAdmin csrfToken={csrfToken} />;
    case "ai-layer":
      return <AiLayerStatusAdmin />;
    case "ai-call":
      return <AiCallAdmin />;
    case "npc-memory":
      return <NpcMemoryAdmin />;
    case "content-workshop":
      return <ContentAdminPanel csrfToken={csrfToken} />;
  }
}

export function AdminShell({ csrfToken }: { csrfToken: string }) {
  const [activeTab, setActiveTab] = useState<AdminTabId>("world-health");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = adminTabs.findIndex((tab) => tab.id === activeTab);

  function selectTab(index: number) {
    const nextIndex = (index + adminTabs.length) % adminTabs.length;
    const nextTab = adminTabs[nextIndex];
    if (!nextTab) return;

    setActiveTab(nextTab.id);
    tabRefs.current[nextIndex]?.focus();
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        selectTab(activeIndex + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        selectTab(activeIndex - 1);
        break;
      case "Home":
        event.preventDefault();
        selectTab(0);
        break;
      case "End":
        event.preventDefault();
        selectTab(adminTabs.length - 1);
        break;
    }
  }

  const activeTabLabel = adminTabs[activeIndex]?.label ?? "管理模块";
  const tabId = `admin-tab-${activeTab}`;
  const panelId = `admin-panel-${activeTab}`;

  return (
    <main className="admin-shell" aria-label="管理工作区">
      <nav className="admin-shell__navigation" aria-label="管理模块">
        <div className="admin-shell__tabs" role="tablist" aria-label="管理模块">
          {adminTabs.map((tab, index) => {
            const selected = tab.id === activeTab;

            return (
              <button
                key={tab.id}
                ref={(element) => {
                  tabRefs.current[index] = element;
                }}
                id={`admin-tab-${tab.id}`}
                className="admin-shell__tab"
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`admin-panel-${tab.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={handleTabKeyDown}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </nav>

      <section
        key={activeTab}
        id={panelId}
        className="admin-shell__panel"
        role="tabpanel"
        aria-label={activeTabLabel}
        aria-labelledby={tabId}
        tabIndex={0}
      >
        <AdminPanel activeTab={activeTab} csrfToken={csrfToken} />
      </section>
    </main>
  );
}
