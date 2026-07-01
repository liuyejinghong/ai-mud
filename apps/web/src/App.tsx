import { ActivationCodeAdmin } from "./features/admin/ActivationCodeAdmin";
import { AuthPage } from "./features/auth/AuthPage";

export function App() {
  return (
    <>
      <AuthPage />
      <ActivationCodeAdmin />
    </>
  );
}
