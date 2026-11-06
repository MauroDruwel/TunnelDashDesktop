import { useCallback, useEffect, useState } from "react";

export function useQuickSearch(openTunnels: () => void, activeTab: string, enabled: boolean) {
  const [requested, setRequested] = useState(false);
  const search = useCallback(() => {
    if (!enabled) return;
    if (activeTab === "settings") openTunnels();
    setRequested(true);
  }, [activeTab, enabled, openTunnels]);

  useEffect(() => {
    if (!requested || activeTab === "settings") return;
    document.querySelector<HTMLInputElement>("main .cf-search-input")?.focus();
    setRequested(false);
  }, [activeTab, requested]);

  return search;
}
