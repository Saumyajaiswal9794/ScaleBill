import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '../context/authContext';

export const metadata: Metadata = {
  title: 'ScaleBill Operator Dashboard',
  description: 'Live multi-tenant usage billing dashboard with tenant selection, metering, invoicing, and alerts',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
