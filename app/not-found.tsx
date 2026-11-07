import Link from "next/link";

export default function NotFound() {
  return (
    <main style={{ display: "grid", placeItems: "center", height: "100dvh", padding: 24, textAlign: "center" }}>
      <div>
        <h1 style={{ fontSize: 20, margin: 0 }}>This page doesn't exist</h1>
        <p style={{ color: "var(--text-2)" }}>Sheets live at addresses like /s/budget.</p>
        <Link href="/" style={{ color: "var(--accent)", fontWeight: 600 }}>
          Go to your sheets
        </Link>
      </div>
    </main>
  );
}
