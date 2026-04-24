import { Hono } from 'hono'
import { verify } from 'hono/jwt'

type EmailBinding = {
  send: (message: {
    to: string | string[]
    from: string | { email: string; name?: string }
    subject: string
    html?: string
    text?: string
    cc?: string | string[]
    bcc?: string | string[]
    replyTo?: string | { email: string; name?: string }
  }) => Promise<unknown>
}

type Bindings = {
  DB: D1Database
  JWT_SECRET: string
  EMAIL?: EmailBinding
  SENDER_EMAIL?: string
  APP_PASSWORD?: string
  SMTP_HOST?: string
  SMTP_PORT?: string
  SMTP_USER?: string
  SMTP_PASS?: string
  SMTP_FROM?: string
  SMTP_SECURE?: string
}
type Variables = { user: any }

const invoices = new Hono<{ Bindings: Bindings; Variables: Variables }>()

invoices.use('*', async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401)
  try {
    const payload = await verify(authHeader.slice(7), c.env.JWT_SECRET, 'HS256') as any
    c.set('user', payload); await next()
  } catch { return c.json({ error: 'Invalid token' }, 401) }
})

const invoiceQuery = `
  SELECT i.*, 
    p.name as project_name, p.code as project_code,
    cl.company_name, cl.contact_name, cl.email as client_email, cl.avatar_color as client_color,
    m.title as milestone_title,
    u.full_name as created_by_name
  FROM invoices i
  LEFT JOIN projects p ON i.project_id=p.id
  LEFT JOIN clients cl ON i.client_id=cl.id
  LEFT JOIN milestones m ON i.milestone_id=m.id
  LEFT JOIN users u ON i.created_by=u.id
`

function escapeHtml(value: any) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function parseEmailList(value: unknown) {
  return String(value || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean)
}

function normalizeSmtpSecret(value: unknown) {
  return String(value || '').replace(/\s+/g, '').trim()
}

function formatInvoiceCurrency(amount: number, currency = 'INR') {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(Number(amount || 0))
}

