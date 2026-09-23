import type { Metadata, Viewport } from "next";
import "../src/style.css";

export const metadata: Metadata = {
  title: "ECHO",
  description: "ECHO - every move you make comes back to haunt you.",
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' fill='black'/><circle cx='12' cy='16' r='6' fill='white'/><circle cx='21' cy='16' r='6' fill='none' stroke='%2300f0ff' stroke-width='2'/></svg>",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#000000",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}