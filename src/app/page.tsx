import EditorApp from "./editor-app";

// Rendered per request (not prerendered); the editor itself runs entirely in the browser.
export const dynamic = "force-dynamic";

export default function EditorPage() {
  return <EditorApp />;
}
