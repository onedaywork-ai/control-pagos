import type { Metadata } from "next";
import "./pilot.css";

export const metadata: Metadata = {
  title: "Scaffidi Control · Control diario de alquileres",
  description: "Cobros de alquileres, fechas, ventanas de pago y estado de actualización.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es-AR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
