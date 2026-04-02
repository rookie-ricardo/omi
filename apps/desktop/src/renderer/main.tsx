import { ThemeProvider } from "@/ui/theme";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router-dom";

import { App } from "./routes";
import "./omiui/styles.css";
import "./styles.css";

const router = createBrowserRouter([
  {
    path: "*",
    element: <App />,
  },
]);

const queryClient = new QueryClient();
const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Renderer root element #root is missing.");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ThemeProvider defaultMode="system" defaultPresetId="default" applyToDocument>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
