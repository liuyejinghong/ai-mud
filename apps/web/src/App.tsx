import { useEffect, useState } from "react";
import { AiCallAdmin } from "./features/admin/AiCallAdmin";
import { AiLayerStatusAdmin } from "./features/admin/AiLayerStatusAdmin";
import { AccountOpsAdmin } from "./features/admin/AccountOpsAdmin";
import { ActivationCodeAdmin } from "./features/admin/ActivationCodeAdmin";
import { AssetLedgerHealthAdmin } from "./features/admin/AssetLedgerHealthAdmin";
import { EconomyAdmin } from "./features/admin/EconomyAdmin";
import { NpcAdmin } from "./features/admin/NpcAdmin";
import { NpcMemoryAdmin } from "./features/admin/NpcMemoryAdmin";
import { SystemAnnouncementAdmin } from "./features/admin/SystemAnnouncementAdmin";
import { WorldHealthAdmin } from "./features/admin/WorldHealthAdmin";
import { WorldResetAdmin } from "./features/admin/WorldResetAdmin";
import { AuthPage } from "./features/auth/AuthPage";
import { getCurrentSession, type AuthSessionDto } from "./features/auth/authApi";
import { GameShell } from "./features/game/GameShell";

export function App() {
  const [session, setSession] = useState<AuthSessionDto | null>(null);

  useEffect(() => {
    let cancelled = false;

    void getCurrentSession()
      .then((currentSession) => {
        if (!cancelled) setSession(currentSession);
      })
      .catch(() => {
        if (!cancelled) setSession(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!session) {
    return <AuthPage onAuthenticated={setSession} />;
  }

  const isAdmin = session.user.role === "admin" || session.user.role === "super_admin";

  return (
    <>
      <GameShell csrfToken={session.csrfToken} onAuthExpired={() => setSession(null)} />
      {isAdmin ? (
        <>
          <WorldHealthAdmin />
          <SystemAnnouncementAdmin csrfToken={session.csrfToken} />
          <AccountOpsAdmin csrfToken={session.csrfToken} />
          <ActivationCodeAdmin csrfToken={session.csrfToken} />
          <WorldResetAdmin csrfToken={session.csrfToken} />
          <EconomyAdmin />
          <AssetLedgerHealthAdmin />
          <NpcAdmin csrfToken={session.csrfToken} />
          <AiLayerStatusAdmin />
          <AiCallAdmin />
          <NpcMemoryAdmin />
        </>
      ) : null}
    </>
  );
}
