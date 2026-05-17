import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "SQL Curator - AI SQL Generation Agent",
  description:
    "Enterprise-grade AI-powered SQL generation and conversion agent. Build, validate, and deploy BigQuery SQL with intelligent workflow automation.",
  keywords: [
    "SQL Curator",
    "SQL generation",
    "BigQuery",
    "AI agent",
    "data engineering",
    "ETL",
  ],
  authors: [{ name: "SQL Curator Team" }],
  openGraph: {
    title: "SQL Curator - AI SQL Generation Agent",
    description: "AI-powered SQL generation and conversion with intelligent workflow automation",
    siteName: "SQL Curator",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "SQL Curator - AI SQL Generation Agent",
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
        className="antialiased bg-background text-foreground"
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
