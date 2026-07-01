import { useEffect, useState } from "react";
import { AiCallAdmin } from "./features/admin/AiCallAdmin";
import { ActivationCodeAdmin } from "./features/admin/ActivationCodeAdmin";
import { EconomyAdmin } from "./features/admin/EconomyAdmin";
import { NpcAdmin } from "./features/admin/NpcAdmin";
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
      <GameShell csrfToken={session.csrfToken} />
      {isAdmin ? (
        <>
          <ActivationCodeAdmin csrfToken={session.csrfToken} />
          <EconomyAdmin />
          <NpcAdmin csrfToken={session.csrfToken} />
          <AiCallAdmin />
        </>
      ) : null}
    </>
  );
}
