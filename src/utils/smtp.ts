// Generic SMTP sender — extracted verbatim from the working invoice mailer in
// src/routes/invoices.ts so leads / password-reset / etc. can send mail
// through the exact same protocol path that's already proven to deliver.

export interface SmtpEnv {
  SMTP_HOST?: string
  SMTP_PORT?: string | number
  SMTP_USER?: string
  SMTP_PASS?: string
  SMTP_FROM?: string
  SMTP_SECURE?: string
  SENDER_EMAIL?: string
  APP_PASSWORD?: string
  [key: string]: any
}

export interface SmtpMessage {
  to: string | string[]
  cc?: string | string[]
  subject: string
  html: string
  text: string
  fromName?: string
}

type SmtpReply = { code: number; lines: string[] }

function normalizeSmtpSecret(value: unknown) {
  return String(value || '').replace(/\s+/g, '').trim()
}

function getLastReplyLine(reply: SmtpReply) {
  return reply.lines[reply.lines.length - 1] || `SMTP replied with ${reply.code}`
}

function expectSmtp(reply: SmtpReply, allowed: number[], action: string) {
  if (!allowed.includes(reply.code)) {
    throw new Error(`${action} failed: ${getLastReplyLine(reply)}`)
  }
}

function parseReplyLine(line: string) {
  const match = line.match(/^(\d{3})([ -])(.*)$/)
  if (!match) return null
  const code = Number(match[1])
  const done = match[2] === ' '
  return { code, done, line }
}

function dotStuff(message: string) {
  return message
    .split('\r\n')
    .map((line) => (line.startsWith('.') ? '.' + line : line))
    .join('\r\n')
}

function buildMimeMessage(opts: {
  from: string
  to: string[]
  cc: string[]
  subject: string
  html: string
  text: string
}) {
  const boundary = `devportal-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const headers = [
    `From: ${opts.from}`,
    `To: ${opts.to.join(', ')}`,
    opts.cc.length ? `Cc: ${opts.cc.join(', ')}` : '',
    `Subject: ${opts.subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ]
    .filter(Boolean)
    .join('\r\n')

  const body = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    opts.text,
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    opts.html,
    `--${boundary}--`,
    '',
  ].join('\r\n')

  return `${headers}\r\n\r\n${body}`
}

function asList(value: string | string[] | undefined): string[] {
  if (!value) return []
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean)
  return String(value)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
}