function buildInvoiceEmail(inv: any) {
  const brandName = 'Mariox Software Pvt Ltd'
  const amount = formatInvoiceCurrency(inv.amount, inv.currency)
  const taxAmount = formatInvoiceCurrency(inv.tax_amount, inv.currency)
  const totalAmount = formatInvoiceCurrency(inv.total_amount, inv.currency)
  const paidAmount = formatInvoiceCurrency(inv.paid_amount || 0, inv.currency)
  const notes = inv.notes ? escapeHtml(inv.notes).replace(/\n/g, '<br/>') : 'No additional notes'
  const terms = inv.payment_terms ? escapeHtml(inv.payment_terms) : 'Net 30 days'
  const description = inv.description ? escapeHtml(inv.description).replace(/\n/g, '<br/>') : 'Invoice details attached below.'
  const dueDate = escapeHtml(inv.due_date)
  const issueDate = escapeHtml(inv.issue_date)
  const invoiceNumber = escapeHtml(inv.invoice_number)
  const title = escapeHtml(inv.title)
  const projectName = escapeHtml(inv.project_name || '—')
  const companyName = escapeHtml(inv.company_name || '—')
  const contactName = escapeHtml(inv.contact_name || '—')
  const status = escapeHtml(String(inv.status || 'pending').replace('_', ' '))
  const senderLine = `${brandName} • Invoice ${invoiceNumber}`

  const html = `
    <div style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
        <tr>
          <td align="center" style="padding:24px 12px">
            <table role="presentation" width="720" cellspacing="0" cellpadding="0" style="width:720px;max-width:100%;border-collapse:collapse;background:#fff;border:1px solid #cfd4dc">
              <tr>
                <td style="padding:28px 30px 20px 30px">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
                    <tr>
                      <td valign="top" style="width:58%;padding-right:20px">
                        <div style="font-size:21px;font-weight:700;line-height:1.2;color:#111827">${brandName}</div>
                        <div style="margin-top:10px;font-size:13px;line-height:1.55;color:#374151">
                          <div>${escapeHtml(fromEmailFallback(inv))}</div>
                          <div>Invoice mailer for client billing</div>
                        </div>
                      </td>
                      <td valign="top" align="right" style="width:42%">
                        <div style="font-size:34px;font-weight:700;letter-spacing:.03em;color:#9ca3af;line-height:1">INVOICE</div>
                        <table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-top:18px;border:1px solid #9ca3af">
                          <tr>
                            <td style="padding:5px 10px;background:#e5e7eb;border-right:1px solid #9ca3af;font-size:11px;font-weight:700;color:#111827;text-align:center">INVOICE #</td>
                            <td style="padding:5px 10px;background:#e5e7eb;font-size:11px;font-weight:700;color:#111827;text-align:center">DATE</td>
                          </tr>
                          <tr>
                            <td style="padding:7px 10px;border-top:1px solid #9ca3af;border-right:1px solid #9ca3af;font-size:12px;color:#111827;text-align:center;white-space:nowrap">${invoiceNumber}</td>
                            <td style="padding:7px 10px;border-top:1px solid #9ca3af;font-size:12px;color:#111827;text-align:center;white-space:nowrap">${issueDate}</td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:0 30px 8px 30px">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
                    <tr>
                      <td valign="top" style="width:50%;padding-right:18px">
                        <div style="display:inline-block;background:#e5e7eb;border:1px solid #9ca3af;padding:6px 12px;font-size:12px;font-weight:700;color:#111827">BILL TO</div>
                        <div style="margin-top:10px;font-size:13px;line-height:1.55;color:#111827">
                          <div style="font-size:17px;font-weight:700;line-height:1.25">${companyName}</div>
                          <div>${contactName}</div>
                          <div>${escapeHtml(inv.client_email || '')}</div>
                        </div>
                      </td>
                      <td valign="top" align="right" style="width:50%;font-size:13px;line-height:1.6;color:#374151">
                        <div><span style="color:#6b7280">Project:</span> <strong style="color:#111827">${projectName}</strong></div>
                        <div><span style="color:#6b7280">Issue Date:</span> ${issueDate}</div>
                        <div><span style="color:#6b7280">Due Date:</span> ${dueDate}</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:18px 30px 0 30px">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #9ca3af">
                    <tr>
                      <td style="padding:8px 10px;background:#e5e7eb;border-right:1px solid #9ca3af;font-size:12px;font-weight:700;color:#111827">DESCRIPTION</td>
                      <td style="padding:8px 10px;background:#e5e7eb;font-size:12px;font-weight:700;color:#111827;text-align:right">AMOUNT</td>
                    </tr>
                    <tr>
                      <td style="padding:12px 12px;border-top:1px solid #9ca3af;border-right:1px solid #9ca3af;font-size:13px;line-height:1.55;color:#111827">
                        <div style="font-weight:700">${title}</div>
                        <div style="margin-top:4px;color:#374151">${description}</div>
                      </td>
                      <td valign="top" style="padding:12px 12px;border-top:1px solid #9ca3af;font-size:13px;color:#111827;text-align:right;white-space:nowrap">${amount}</td>
                    </tr>
                    <tr>
                      <td style="padding:10px 12px;border-top:1px solid #9ca3af;border-right:1px solid #9ca3af;text-align:right;font-size:13px;font-weight:700;color:#111827">TOTAL</td>
                      <td style="padding:10px 12px;border-top:1px solid #9ca3af;font-size:13px;font-weight:700;color:#111827;text-align:right;white-space:nowrap">${totalAmount}</td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:16px 30px 0 30px">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
                    <tr>
                      <td style="width:25%;border:1px solid #d1d5db;padding:10px 12px;font-size:12px;color:#6b7280;vertical-align:top">TAX</td>
                      <td style="width:25%;border:1px solid #d1d5db;border-left:0;padding:10px 12px;font-size:16px;font-weight:700;color:#111827;vertical-align:top;white-space:nowrap">${taxAmount}</td>
                      <td style="width:25%;border:1px solid #d1d5db;border-left:0;padding:10px 12px;font-size:12px;color:#6b7280;vertical-align:top">STATUS</td>
                      <td style="width:25%;border:1px solid #d1d5db;border-left:0;padding:10px 12px;font-size:16px;font-weight:700;color:#b45309;vertical-align:top">${status}</td>
                    </tr>
                    <tr>
                      <td style="border:1px solid #d1d5db;border-top:0;padding:10px 12px;font-size:12px;color:#6b7280;vertical-align:top">PAID</td>
                      <td style="border:1px solid #d1d5db;border-left:0;border-top:0;padding:10px 12px;font-size:16px;font-weight:700;color:#111827;vertical-align:top;white-space:nowrap">${paidAmount}</td>
                      <td style="border:1px solid #d1d5db;border-left:0;border-top:0;padding:10px 12px;font-size:12px;color:#6b7280;vertical-align:top">PROJECT</td>
                      <td style="border:1px solid #d1d5db;border-left:0;border-top:0;padding:10px 12px;font-size:16px;font-weight:700;color:#111827;vertical-align:top">${projectName}</td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:16px 30px 0 30px">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
                    <tr>
                      <td style="border:1px solid #d1d5db;padding:12px 14px;font-size:13px;line-height:1.7;color:#374151">
                        <div style="font-weight:700;color:#111827;margin-bottom:4px">Payment Terms</div>
                        <div>${terms}</div>
                      </td>
                    </tr>
                    <tr>
                      <td style="border:1px solid #d1d5db;border-top:0;padding:12px 14px;font-size:13px;line-height:1.7;color:#374151">
                        <div style="font-weight:700;color:#111827;margin-bottom:4px">Notes</div>
                        <div>${notes}</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:18px 30px 24px 30px;text-align:center;font-style:italic;font-size:12px;color:#6b7280">Thank you for your business!</td>
              </tr>
              <tr>
                <td style="padding:18px 30px 28px 30px;border-top:1px solid #e5e7eb;text-align:center;font-size:12px;line-height:1.7;color:#6b7280">
                  If you have any questions about this invoice, please contact<br/>
                  <strong style="color:#111827">${brandName}</strong><br/>
                  ${escapeHtml(fromEmailFallback(inv))}
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  `

  const text = [
    `${brandName}`,
    `Invoice ${invoiceNumber}`,
    `Title: ${inv.title || ''}`,
    `Client: ${inv.company_name || ''}`,
    `Contact: ${inv.contact_name || ''}`,
    `Client Email: ${inv.client_email || ''}`,
    `Project: ${inv.project_name || ''}`,
    `Issue Date: ${inv.issue_date || ''}`,
    `Due Date: ${inv.due_date || ''}`,
    `Description: ${inv.description || ''}`,
    `Amount: ${amount}`,
    `Tax: ${taxAmount}`,
    `Total: ${totalAmount}`,
    `Paid: ${paidAmount}`,
    `Status: ${String(inv.status || 'pending').replace('_', ' ')}`,
    `Payment Terms: ${inv.payment_terms || 'Net 30 days'}`,
    `Notes: ${inv.notes || 'No additional notes'}`,
    `Sender: ${brandName}`,
  ].join('\n')

  return { html, text }
}

