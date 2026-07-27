import type { Metadata } from "next";
import "./globals.css";

const title = "GDS2GOO · UV Masks for Elegoo Mars 4 9K";
const description = "Convert GDSII layouts into GOO exposure files for LCD photolithography, directly in your browser.";

export const metadata: Metadata = {
  metadataBase: new URL("https://jorpago2.github.io/gds2goo/"),
  title,
  description,
  icons: { icon: "favicon.svg", shortcut: "favicon.svg" },
  openGraph: { title, description, images: [{ url: "og.png", width: 1536, height: 1024 }] },
  twitter: { card: "summary_large_image", title, description, images: ["og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
