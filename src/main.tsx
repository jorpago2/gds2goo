import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { ScientificUiProvider } from "@jorpago2/scientific-ui";
import "./carbon.scss";
import "./styles.css";
import "@jorpago2/scientific-ui/styles.css";
import App from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
const app = <StrictMode><ScientificUiProvider><App /></ScientificUiProvider></StrictMode>;
if (root.childElementCount) hydrateRoot(root, app);
else createRoot(root).render(app);
