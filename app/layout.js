import "./globals.css";

export const metadata = {
  title: "Clarivore",
  description: "Clarivore web app (Next.js scaffold).",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
