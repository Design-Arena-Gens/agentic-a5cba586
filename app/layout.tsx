import "../styles/globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "Photo Checker",
  description: "Analyze your photos for quality and duplicates",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="container">
          <header className="header">
            <h1>Photo Checker</h1>
            <p className="subtitle">Upload photos to check sharpness, exposure, resolution, and duplicates.</p>
          </header>
          {children}
          <footer className="footer">Built for quick, local-only analysis. No uploads leave your browser.</footer>
        </div>
      </body>
    </html>
  );
}
