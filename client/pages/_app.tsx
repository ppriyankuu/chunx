import type { AppProps } from 'next/app'
import { useEffect } from 'react'
import streamSaver from 'streamsaver'
import '../styles/globals.css' // Keeps your default Next.js styling

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    // This tells StreamSaver where our hidden service worker is
    streamSaver.mitm = '/mitm.html'
  }, [])

  return <Component {...pageProps} />
}