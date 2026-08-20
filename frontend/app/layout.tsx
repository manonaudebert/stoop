import type { Metadata } from "next";
import { Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import Providers from "@/components/Providers";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://stoopcity.org"),
  title: "stoop",
  description: "NYC housing data, finally built for tenants.",
  openGraph: {
    title: "stoop",
    description: "Before you sign a lease, search any NYC address for open violations, complaint trends, and how a building compares to its neighbors.",
    url: "https://stoopcity.org/",
    siteName: "stoop",
    images: [
      {
        url: "https://stoopcity.org/ogimage.png",
        width: 1200,
        height: 630,
        alt: "stoop: NYC building complaint and violation history",
      },
    ],
    type: "website",
  }
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <style>{`
          .log-table-wrap { display: block; }
          .log-cards-wrap { display: none; }
          @media (max-width: 640px) {
            .log-table-wrap { display: none !important; }
            .log-cards-wrap { display: block !important; }
          }
        `}</style>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