function fromEmailFallback(inv: any) {
  return escapeHtml(String(inv?.sender_email || 'abhishek@marioxsoftware.com'))
}

type SmtpReply = { code: number; lines: string[] }

function getLastReplyLine(reply: SmtpReply) {
  return reply.lines[reply.lines.length - 1] || `SMTP replied with ${reply.code}`
}

function expectSmtp(reply: SmtpReply, allowed: number[], action: string) {
  if (!allowed.includes(reply.code)) {
    throw new Error(`${action} failed: ${getLastReplyLine(reply)}`)
  }
}

async function readSmtpReply(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<SmtpReply> {
  const decoder = new TextDecoder()
  let buffer = ''
  const lines: string[] = []
  let code = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let newlineIndex = buffer.indexOf('\n')
    while (newlineIndex >= 0) {
      const rawLine = buffer.slice(0, newlineIndex).replace(/\r$/, '')
      buffer = buffer.slice(newlineIndex + 1)
      newlineIndex = buffer.indexOf('\n')

      if (!rawLine) continue
      lines.push(rawLine)
      const match = rawLine.match(/^(\d{3})([ -])(.*)$/)
      if (match) {
        code = Number(match[1])
        if (match[2] === ' ') return { code, lines }
      }
    }
  }

  throw new Error('SMTP connection closed unexpectedly')
}

function dotStuff(message: string) {
  return message
    .split('\r\n')
    .map(line => line.startsWith('.') ? '.' + line : line)
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
  ].filter(Boolean).join('\r\n')

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

