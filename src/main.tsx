import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { GlobalTheme } from "@carbon/react";
import "./carbon.scss";
import "./styles.css";
import "@jorpago2/scientific-ui/styles.css";
import App from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
document.documentElement.classList.add("cds--g10");

const app = <StrictMode><GlobalTheme theme="g10"><App /></GlobalTheme></StrictMode>;
if (root.childElementCount) hydrateRoot(root, app);
else createRoot(root).render(app);
