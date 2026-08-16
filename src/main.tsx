import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// macOS: Overlay title bar puts the traffic lights over the sidebar.
if (/Mac|iPhone|iPad/.test(navigator.platform)) {
  document.documentElement.classList.add("mac");
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
