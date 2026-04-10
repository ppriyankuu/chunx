import type { AppProps } from 'next/app'
import '../styles/globals.css'
import { BeamsBackground } from '@/components/ui/beams-background'

export default function App({ Component, pageProps }: AppProps) {
  return (
    <div className="dark text-foreground bg-background">
      <BeamsBackground intensity="strong">
        <Component {...pageProps} />
      </BeamsBackground>
    </div>
  )
}