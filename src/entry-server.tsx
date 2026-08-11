import { renderToString } from "react-dom/server";
import { ScientificUiProvider } from "@jorpago2/scientific-ui";
import App from "./App";

export function render(): string {
  return renderToString(<ScientificUiProvider><App /></ScientificUiProvider>);
}
