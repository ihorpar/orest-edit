"use client";

import { FormEvent, Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { useProductCopy } from "../../components/providers/ProductLocaleProvider";

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginPageFallback />}>
      <LoginPageContent />
    </Suspense>
  );
}

function LoginPageContent() {
  const searchParams = useSearchParams();
  const copy = useProductCopy();
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const misconfigurationMessage = useMemo(() => {
    const code = searchParams.get("error");
    return code === "missing_password" ? copy.login.missingPassword : null;
  }, [copy.login.missingPassword, searchParams]);

  const redirectTo = useMemo(() => {
    const next = searchParams.get("next");

    if (!next || !next.startsWith("/") || next.startsWith("//")) {
      return "/editor";
    }

    return next;
  }, [searchParams]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          password,
          redirectTo
        })
      });

      const payload = (await response.json()) as { ok?: boolean; error?: string; redirectTo?: string };

      if (!response.ok || !payload.ok) {
        setErrorMessage(payload.error ?? copy.login.signInFailed);
        return;
      }

      window.location.assign(payload.redirectTo ?? redirectTo);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : copy.login.signInFailed);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <header className="auth-head">
          <p className="mono-ui auth-kicker">{copy.login.kicker}</p>
          <h1 className="auth-title">{copy.login.title}</h1>
        </header>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-field" htmlFor="auth-password">
            <span className="mono-ui settings-label">{copy.login.password}</span>
            <Input
              id="auth-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={copy.login.passwordPlaceholder}
              required
            />
          </label>

          {misconfigurationMessage ? (
            <p className="auth-error" role="alert">
              {misconfigurationMessage}
            </p>
          ) : null}

          {errorMessage ? (
            <p className="auth-error" role="alert">
              {errorMessage}
            </p>
          ) : null}

          <Button type="submit" variant="primary" loading={isSubmitting} loadingLabel={copy.login.submitting}>
            {copy.login.submit}
          </Button>
        </form>
      </section>
    </main>
  );
}

function LoginPageFallback() {
  return (
    <main className="auth-screen">
      <section className="auth-card">
        <header className="auth-head">
          <p className="mono-ui auth-kicker">Access</p>
          <h1 className="auth-title">Sign in</h1>
        </header>
      </section>
    </main>
  );
}
