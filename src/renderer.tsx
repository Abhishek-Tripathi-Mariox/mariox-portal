import { jsxRenderer } from 'hono/jsx-renderer'

export const renderer = jsxRenderer(({ children }) => {
  return (
    <html>
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="theme-color" content="#1A0E08" />
        <title>Mariox Software</title>
        <link rel="icon" type="image/jpeg" href="/static/images/mariox-logo.jpg" />
        <link rel="shortcut icon" type="image/jpeg" href="/static/images/mariox-logo.jpg" />
        <link rel="apple-touch-icon" href="/static/images/mariox-logo.jpg" />
        <link href="/static/style.css" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  )
})
