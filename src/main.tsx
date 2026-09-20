import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// macOS: Overlay title bar puts the traffic lights over the sidebar.
// navigator.platform is deprecated, so prefer the user-agent string.
const uaPlatform =
  (navigator as { userAgentData?: { platform?: string } }).userAgentData
    ?.platform ||
  navigator.platform ||
  navigator.userAgent;
const isMac = /Mac|iPhone|iPad|iPod/i.test(uaPlatform);
if (isMac) {
  document.documentElement.classList.add("mac");
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