async function sendInvoiceViaSmtp(env: Bindings, invoice: any, to: string[], cc: string[], subject: string, html: string, text: string) {
  const brandName = 'Mariox Software Pvt Ltd'
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

  function parseReplyLine(line: string) {
    const match = line.match(/^(\d{3})([ -])(.*)$/)
    if (!match) return null
    const code = Number(match[1])
    const done = match[2] === ' '
    return { code, done, line }
  }

  const sendCommand = async (command: string, allowed: number[], action: string) => {
    await new Promise<void>((resolve, reject) => {
      socket.write(encoder.encode(command + '\r\n'), error => error ? reject(error) : resolve())
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
      const hasStartTls = reply.lines.some(line => /STARTTLS/i.test(line))
      if (!hasStartTls) {
        throw new Error('SMTP server does not offer STARTTLS')
      }
      await sendCommand('STARTTLS', [220], 'STARTTLS')
      const secureSocket: NodeSocket = tls.connect({ socket: socket as import('node:net').Socket, servername: host })
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
      subject,
      html,
      text,
    })

    await new Promise<void>((resolve, reject) => {
      socket.write(encoder.encode(dotStuff(mime) + '\r\n.\r\n'), error => error ? reject(error) : resolve())
    })
    reply = await readSmtpReply()
    expectSmtp(reply, [250], 'SMTP message delivery')

    await new Promise<void>((resolve, reject) => {
      socket.write(encoder.encode('QUIT\r\n'), error => error ? reject(error) : resolve())
    })
    try { await readSmtpReply() } catch {}

    return {
      from,
      recipients,
      provider: 'smtp',
      invoice_number: invoice.invoice_number,
    }
  } finally {
    await cleanup()
  }
}

// GET /api/invoices?project_id=&client_id=&status=
invoices.get('/', async (c) => {
  try {
    const { project_id, client_id, status } = c.req.query()
    const user = c.get('user')
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '10', 10) || 10))
    const offset = (page - 1) * limit
    let where = ' WHERE 1=1'
    const params: any[] = []
    if (project_id) { where += ' AND i.project_id=?'; params.push(project_id) }
    if (client_id) { where += ' AND i.client_id=?'; params.push(client_id) }
    if (status) { where += ' AND i.status=?'; params.push(status) }
    // Developers get no invoices
    if (user.role === 'developer') {
      return c.json({
        invoices: [],
        summary: {
          total_invoices: 0,
          total_value: 0,
          total_paid: 0,
          total_pending: 0,
          total_overdue: 0,
          paid_count: 0,
          overdue_count: 0,
          pending_count: 0,
        },
        pagination: { total: 0, page, limit, totalPages: 0, hasMore: false },
      })
    }

    const result = await c.env.DB.prepare(
      invoiceQuery + where + `
      ORDER BY datetime(i.created_at) DESC, datetime(i.issue_date) DESC, i.id DESC
      LIMIT ? OFFSET ?
    `
    ).bind(...params, limit, offset).all()

    const totalRow = await c.env.DB.prepare(`SELECT COUNT(*) as total FROM invoices i${where}`).bind(...params).first() as any
    // Summary stats
    const stats = await c.env.DB.prepare(`
      SELECT 
        COUNT(*) as total_invoices,
        COALESCE(SUM(total_amount), 0) as total_value,
        COALESCE(SUM(CASE WHEN status='paid' THEN paid_amount ELSE 0 END), 0) as total_paid,
        COALESCE(SUM(CASE WHEN status IN ('pending','sent') THEN total_amount ELSE 0 END), 0) as total_pending,
        COALESCE(SUM(CASE WHEN status='overdue' THEN total_amount ELSE 0 END), 0) as total_overdue,
        COALESCE(SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END), 0) as paid_count,
        COALESCE(SUM(CASE WHEN status='overdue' THEN 1 ELSE 0 END), 0) as overdue_count,
        COALESCE(SUM(CASE WHEN status IN ('pending','sent','overdue') THEN 1 ELSE 0 END), 0) as pending_count
      FROM invoices i${where}
    `).bind(...params).first() as any
    const total = totalRow?.total || 0
    return c.json({
      invoices: result.results,
      summary: stats,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasMore: offset + result.results.length < total,
      },
    })
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})

