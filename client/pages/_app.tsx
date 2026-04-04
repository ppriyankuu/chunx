import type { AppProps } from 'next/app'
import { useEffect } from 'react'
import '../styles/globals.css'

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    // Dynamically import StreamSaver so it ONLY runs in the browser
    import('streamsaver').then((module) => {
      const streamSaver = module.default || module;
      streamSaver.mitm = '/mitm.html';
    });
  }, []);

  return <Component {...pageProps} />
}