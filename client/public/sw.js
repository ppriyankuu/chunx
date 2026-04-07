/* global self ReadableStream Response */

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim())
})

const map = new Map()

// This should be called once per download
// Each event has a dataChannel that the data will be piped through
self.onmessage = event => {
  if (event.data === 'ping') {
    return
  }

  const data = event.data
  
  // FIX 1: Catch 'pathname' since StreamSaver v2 dropped 'filename'
  const actualFileName = data.filename || (data.pathname ? data.pathname.split('/').pop() : 'download')
  const downloadUrl = data.url || self.registration.scope + Math.random() + '/' + actualFileName
  const port = event.ports[0]

  // FIX 2: Correctly pass the size so the browser knows it isn't a 1KB file!
  const metadata = new Array(3) 
  metadata[0] = data.size
  metadata[1] = actualFileName
  metadata[2] = downloadUrl

  if (data.readableStream) {
    map.set(downloadUrl, [data.readableStream, metadata])
  } else if (data.transferringReadable) {
    port.onmessage = evt => {
      port.onmessage = null
      map.set(downloadUrl, [evt.data, metadata])
    }
  } else {
    map.set(downloadUrl, [createStream(port), metadata])
  }

  port.postMessage({ download: downloadUrl })
}

function createStream (port) {
  // ReadableStream is only supported by chrome 52
  return new ReadableStream({
    start (controller) {
      // When we receive data on the messageChannel, we write
      // it to the stream
      port.onmessage = ({ data }) => {
        if (data === 'end') {
          return controller.close()
        }

        if (data === 'abort') {
          controller.error('Aborted the download')
          return
        }

        controller.enqueue(data)
      }
    },
    cancel () {
      console.log('user aborted')
    }
  })
}

self.addEventListener('fetch', event => {
  const url = event.request.url

  // Check if we have a stream for this URL
  const res = map.get(url)

  if (!res) {
    return null
  }

  map.delete(url)

  const [stream, data] = res
  const filename = typeof data === 'string' ? data : data[1]

  const headers = new Headers({
    'Content-Type': 'application/octet-stream',
    'Content-Security-Policy': "default-src 'none'",
    'X-Content-Security-Policy': "default-src 'none'",
    'X-WebKit-CSP': "default-src 'none'",
    'X-XSS-Protection': '1; mode=block'
  })
  // Set the Content-Disposition to force a download
  headers.set(
    'Content-Disposition',
    `attachment; filename="${decodeURIComponent(filename)}"`
  )

  // Provide the size if available (allows the browser to show a progress bar)
  if (data[0]) {
    headers.set('Content-Length', data[0])
  }

  event.respondWith(new Response(stream, { headers }))
})