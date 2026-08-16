import { useState } from "react";
import { ApiStep, PortStep, SetupStep, WelcomeStep } from "./setup/Steps";
import { Settings } from "./types";
import { CloudflareLogo } from "./components/icons";

export function SetupScreen({
  settings,
  save,
  verify,
  verifying,
  verified,
  error,
  setError,
  isPortValid,
}: {
  settings: Settings;
  save: (data: Partial<Settings & { verified?: boolean }>) => void;
  verify: () => Promise<void>;
  verifying: boolean;
  verified: boolean;
  error: string | null;
  setError: (v: string | null) => void;
  isPortValid: boolean;
}) {
  const [setupStep, setSetupStep] = useState<SetupStep>(() => {
    const step = new URLSearchParams(window.location.search).get("step");
    return step === "port" || step === "api" ? step : "welcome";
  });

  const stepOrder: SetupStep[] = ["welcome", "port", "api"];
  const currentStepIndex = stepOrder.indexOf(setupStep);

  if (verified) return null;

  return (
    <div className="cf-setup-container">
      <div className="cf-setup-card">
        {/* Brand Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <CloudflareLogo size={24} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>TunnelDash</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Cloudflare Zero Trust Setup</div>
          </div>
        </div>

        {/* Stepper Header */}
        <div className="cf-setup-stepper">
          <div className={`cf-step-item ${currentStepIndex === 0 ? "active" : ""}`}>
            <span className="cf-step-num">1</span>
            <span>Welcome</span>
          </div>

          <div className="cf-step-line" />

          <div className={`cf-step-item ${currentStepIndex === 1 ? "active" : ""}`}>
            <span className="cf-step-num">2</span>
            <span>Port</span>
          </div>

          <div className="cf-step-line" />

          <div className={`cf-step-item ${currentStepIndex === 2 ? "active" : ""}`}>
            <span className="cf-step-num">3</span>
            <span>API Token</span>
          </div>
        </div>

        {/* Step Contents */}
        {setupStep === "welcome" && <WelcomeStep onNext={() => setSetupStep("port")} />}

        {setupStep === "port" && (
          <PortStep
            port={settings.portStart}
            onChange={(v) => save({ portStart: v })}
            onBack={() => setSetupStep("welcome")}
            onNext={() => setSetupStep("api")}
            valid={isPortValid}
          />
        )}

        {setupStep === "api" && (
          <ApiStep
            apiKey={settings.apiKey}
            onChange={(v) => {
              setError(null);
              save({ apiKey: v, verified: false });
            }}
            onBack={() => setSetupStep("port")}
            onVerify={() => verify().then(() => setSetupStep("api"))}
            verifying={verifying}
            verified={verified}
            error={error}
          />
        )}
      </div>
    </div>
  );
}

export { WelcomeStep, PortStep, ApiStep, DoneStep } from "./setup/Steps";
export type { SetupStep } from "./setup/Steps";
