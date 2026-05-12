import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SQLForge - AI SQL Generation Agent",
  description:
    "Enterprise-grade AI-powered SQL generation and conversion agent. Build, validate, and deploy BigQuery SQL with intelligent workflow automation.",
  keywords: [
    "SQLForge",
    "SQL generation",
    "BigQuery",
    "AI agent",
    "data engineering",
    "ETL",
  ],
  authors: [{ name: "SQLForge Team" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "SQLForge - AI SQL Generation Agent",
    description: "AI-powered SQL generation and conversion with intelligent workflow automation",
    url: "https://chat.z.ai",
    siteName: "SQLForge",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "SQLForge - AI SQL Generation Agent",
    description: "AI-powered SQL generation and conversion with intelligent workflow automation",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
