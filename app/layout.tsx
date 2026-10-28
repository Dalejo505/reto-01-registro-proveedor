import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Registro de proveedores · Periferia',
  description: 'Asistente para preparar registros como proveedor.'
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>
}
