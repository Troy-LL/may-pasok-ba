import type { Metadata } from "next";
import { Anton, Geist } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const anton = Anton({
  variable: "--font-anton",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://may-pasok-ba.niched.tech"),
  applicationName: "May Pasok Ba?",
  title: {
    default: "May Pasok Ba?",
    template: "%s · May Pasok Ba?",
  },
  description:
    "Class, work, and government service suspensions from Philippine local news. WALA or MERON.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "fil_PH",
    url: "/",
    siteName: "May Pasok Ba?",
    title: "May Pasok Ba? WALA o MERON",
    description:
      "Check class, work, and government suspensions using Philippine local news evidence.",
  },
  twitter: {
    card: "summary_large_image",
    title: "May Pasok Ba? WALA o MERON",
    description:
      "Check class, work, and government suspensions using Philippine local news evidence.",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="fil"
      className={`${geistSans.variable} ${anton.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-paper text-ink">{children}</body>
    </html>
  );
}
