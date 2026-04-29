// ───────────────────────────────────────────────────────────────────
// Invoice email — GST-style HTML template + Node SMTP delivery.
// Uses node:net / node:tls directly. No Web Streams, no releaseLock.
// ───────────────────────────────────────────────────────────────────

import net from 'node:net'
import tls from 'node:tls'

export interface InvoiceEmailEnv {
  SMTP_HOST?: string
  SMTP_PORT?: string | number
  SMTP_USER?: string
  SMTP_PASS?: string
  SMTP_FROM?: string
  SMTP_SECURE?: string | boolean
  SENDER_EMAIL?: string
  APP_PASSWORD?: string
  COMPANY_NAME?: string
  COMPANY_GSTIN?: string
  COMPANY_ADDRESS?: string
  COMPANY_STATE_CODE?: string
  BANK_NAME?: string
  BANK_ACCOUNT_HOLDER?: string
  BANK_ACCOUNT_NUMBER?: string
  BANK_IFSC?: string
  BANK_BRANCH?: string
  [key: string]: any
}

const DEFAULTS = {
  COMPANY_NAME: 'MARIOX SOFTWARE PRIVATE LIMITED',
  COMPANY_GSTIN: '09AANCM6123C1ZJ',
  COMPANY_ADDRESS: 'Office No. 202, 2nd Floor, Assotech Business Cresterra, Tower 4, Plot No. 22, Noida, Gautambuddha Nagar, UTTAR PRADESH, 201304',
  COMPANY_STATE_CODE: '09-UTTAR PRADESH',
  BANK_NAME: 'HDFC Bank',
  BANK_ACCOUNT_HOLDER: 'MARIOX SOFTWARE PRIVATE LIMITED',
  BANK_ACCOUNT_NUMBER: '50200075066017',
  BANK_IFSC: 'HDFC0009522',
  BANK_BRANCH: 'OMAXE WORLD STREET FARIDABAD',
}

export function escapeHtml(value: any): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function fmtINR(n: number) {
  return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0))
}

function fmtDate(value: any) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine']
const TEENS = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function twoDigitsToWords(n: number): string {
  if (n < 10) return ONES[n]
  if (n < 20) return TEENS[n - 10]
  const t = Math.floor(n / 10)
  const r = n % 10
  return TENS[t] + (r ? '-' + ONES[r] : '')
}

function threeDigitsToWords(n: number): string {
  const h = Math.floor(n / 100)
  const r = n % 100
  return (h ? ONES[h] + ' Hundred' + (r ? ' ' : '') : '') + (r ? twoDigitsToWords(r) : '')
}

function amountToIndianWords(amount: number): string {
  const rounded = Math.round(amount * 100) / 100
  const rupees = Math.floor(rounded)
  const paise = Math.round((rounded - rupees) * 100)
  if (rupees === 0 && paise === 0) return 'Zero Rupees Only.'

  const crore = Math.floor(rupees / 10000000)
  const lakh = Math.floor((rupees % 10000000) / 100000)
  const thousand = Math.floor((rupees % 100000) / 1000)
  const remainder = rupees % 1000

  const parts: string[] = []
  if (crore) parts.push(twoDigitsToWords(crore) + ' Crore')
  if (lakh) parts.push(twoDigitsToWords(lakh) + ' Lakh')
  if (thousand) parts.push(twoDigitsToWords(thousand) + ' Thousand')
  if (remainder) parts.push(threeDigitsToWords(remainder))

  let words = 'INR ' + parts.join(', ') + ' Rupees'
  if (paise) words += ' and ' + twoDigitsToWords(paise) + ' Paise'
  words += ' Only.'
  return words
}

export interface InvoiceEmailInput {
  inv: any
  client?: any
  project?: any
  env: InvoiceEmailEnv
}

function setting(env: InvoiceEmailEnv, key: keyof typeof DEFAULTS) {
  return String(env[key] || (DEFAULTS as any)[key]).trim()
}

function isSameStateGST(env: InvoiceEmailEnv, place: string) {
  const code = setting(env, 'COMPANY_STATE_CODE').slice(0, 2)
  return place.startsWith(code)
}