// GET /api/invoices/:id
invoices.get('/:id', async (c) => {
  try {
    const id = c.req.param('id')
    const inv = await c.env.DB.prepare(invoiceQuery + ' WHERE i.id=?').bind(id).first()
    if (!inv) return c.json({ error: 'Invoice not found' }, 404)
    return c.json({ invoice: inv })
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})

// POST /api/invoices/:id/send-email
invoices.post('/:id/send-email', async (c) => {
  try {
    const user = c.get('user')
    if (user.role !== 'admin') return c.json({ error: 'Only Super Admin can send invoices' }, 403)
    const id = c.req.param('id')
    const body = await c.req.json().catch(() => ({}))
    const invoice = await c.env.DB.prepare(invoiceQuery + ' WHERE i.id=?').bind(id).first() as any
    if (!invoice) return c.json({ error: 'Invoice not found' }, 404)

    const to = parseEmailList(body.to || invoice.client_email)
    const cc = parseEmailList(body.cc)
    if (!to.length) return c.json({ error: 'Client email is required' }, 400)

    const subject = String(body.subject || `Invoice ${invoice.invoice_number} from ${invoice.company_name || 'your team'}`).trim()
    const { html, text } = buildInvoiceEmail(invoice)
    const smtpUser = c.env.SMTP_USER?.trim() || c.env.SENDER_EMAIL?.trim()
    const smtpPass = c.env.SMTP_PASS?.trim() || c.env.APP_PASSWORD?.trim()
    const hasSmtpConfig = Boolean(smtpUser && smtpPass)

    if (hasSmtpConfig) {
      await sendInvoiceViaSmtp(c.env, invoice, to, cc, subject, html, text)
    } else if (c.env.EMAIL) {
      const fromEmail = c.env.SENDER_EMAIL || c.env.SMTP_USER || c.env.SMTP_FROM || 'abhishek@marioxsoftware.com'
      await c.env.EMAIL.send({
        to: to.length === 1 ? to[0] : to,
        cc: cc.length ? (cc.length === 1 ? cc[0] : cc) : undefined,
        from: { email: fromEmail, name: 'Mariox Software Pvt Ltd' },
        subject,
        html,
        text,
      })
    } else {
      return c.json({ error: 'Email sending is not configured. Set SENDER_EMAIL and APP_PASSWORD, or SMTP_USER and SMTP_PASS.' }, 500)
    }

    const nextStatus = ['paid', 'partially_paid', 'cancelled'].includes(invoice.status) ? invoice.status : 'sent'
    if (invoice.status !== nextStatus) {
      await c.env.DB.prepare('UPDATE invoices SET status=?, updated_at=? WHERE id=?')
        .bind(nextStatus, new Date().toISOString(), id).run()
    }

    await c.env.DB.prepare(`INSERT INTO activity_logs (id,project_id,entity_type,entity_id,action,actor_user_id,actor_name,actor_role,new_value,metadata) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .bind(
        'al-'+Date.now(),
        invoice.project_id,
        'invoice',
        id,
        'status_changed',
        user.sub,
        user.name,
        user.role,
        `Invoice emailed to ${to.join(', ')}`,
        JSON.stringify({ to, cc, subject, status: nextStatus })
      ).run()

    await c.env.DB.prepare(`INSERT INTO client_notifications (id,client_id,project_id,type,title,message) VALUES (?,?,?,?,?,?)`)
      .bind(
        'cn-'+Date.now(),
        invoice.client_id,
        invoice.project_id,
        'invoice',
        `Invoice Sent: ${invoice.invoice_number}`,
        `Invoice ${invoice.invoice_number} was emailed to ${to.join(', ')}${cc.length ? ` with CC to ${cc.join(', ')}` : ''}.`
      ).run()

    const updatedInvoice = await c.env.DB.prepare(invoiceQuery + ' WHERE i.id=?').bind(id).first()
    return c.json({
      success: true,
      message: 'Invoice email sent',
      invoice: updatedInvoice,
      sent_to: to,
      cc,
    })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// POST /api/invoices — Super Admin only
invoices.post('/', async (c) => {
  try {
    const user = c.get('user')
    if (user.role !== 'admin') return c.json({ error: 'Only Super Admin can create invoices' }, 403)
    const { project_id, client_id, milestone_id, title, description, amount, tax_pct=18, due_date, issue_date, notes, payment_terms, currency='INR' } = await c.req.json()
    if (!project_id || !client_id || !title || !amount || !due_date || !issue_date) return c.json({ error: 'Required fields missing' }, 400)

    const tax_amount = parseFloat(((amount * tax_pct) / 100).toFixed(2))
    const total_amount = parseFloat((amount + tax_amount).toFixed(2))
    const id = 'inv-'+Date.now()
    const invoice_number = 'INV-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-4)

    await c.env.DB.prepare(`
      INSERT INTO invoices (id,invoice_number,project_id,client_id,milestone_id,title,description,amount,currency,tax_pct,tax_amount,total_amount,status,due_date,issue_date,notes,payment_terms,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(id, invoice_number, project_id, client_id, milestone_id||null, title, description||null, amount, currency, tax_pct, tax_amount, total_amount, 'pending', due_date, issue_date, notes||null, payment_terms||null, user.sub).run()

    await c.env.DB.prepare(`INSERT INTO activity_logs (id,project_id,entity_type,entity_id,action,actor_user_id,actor_name,actor_role,new_value) VALUES (?,?,?,?,?,?,?,?,?)`)
      .bind('al-'+Date.now(), project_id,'invoice',id,'created',user.sub,user.name,user.role,invoice_number).run()

    // Notify client
    await c.env.DB.prepare(`INSERT INTO client_notifications (id,client_id,project_id,type,title,message) VALUES (?,?,?,?,?,?)`)
      .bind('cn-'+Date.now(), client_id, project_id, 'invoice', `New Invoice: ${invoice_number}`, `Invoice of ₹${total_amount.toLocaleString('en-IN')} has been raised. Due: ${due_date}`).run()

    const inv = await c.env.DB.prepare(invoiceQuery + ' WHERE i.id=?').bind(id).first()
    return c.json({ invoice: inv }, 201)
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})

// PUT /api/invoices/:id — Admin only
invoices.put('/:id', async (c) => {
  try {
    const user = c.get('user')
    if (user.role !== 'admin') return c.json({ error: 'Only Super Admin can update invoices' }, 403)
    const id = c.req.param('id')
    const body = await c.req.json()
    const fields: string[] = []; const vals: any[] = []
    for (const key of ['title','description','status','due_date','paid_date','paid_amount','transaction_ref','file_url','notes','payment_terms']) {
      if (key in body) { fields.push(`${key}=?`); vals.push(body[key]) }
    }
    fields.push('updated_at=?'); vals.push(new Date().toISOString()); vals.push(id)
    await c.env.DB.prepare(`UPDATE invoices SET ${fields.join(',')} WHERE id=?`).bind(...vals).run()

    await c.env.DB.prepare(`INSERT INTO activity_logs (id,entity_type,entity_id,action,actor_user_id,actor_name,actor_role,new_value) VALUES (?,?,?,?,?,?,?,?)`)
      .bind('al-'+Date.now(),'invoice',id,'updated',user.sub,user.name,user.role, body.status||'updated').run()

    const inv = await c.env.DB.prepare(invoiceQuery + ' WHERE i.id=?').bind(id).first()
    return c.json({ invoice: inv })
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})

// PATCH /api/invoices/:id/mark-paid
invoices.patch('/:id/mark-paid', async (c) => {
  try {
    const user = c.get('user')
    if (user.role !== 'admin') return c.json({ error: 'Forbidden' }, 403)
    const id = c.req.param('id')
    const { paid_amount, transaction_ref, paid_date } = await c.req.json()
    const inv = await c.env.DB.prepare('SELECT * FROM invoices WHERE id=?').bind(id).first() as any
    if (!inv) return c.json({ error: 'Not found' }, 404)
    const status = paid_amount >= inv.total_amount ? 'paid' : 'partially_paid'
    await c.env.DB.prepare('UPDATE invoices SET status=?, paid_amount=?, transaction_ref=?, paid_date=?, updated_at=? WHERE id=?')
      .bind(status, paid_amount, transaction_ref||null, paid_date||new Date().toISOString().split('T')[0], new Date().toISOString(), id).run()
    await c.env.DB.prepare(`INSERT INTO client_notifications (id,client_id,project_id,type,title,message) VALUES (?,?,?,?,?,?)`)
      .bind('cn-'+Date.now(), inv.client_id, inv.project_id,'invoice',`Payment Confirmed: ${inv.invoice_number}`,`Payment of ₹${paid_amount.toLocaleString('en-IN')} received. Status: ${status}`).run()
    const updated = await c.env.DB.prepare(invoiceQuery + ' WHERE i.id=?').bind(id).first()
    return c.json({ invoice: updated })
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})

export default invoices
