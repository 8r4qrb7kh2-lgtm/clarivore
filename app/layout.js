import "./globals.css";
import Providers from "./providers";

export const metadata = {
  title: "Clarivore",
  description: "Clarivore web app (Next.js scaffold).",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head />
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
