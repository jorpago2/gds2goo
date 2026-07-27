import type { Metadata } from "next";
import "./globals.css";

const title = "GDS2GOO · Máscaras UV para Elegoo Mars 4 9K";
const description = "Convierte layouts GDSII en archivos GOO de exposición para fotolitografía LCD, directamente en el navegador.";

export const metadata: Metadata = {
  metadataBase: new URL("https://jorpago2.github.io/gds2goo/"),
  title,
  description,
  icons: { icon: "favicon.svg", shortcut: "favicon.svg" },
  openGraph: { title, description, images: [{ url: "og.png", width: 1536, height: 1024 }] },
  twitter: { card: "summary_large_image", title, description, images: ["og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
