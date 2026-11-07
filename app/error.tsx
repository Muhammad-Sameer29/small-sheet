"use client";

// Last line of defence: if rendering itself crashes, say so plainly and offer a way back.
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main style={{ display: "grid", placeItems: "center", height: "100dvh", padding: 24, textAlign: "center" }}>
      <div>
        <h1 style={{ fontSize: 20, margin: 0 }}>Something went wrong</h1>
        <p style={{ color: "var(--text-2)", maxWidth: 380 }}>
          The page hit an error it couldn't recover from. Your unsaved edits are kept on this device and will be sent when the sheet reopens.
        </p>
        <button
          onClick={reset}
          style={{ height: 32, padding: "0 12px", borderRadius: 6, border: 0, background: "var(--accent)", color: "var(--accent-text)", fontWeight: 600 }}
        >
          Reload the sheet
        </button>
      </div>
    </main>
  );
}
