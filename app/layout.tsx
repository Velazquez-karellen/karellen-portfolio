import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Kare Platform",
  description: "Backend foundation for Kare Studio and the public portfolio.",
  other: {
    "codex-preview": "development",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