export function buildInvoiceEmailGST({ inv, client, project, env }: InvoiceEmailInput) {
  const companyName = setting(env, 'COMPANY_NAME')
  const gstin = setting(env, 'COMPANY_GSTIN')
  const address = setting(env, 'COMPANY_ADDRESS')
  const stateCode = setting(env, 'COMPANY_STATE_CODE')

  const bankName = setting(env, 'BANK_NAME')
  const bankHolder = setting(env, 'BANK_ACCOUNT_HOLDER')
  const bankAcc = setting(env, 'BANK_ACCOUNT_NUMBER')
  const bankIfsc = setting(env, 'BANK_IFSC')
  const bankBranch = setting(env, 'BANK_BRANCH')

  const invoiceNumber = inv.invoice_number || inv.id || ''
  const issueDate = fmtDate(inv.issue_date)
  const dueDate = fmtDate(inv.due_date)
  const placeOfSupply = inv.place_of_supply || (client?.state_code) || stateCode

  const customerName = client?.contact_name || inv.contact_name || ''
  const customerCompany = client?.company_name || inv.company_name || ''
  const customerPhone = client?.phone || inv.client_phone || ''
  const customerEmail = client?.email || inv.client_email || ''
  const customerGstin = client?.gstin || inv.client_gstin || ''
  const customerAddress = client?.address_line || inv.client_address || ''
  const customerCity = client?.city || ''
  const customerState = client?.state || ''
  const customerPincode = client?.pincode || ''
  const customerCountry = client?.country || ''
  const customerLocation = [customerCity, customerState, customerPincode].filter(Boolean).join(', ')

  const itemTitle = inv.title || project?.name || 'Project services'
  const description = inv.description ? `<div style="font-size:11px;color:#374151;margin-top:4px">${escapeHtml(inv.description).replace(/\n/g, '<br/>')}</div>` : ''
  const qty = Number(inv.quantity || 1)
  const taxableValue = Number(inv.amount || 0)
  const taxPct = Number(inv.tax_pct || 0)
  const taxAmount = Number(inv.tax_amount ?? (taxableValue * taxPct) / 100)
  const totalAmount = Number(inv.total_amount ?? taxableValue + taxAmount)
  const lineRate = qty > 0 ? taxableValue / qty : taxableValue

  const sameState = isSameStateGST(env, placeOfSupply)
  const halfTax = taxAmount / 2
  const halfPct = taxPct / 2

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>Tax Invoice ${escapeHtml(invoiceNumber)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827">
<div style="max-width:780px;margin:24px auto;background:#ffffff;padding:28px 32px;border:1px solid #e5e7eb">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
    <tr>
      <td style="vertical-align:top">
        <div style="font-size:11px;letter-spacing:.18em;color:#6b7280;font-weight:700">TAX INVOICE</div>
        <div style="font-size:20px;font-weight:800;color:#111827;margin-top:6px">${escapeHtml(companyName)}</div>
        <div style="font-size:11px;color:#374151;margin-top:6px"><strong>GSTIN</strong> ${escapeHtml(gstin)}</div>
        <div style="font-size:11px;color:#374151;margin-top:4px;line-height:1.5;max-width:380px">${escapeHtml(address)}</div>
      </td>
      <td style="vertical-align:top;text-align:right">
        <div style="font-size:11px;letter-spacing:.18em;color:#6b7280;font-weight:700">ORIGINAL FOR RECIPIENT</div>
      </td>
    </tr>
  </table>

  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-top:22px;border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb">
    <tr>
      <td style="padding:12px 0;font-size:13px;font-weight:700;color:#111827">Invoice #: ${escapeHtml(invoiceNumber)}</td>
      <td style="padding:12px 0;font-size:13px;color:#111827"><strong>Invoice Date:</strong> ${escapeHtml(issueDate)}</td>
      <td style="padding:12px 0;font-size:13px;color:#111827;text-align:right"><strong>Due Date:</strong> ${escapeHtml(dueDate)}</td>
    </tr>
  </table>

  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-top:18px">
    <tr>
      <td style="vertical-align:top">
        <div style="font-size:12px;font-weight:700;color:#111827">Bill To:</div>
        ${customerCompany ? `<div style="font-size:13px;font-weight:700;color:#111827;margin-top:6px">${escapeHtml(customerCompany)}</div>` : ''}
        ${customerName ? `<div style="font-size:12px;color:#374151;margin-top:2px">Attn: ${escapeHtml(customerName)}</div>` : ''}
        ${customerAddress ? `<div style="font-size:12px;color:#374151;margin-top:4px;line-height:1.5;max-width:340px">${escapeHtml(customerAddress)}</div>` : ''}
        ${customerLocation ? `<div style="font-size:12px;color:#374151;margin-top:2px">${escapeHtml(customerLocation)}${customerCountry ? `, ${escapeHtml(customerCountry)}` : ''}</div>` : (customerCountry ? `<div style="font-size:12px;color:#374151;margin-top:2px">${escapeHtml(customerCountry)}</div>` : '')}
        ${customerGstin ? `<div style="font-size:12px;color:#374151;margin-top:4px"><strong>GSTIN:</strong> ${escapeHtml(customerGstin)}</div>` : ''}
        ${customerPhone ? `<div style="font-size:12px;color:#374151;margin-top:2px">Ph: ${escapeHtml(customerPhone)}</div>` : ''}
        ${customerEmail ? `<div style="font-size:12px;color:#374151;margin-top:2px">${escapeHtml(customerEmail)}</div>` : ''}
      </td>
      <td style="vertical-align:top;text-align:right">
        <div style="font-size:12px;font-weight:700;color:#111827">Place of Supply:</div>
        <div style="font-size:13px;color:#111827;margin-top:4px">${escapeHtml(placeOfSupply)}</div>
      </td>
    </tr>
  </table>

  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-top:22px;border:1px solid #cbd5e1">
    <tr style="background:#f1f5f9">
      <th style="padding:8px 10px;font-size:11px;text-align:left;color:#0f172a;border-right:1px solid #cbd5e1;width:32px">#</th>
      <th style="padding:8px 10px;font-size:11px;text-align:left;color:#0f172a;border-right:1px solid #cbd5e1">Item</th>
      <th style="padding:8px 10px;font-size:11px;text-align:right;color:#0f172a;border-right:1px solid #cbd5e1">Rate / Item</th>
      <th style="padding:8px 10px;font-size:11px;text-align:right;color:#0f172a;border-right:1px solid #cbd5e1">Qty</th>
      <th style="padding:8px 10px;font-size:11px;text-align:right;color:#0f172a;border-right:1px solid #cbd5e1">Taxable Value</th>
      <th style="padding:8px 10px;font-size:11px;text-align:right;color:#0f172a;border-right:1px solid #cbd5e1">Tax Amount</th>
      <th style="padding:8px 10px;font-size:11px;text-align:right;color:#0f172a">Amount</th>
    </tr>
    <tr>
      <td style="padding:10px;font-size:12px;color:#111827;border-top:1px solid #cbd5e1;border-right:1px solid #cbd5e1;vertical-align:top">1</td>
      <td style="padding:10px;font-size:12px;color:#111827;border-top:1px solid #cbd5e1;border-right:1px solid #cbd5e1;vertical-align:top">
        <div style="font-weight:700">${escapeHtml(itemTitle)}</div>
        ${description}
      </td>
      <td style="padding:10px;font-size:12px;color:#111827;border-top:1px solid #cbd5e1;border-right:1px solid #cbd5e1;text-align:right;vertical-align:top">${fmtINR(lineRate)}</td>
      <td style="padding:10px;font-size:12px;color:#111827;border-top:1px solid #cbd5e1;border-right:1px solid #cbd5e1;text-align:right;vertical-align:top">${qty}</td>
      <td style="padding:10px;font-size:12px;color:#111827;border-top:1px solid #cbd5e1;border-right:1px solid #cbd5e1;text-align:right;vertical-align:top">${fmtINR(taxableValue)}</td>
      <td style="padding:10px;font-size:12px;color:#111827;border-top:1px solid #cbd5e1;border-right:1px solid #cbd5e1;text-align:right;vertical-align:top">${fmtINR(taxAmount)} (${taxPct}%)</td>
      <td style="padding:10px;font-size:12px;color:#111827;border-top:1px solid #cbd5e1;text-align:right;vertical-align:top">${fmtINR(totalAmount)}</td>
    </tr>
  </table>

  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-top:14px">
    <tr>
      <td style="vertical-align:top;font-size:11px;color:#374151">
        Total Items / Qty : 1 / ${qty}
      </td>
      <td style="vertical-align:top">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
          <tr><td style="padding:4px 0;font-size:12px;color:#374151;text-align:right">Taxable Amount</td><td style="padding:4px 0 4px 12px;font-size:12px;color:#111827;text-align:right;font-weight:600;width:120px">₹${fmtINR(taxableValue)}</td></tr>
          ${sameState ? `
            <tr><td style="padding:4px 0;font-size:12px;color:#374151;text-align:right">CGST ${fmtINR(halfPct)}%</td><td style="padding:4px 0 4px 12px;font-size:12px;color:#111827;text-align:right;font-weight:600">₹${fmtINR(halfTax)}</td></tr>
            <tr><td style="padding:4px 0;font-size:12px;color:#374151;text-align:right">SGST ${fmtINR(halfPct)}%</td><td style="padding:4px 0 4px 12px;font-size:12px;color:#111827;text-align:right;font-weight:600">₹${fmtINR(halfTax)}</td></tr>
          ` : `
            <tr><td style="padding:4px 0;font-size:12px;color:#374151;text-align:right">IGST ${fmtINR(taxPct)}%</td><td style="padding:4px 0 4px 12px;font-size:12px;color:#111827;text-align:right;font-weight:600">₹${fmtINR(taxAmount)}</td></tr>
          `}
          <tr><td style="padding:8px 0 4px 0;font-size:13px;color:#111827;text-align:right;font-weight:700;border-top:1px solid #e5e7eb">Total</td><td style="padding:8px 0 4px 12px;font-size:13px;color:#111827;text-align:right;font-weight:800;border-top:1px solid #e5e7eb">₹${fmtINR(totalAmount)}</td></tr>
        </table>
      </td>
    </tr>
  </table>

  <div style="margin-top:14px;font-size:11px;color:#374151;line-height:1.5">
    <strong>Total amount (in words):</strong> ${escapeHtml(amountToIndianWords(totalAmount))}
  </div>
  <div style="margin-top:6px;font-size:13px;color:#111827;font-weight:700">Amount Payable: ₹${fmtINR(totalAmount)}</div>

  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-top:24px">
    <tr>
      <td style="vertical-align:top;width:60%">
        <div style="font-size:12px;font-weight:700;color:#111827">Bank Details:</div>
        <table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-top:6px;font-size:12px;color:#374151">
          <tr><td style="padding:2px 16px 2px 0">Bank:</td><td style="padding:2px 0;color:#111827;font-weight:600">${escapeHtml(bankName)}</td></tr>
          <tr><td style="padding:2px 16px 2px 0">Account Holder:</td><td style="padding:2px 0;color:#111827;font-weight:600">${escapeHtml(bankHolder)}</td></tr>
          <tr><td style="padding:2px 16px 2px 0">Account #:</td><td style="padding:2px 0;color:#111827;font-weight:600">${escapeHtml(bankAcc)}</td></tr>
          <tr><td style="padding:2px 16px 2px 0">IFSC Code:</td><td style="padding:2px 0;color:#111827;font-weight:600">${escapeHtml(bankIfsc)}</td></tr>
          <tr><td style="padding:2px 16px 2px 0">Branch:</td><td style="padding:2px 0;color:#111827;font-weight:600">${escapeHtml(bankBranch)}</td></tr>
        </table>
      </td>
      <td style="vertical-align:top;text-align:right">
        <div style="font-size:11px;color:#374151">For ${escapeHtml(companyName)}</div>
        <div style="margin-top:8px"><img src="${escapeHtml(env.PUBLIC_BASE_URL || '')}/static/images/mariox-sign.png" alt="Authorized Signature" style="max-height:64px;max-width:200px;display:inline-block"/></div>
        <div style="margin-top:6px;font-size:11px;color:#374151;border-top:1px solid #cbd5e1;display:inline-block;padding:6px 18px 0">Authorized Signatory</div>
      </td>
    </tr>
  </table>

  ${inv.notes ? `<div style="margin-top:22px;padding:12px;border:1px solid #e5e7eb;border-radius:6px;font-size:11px;color:#374151;line-height:1.5"><strong style="color:#111827">Notes:</strong><br/>${escapeHtml(inv.notes).replace(/\n/g, '<br/>')}</div>` : ''}
  ${inv.payment_terms ? `<div style="margin-top:8px;font-size:11px;color:#374151"><strong>Payment Terms:</strong> ${escapeHtml(inv.payment_terms)}</div>` : ''}

  <div style="margin-top:28px;padding-top:14px;border-top:1px solid #e5e7eb;text-align:center;font-size:10px;color:#9ca3af">This is a digitally generated document. Page 1 / 1.</div>
</div>
</body></html>`

  const text = [
    `TAX INVOICE`,
    `${companyName}`,
    `GSTIN: ${gstin}`,
    `${address}`,
    ``,
    `Invoice #: ${invoiceNumber}`,
    `Invoice Date: ${issueDate}`,
    `Due Date: ${dueDate}`,
    ``,
    `Bill To: ${customerCompany || customerName}`,
    customerCompany && customerName ? `Attn: ${customerName}` : '',
    customerAddress ? `Address: ${customerAddress}` : '',
    customerLocation ? `${customerLocation}${customerCountry ? `, ${customerCountry}` : ''}` : (customerCountry ? customerCountry : ''),
    customerGstin ? `GSTIN: ${customerGstin}` : '',
    customerPhone ? `Phone: ${customerPhone}` : '',
    customerEmail ? `Email: ${customerEmail}` : '',
    `Place of Supply: ${placeOfSupply}`,
    ``,
    `Item: ${itemTitle}`,
    inv.description ? `Description: ${inv.description}` : '',
    `Qty: ${qty}`,
    `Rate/Item: ${fmtINR(lineRate)}`,
    `Taxable Value: ${fmtINR(taxableValue)}`,
    sameState
      ? `CGST ${fmtINR(halfPct)}%: ${fmtINR(halfTax)}\nSGST ${fmtINR(halfPct)}%: ${fmtINR(halfTax)}`
      : `IGST ${fmtINR(taxPct)}%: ${fmtINR(taxAmount)}`,
    `Total: ₹${fmtINR(totalAmount)}`,
    `In words: ${amountToIndianWords(totalAmount)}`,
    ``,
    `Bank: ${bankName} · A/c: ${bankAcc} · IFSC: ${bankIfsc}`,
  ].filter(Boolean).join('\n')

  return { html, text }
}

