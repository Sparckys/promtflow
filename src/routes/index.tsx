import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Index,
});

// La landing de PromptFlow es HTML estático: vive en public/landing.html (con sus
// imágenes en public/img y videos en public/video). La misma página se publica en
// GitHub Pages desde docs/. Aquí se muestra a pantalla completa.
function Index() {
  return (
    <iframe
      src="/landing.html"
      title="PromptFlow"
      style={{ position: "fixed", inset: 0, width: "100%", height: "100%", border: 0 }}
    />
  );
}
