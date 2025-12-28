import { useState } from "react";
import { ApiStep, PortStep, SetupStep, WelcomeStep } from "./setup/Steps";
import { Settings } from "./types";

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
  const [setupStep, setSetupStep] = useState<SetupStep>("welcome");
  const stepIndex = ["welcome", "port", "api"].indexOf(setupStep) + 1;

  if (verified) return null;

  return (
    <div className="setup-screen">
      <div className="card setup-card">
        <div className="progress-text">Step {stepIndex} of 3</div>
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
