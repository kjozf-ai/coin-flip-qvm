import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Force Deep Space dark mode always
document.documentElement.classList.add("dark");

if (!window.location.hash) {
  window.location.hash = "#/";
}

createRoot(document.getElementById("root")!).render(<App />);
