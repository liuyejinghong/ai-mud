import { useEffect, useState } from "react";
import { ActivationCodeAdmin } from "./features/admin/ActivationCodeAdmin";
import { AuthPage } from "./features/auth/AuthPage";
import { getCurrentSession, type AuthSessionDto } from "./features/auth/authApi";

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

  const isAdmin = session?.user.role === "admin" || session?.user.role === "super_admin";

  return (
    <>
      <AuthPage onAuthenticated={setSession} />
      {isAdmin ? <ActivationCodeAdmin csrfToken={session.csrfToken} /> : null}
    </>
  );
}