// ──────────────────────── SMTP delivery ─────────────────────────

interface SmtpReply { code: number; lines: string[] }

function buildMime(opts: { from: string; to: string[]; cc: string[]; subject: string; html: string; text: string }) {
  const boundary = `----devportal-${Date.now()}`
  const headers = [
    `From: ${opts.from}`,
    `To: ${opts.to.join(', ')}`,
    opts.cc.length ? `Cc: ${opts.cc.join(', ')}` : '',
    `Subject: =?UTF-8?B?${Buffer.from(opts.subject, 'utf8').toString('base64')}?=`,
    `MIME-Version: 1.0`,
    `Date: ${new Date().toUTCString()}`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].filter(Boolean).join('\r\n')

  const body = [
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="utf-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    opts.text,
    `--${boundary}`,
    'Content-Type: text/html; charset="utf-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    opts.html,
    `--${boundary}--`,
    '',
  ].join('\r\n')

  return headers + '\r\n' + body
}

function dotStuff(message: string) {
  return message.split('\r\n').map((l) => (l.startsWith('.') ? '.' + l : l)).join('\r\n')
}

export async function sendInvoiceViaSmtp(opts: {
  env: InvoiceEmailEnv
  to: string[]
  cc: string[]
  subject: string
  html: string
  text: string
  brandName?: string
}) {
  const env = opts.env
  const host = String(env.SMTP_HOST || '').trim()
  const port = Number(env.SMTP_PORT || 587)
  const user = String(env.SMTP_USER || env.SENDER_EMAIL || '').trim()
  const pass = String(env.SMTP_PASS || env.APP_PASSWORD || '').trim()
  if (!host || !user || !pass) throw new Error('SMTP is not configured (need SMTP_HOST, SMTP_USER and SMTP_PASS)')

  const secure = String(env.SMTP_SECURE) === 'true' || port === 465
  const from = String(env.SMTP_FROM || env.SENDER_EMAIL || user).trim()
  const brandName = opts.brandName || setting(env, 'COMPANY_NAME')
  const recipients = [...opts.to, ...opts.cc]
  if (!recipients.length) throw new Error('At least one recipient required')

  let socket: net.Socket | tls.TLSSocket = secure
    ? tls.connect({ host, port, servername: host })
    : net.connect({ host, port })

  await new Promise<void>((resolve, reject) => {
    const ev = secure ? 'secureConnect' : 'connect'
    socket.once(ev as any, () => resolve())
    socket.once('error', reject)
  })

  const decoder = new TextDecoder()
  let buffer = ''

  const cleanup = () => {
    try { socket.removeAllListeners() } catch {}
    try { socket.end() } catch {}
    try { socket.destroy() } catch {}
  }

  const readReply = (): Promise<SmtpReply> => new Promise((resolve, reject) => {
    const lines: string[] = []
    const onData = (chunk: Buffer) => {
      buffer += decoder.decode(chunk, { stream: true })
      while (true) {
        const idx = buffer.indexOf('\n')
        if (idx < 0) break
        const raw = buffer.slice(0, idx).replace(/\r$/, '')
        buffer = buffer.slice(idx + 1)
        if (!raw) continue
        lines.push(raw)
        const m = raw.match(/^(\d{3})([ -])(.*)$/)
        if (m && m[2] === ' ') {
          socket.off('data', onData)
          socket.off('error', onError)
          resolve({ code: Number(m[1]), lines })
          return
        }
      }
    }
    const onError = (err: Error) => {
      socket.off('data', onData)
      cleanup()
      reject(err)
    }
    socket.on('data', onData)
    socket.once('error', onError)
  })

  const send = (cmd: string) => new Promise<void>((resolve, reject) => {
    socket.write(cmd + '\r\n', (err) => err ? reject(err) : resolve())
  })

  const cmd = async (line: string, allowed: number[], action: string) => {
    await send(line)
    const reply = await readReply()
    if (!allowed.includes(reply.code)) {
      throw new Error(`${action} failed: ${reply.lines[reply.lines.length - 1] || reply.code}`)
    }
    return reply
  }

  try {
    let reply = await readReply()
    if (reply.code !== 220) throw new Error(`SMTP greeting failed: ${reply.lines.join(' | ')}`)

    reply = await cmd(`EHLO devportal.local`, [250], 'EHLO')

    if (!secure) {
      const hasStarttls = reply.lines.some((l) => /STARTTLS/i.test(l))
      if (!hasStarttls) throw new Error('SMTP server does not offer STARTTLS')
      await cmd('STARTTLS', [220], 'STARTTLS')
      const sec = tls.connect({ socket: socket as net.Socket, servername: host })
      await new Promise<void>((resolve, reject) => {
        sec.once('secureConnect', () => resolve())
        sec.once('error', reject)
      })
      socket = sec
      buffer = ''
      reply = await cmd(`EHLO devportal.local`, [250], 'EHLO after STARTTLS')
    }

    await cmd('AUTH LOGIN', [334], 'AUTH start')
    await cmd(Buffer.from(user, 'utf8').toString('base64'), [334], 'AUTH user')
    await cmd(Buffer.from(pass, 'utf8').toString('base64'), [235], 'AUTH password')

    await cmd(`MAIL FROM:<${from}>`, [250], 'MAIL FROM')
    for (const rcpt of recipients) {
      await cmd(`RCPT TO:<${rcpt}>`, [250, 251], `RCPT TO ${rcpt}`)
    }
    await cmd('DATA', [354], 'DATA')

    const mime = buildMime({ from: `${brandName} <${from}>`, to: opts.to, cc: opts.cc, subject: opts.subject, html: opts.html, text: opts.text })
    await send(dotStuff(mime) + '\r\n.')
    reply = await readReply()
    if (reply.code !== 250) throw new Error(`Message delivery failed: ${reply.lines.join(' | ')}`)

    try { await send('QUIT'); await readReply() } catch {}
  } finally {
    cleanup()
  }
}

export function parseEmailList(input: any): string[] {
  if (!input) return []
  const list = Array.isArray(input) ? input : String(input).split(/[,;]/)
  return list.map((s) => String(s).trim()).filter(Boolean)
}
