"use client";

import { ArrowRight, Bot, Network, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui";

export function AuthScreen({ reason }: { reason?: string }) {
  const startSignIn = () => {
    window.location.assign("/api/auth/login");
  };

  return (
    <main className="auth-screen">
      <section className="auth-brand" aria-labelledby="auth-title">
        <div className="brand-mark brand-mark--large" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="auth-brand__copy">
          <p className="auth-wordmark">RELAY</p>
          <h1 id="auth-title">One room.<br />Every intelligence.</h1>
          <p>
            Run specialized AI agents together, let them challenge each other, and stay in control of
            every round.
          </p>
        </div>

        <div className="auth-orbit" aria-hidden="true">
          <div className="auth-orbit__ring auth-orbit__ring--one" />
          <div className="auth-orbit__ring auth-orbit__ring--two" />
          <span className="auth-orbit__node auth-orbit__node--one"><Bot size={19} /></span>
          <span className="auth-orbit__node auth-orbit__node--two"><Network size={19} /></span>
          <span className="auth-orbit__node auth-orbit__node--three"><Sparkles size={19} /></span>
          <span className="auth-orbit__core">R</span>
        </div>

        <p className="auth-brand__footnote">Continuous collaboration, operator controlled.</p>
      </section>

      <section className="auth-access" aria-label="Sign in">
        <div className="auth-access__inner">
          <p className="eyebrow">Operator access</p>
          <h2>Enter your workspace</h2>
          <p className="auth-access__description">
            Sign in with your organization account to manage providers, agents, and live sessions.
          </p>
          {reason ? <p className="auth-access__reason">{reason}</p> : null}
          <Button
            variant="primary"
            className="auth-access__button"
            icon={<ArrowRight size={17} />}
            onClick={startSignIn}
          >
            Continue to Relay
          </Button>
          <div className="auth-security">
            <ShieldCheck aria-hidden="true" size={17} />
            <span>Credentials remain encrypted and are never shown after setup.</span>
          </div>
        </div>
        <p className="auth-legal">By continuing, you agree to your workspace security policy.</p>
      </section>
    </main>
  );
}

export function AppLoadingScreen() {
  return (
    <main className="boot-screen" aria-label="Loading Relay">
      <div className="brand-mark brand-mark--large" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p>RELAY</p>
      <span className="boot-screen__signal" />
      <span className="sr-only">Opening your workspace…</span>
    </main>
  );
}
