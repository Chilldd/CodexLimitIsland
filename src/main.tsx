import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { getPreviewMode } from "./hooks/useDebugPresentation";

const previewMode = getPreviewMode();
const PreviewGallery = previewMode ? lazy(() => import("./components/PreviewGallery")) : null;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {PreviewGallery && previewMode ? (
      <Suspense fallback={null}>
        <PreviewGallery initialMode={previewMode} />
      </Suspense>
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
