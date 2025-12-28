import { useEffect, useState } from "react";
import { ApiStep, DoneStep, PortStep, WelcomeStep } from "./Setup";
import "./App.css";

type Step = "welcome" | "port" | "api";
type StoredSetup = { port: number; apiKey: string; accountName?: string; setupComplete?: boolean };

const STORAGE_KEY = "tunneldash:setup";

function App() {
  const [step, setStep] = useState<Step>("welcome");
  const [port, setPort] = useState("50000");
  const [apiKey, setApiKey] = useState("");
  const [accountName, setAccountName] = useState<string | undefined>();
  const [done, setDone] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    try {
      const parsed: StoredSetup = JSON.parse(saved);
      if (parsed.port) setPort(String(parsed.port));
      if (parsed.apiKey) setApiKey(parsed.apiKey);
      setAccountName(parsed.accountName);
      if (parsed.setupComplete) {
        setDone(true);
        setVerified(true);
      } else {
        setStep("api");
      }
    } catch (e) {
      console.warn("Failed to read setup", e);
    }
  }, []);

  const steps: Step[] = ["welcome", "port", "api"];
  const isPortValid = (() => {
    const n = Number(port);
    return Number.isInteger(n) && n >= 1024 && n <= 65535;
  })();

  const persist = (data: Partial<StoredSetup>) => {
    const payload: StoredSetup = {
      port: Number(port),
      apiKey,
      accountName,
      setupComplete: done,
      ...data,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  };

  const verify = async () => {
    if (!apiKey.trim()) return;
    setError(null);
    setVerifying(true);
    setVerified(false);
    try {
      const res = await fetch("https://api.cloudflare.com/client/v4/accounts", {
        headers: { Authorization: `Bearer ${apiKey.trim()}` },
      });
      if (!res.ok) throw new Error("Could not reach Cloudflare");
      const body = await res.json();
      const accounts = body?.result ?? [];
      if (!body?.success || !Array.isArray(accounts) || accounts.length === 0) {
        throw new Error(body?.errors?.[0]?.message || "Invalid token");
      }
      setAccountName(accounts[0].name);
      setVerified(true);
      persist({ accountName: accounts[0].name });
      setTimeout(() => complete(), 500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setVerifying(false);
    }
  };

  const complete = () => {
    setDone(true);
    persist({ setupComplete: true });
  };

  const reset = () => {
    localStorage.removeItem(STORAGE_KEY);
    setStep("welcome");
    setPort("50000");
    setApiKey("");
    setAccountName(undefined);
    setVerified(false);
    setError(null);
    setDone(false);
  };

  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <span className="dot" />
          <div>
            <div className="brand-title">TunnelDash</div>
            <div className="brand-sub">Quick setup</div>
          </div>
        </div>
        {done && <button className="ghost" onClick={reset}>Reset</button>}
      </header>

      <section className="card">
        <div className="progress-text">Step {steps.indexOf(step) + 1} of {steps.length}</div>

        <div className="stage" key={`${step}-${done ? "done" : "setup"}`}>
          {!done ? (
            <>
              {step === "welcome" && <WelcomeStep onNext={() => setStep("port")} />}
              {step === "port" && (
                <PortStep
                  port={port}
                  onChange={(v) => setPort(v)}
                  onBack={() => setStep("welcome")}
                  onNext={() => setStep("api")}
                  valid={isPortValid}
                />
              )}
              {step === "api" && (
                <ApiStep
                  apiKey={apiKey}
                  onChange={(v) => {
                    setApiKey(v);
                    setVerified(false);
                    setError(null);
                  }}
                  onBack={() => setStep("port")}
                  onVerify={verify}
                  verifying={verifying}
                  verified={verified}
                  error={error}
                />
              )}
            </>
          ) : (
            <DoneStep port={port} accountName={accountName} onReset={reset} />
          )}
        </div>
      </section>
    </div>
  );
}

export default App;