// Send an email via SMTP. Mirrors sendInvoiceViaSmtp in src/routes/invoices.ts
// step-for-step so any caller benefits from the same protocol behaviour.
export async function sendSmtpEmail(env: SmtpEnv, message: SmtpMessage) {
  const brandName = message.fromName || 'Mariox Software Pvt Ltd'
  const user = env.SMTP_USER?.trim() || env.SENDER_EMAIL?.trim()
  const pass = normalizeSmtpSecret(env.SMTP_PASS || env.APP_PASSWORD)
  const host = env.SMTP_HOST?.trim() || (user ? 'smtp.gmail.com' : '')
  if (!host || !user || !pass) {
    throw new Error('SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASS (or SENDER_EMAIL and APP_PASSWORD) are required')
  }

  const port = Number(env.SMTP_PORT || 587)
  const secure = env.SMTP_SECURE === 'true' || port === 465
  const from = env.SMTP_FROM?.trim() || env.SENDER_EMAIL?.trim() || user
  const localName = 'devportal.local'
  const to = asList(message.to)
  const cc = asList(message.cc)
  const recipients = [...to, ...cc]
  if (!recipients.length) {
    throw new Error('At least one recipient email is required')
  }

  const net = await import('node:net')
  const tls = await import('node:tls')
  type NodeSocket = import('node:net').Socket | import('node:tls').TLSSocket

  let socket: NodeSocket = secure
    ? tls.connect({ host, port, servername: host })
    : net.connect({ host, port })

  await new Promise<void>((resolve, reject) => {
    const readyEvent = secure ? 'secureConnect' : 'connect'
    socket.once(readyEvent, () => resolve())
    socket.once('error', reject)
  })

  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''

  const cleanup = async () => {
    try { socket.removeAllListeners() } catch {}
    try { socket.end() } catch {}
    try { socket.destroy() } catch {}
  }

  const readSmtpReply = async (): Promise<SmtpReply> => {
    return new Promise((resolve, reject) => {
      const onError = (error: Error) => {
        cleanup().finally(() => reject(error))
      }
      const lines: string[] = []

      const onData = (chunk: Uint8Array) => {
        buffer += decoder.decode(chunk, { stream: true })

        while (true) {
          const newlineIndex = buffer.indexOf('\n')
          if (newlineIndex < 0) break

          const rawLine = buffer.slice(0, newlineIndex).replace(/\r$/, '')
          buffer = buffer.slice(newlineIndex + 1)
          if (!rawLine) continue

          lines.push(rawLine)
          const reply = parseReplyLine(rawLine)
          if (reply && reply.done) {
            socket.off('data', onData)
            socket.off('error', onError)
            resolve({ code: reply.code, lines })
            return
          }
        }
      }

      socket.on('data', onData)
      socket.once('error', onError)
    })
  }

  const sendCommand = async (command: string, allowed: number[], action: string) => {
    await new Promise<void>((resolve, reject) => {
      socket.write(encoder.encode(command + '\r\n'), (error) => (error ? reject(error) : resolve()))
    })
    const reply = await readSmtpReply()
    if (!allowed.includes(reply.code)) {
      throw new Error(`${action} failed: ${getLastReplyLine(reply)}`)
    }
    return reply
  }

  try {
    let reply = await readSmtpReply()
    expectSmtp(reply, [220], 'SMTP greeting')

    reply = await sendCommand(`EHLO ${localName}`, [250], 'EHLO')

    if (!secure) {
      const hasStartTls = reply.lines.some((line) => /STARTTLS/i.test(line))
      if (!hasStartTls) {
        throw new Error('SMTP server does not offer STARTTLS')
      }
      await sendCommand('STARTTLS', [220], 'STARTTLS')
      const secureSocket: NodeSocket = tls.connect({
        socket: socket as import('node:net').Socket,
        servername: host,
      })
      await new Promise<void>((resolve, reject) => {
        secureSocket.once('secureConnect', () => resolve())
        secureSocket.once('error', reject)
      })
      socket = secureSocket
      buffer = ''
      reply = await sendCommand(`EHLO ${localName}`, [250], 'EHLO after STARTTLS')
      expectSmtp(reply, [250], 'EHLO after STARTTLS')
    }

    await sendCommand('AUTH LOGIN', [334], 'SMTP auth start')
    await sendCommand(btoa(user), [334], 'SMTP username')
    await sendCommand(btoa(pass), [235], 'SMTP password')

    await sendCommand(`MAIL FROM:<${from}>`, [250], 'MAIL FROM')
    for (const recipient of recipients) {
      await sendCommand(`RCPT TO:<${recipient}>`, [250, 251], `RCPT TO ${recipient}`)
    }

    await sendCommand('DATA', [354], 'DATA')

    const mime = buildMimeMessage({
      from: `${brandName} <${from}>`,
      to,
      cc,
      subject: message.subject,
      html: message.html,
      text: message.text,
    })

    await new Promise<void>((resolve, reject) => {
      socket.write(encoder.encode(dotStuff(mime) + '\r\n.\r\n'), (error) =>
        error ? reject(error) : resolve(),
      )
    })
    reply = await readSmtpReply()
    expectSmtp(reply, [250], 'SMTP message delivery')

    await new Promise<void>((resolve, reject) => {
      socket.write(encoder.encode('QUIT\r\n'), (error) => (error ? reject(error) : resolve()))
    })
    try { await readSmtpReply() } catch {}

    return { from, recipients, provider: 'smtp' }
  } finally {
    await cleanup()
  }
}
