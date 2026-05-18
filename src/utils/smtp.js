// Generic SMTP sender — extracted verbatim from the working invoice mailer in
// src/routes/invoices.ts so leads / password-reset / etc. can send mail
// through the exact same protocol path that's already proven to deliver.
function normalizeSmtpSecret(value) {
    return String(value || '').replace(/\s+/g, '').trim();
}
function getLastReplyLine(reply) {
    return reply.lines[reply.lines.length - 1] || `SMTP replied with ${reply.code}`;
}
function expectSmtp(reply, allowed, action) {
    if (!allowed.includes(reply.code)) {
        throw new Error(`${action} failed: ${getLastReplyLine(reply)}`);
    }
}
function parseReplyLine(line) {
    const match = line.match(/^(\d{3})([ -])(.*)$/);
    if (!match)
        return null;
    const code = Number(match[1]);
    const done = match[2] === ' ';
    return { code, done, line };
}
function dotStuff(message) {
    return message
        .split('\r\n')
        .map((line) => (line.startsWith('.') ? '.' + line : line))
        .join('\r\n');
}
function encodeAttachmentContent(att) {
    // Returns base64 with CRLF every 76 chars (RFC 5322 / RFC 2045).
    let bytes;
    if (typeof att.content === 'string') {
        if (att.encoding === 'binary') {
            bytes = new TextEncoder().encode(att.content);
        }
        else {
            // already base64 — re-wrap it to 76-col lines
            const cleaned = att.content.replace(/\r?\n/g, '');
            return cleaned.replace(/(.{76})/g, '$1\r\n');
        }
    }
    else if (att.content instanceof Uint8Array) {
        bytes = att.content;
    }
    else {
        bytes = new Uint8Array(att.content);
    }
    // Buffer is available in Node.js — used here for fast base64 encoding.
    const b64 = Buffer.from(bytes).toString('base64');
    return b64.replace(/(.{76})/g, '$1\r\n');
}
function buildMimeMessage(opts) {
    const altBoundary = `alt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const altPart = [
        `--${altBoundary}`,
        'Content-Type: text/plain; charset="UTF-8"',
        'Content-Transfer-Encoding: 8bit',
        '',
        opts.text,
        `--${altBoundary}`,
        'Content-Type: text/html; charset="UTF-8"',
        'Content-Transfer-Encoding: 8bit',
        '',
        opts.html,
        `--${altBoundary}--`,
        '',
    ].join('\r\n');
    const hasAttachments = !!opts.attachments && opts.attachments.length > 0;
    if (!hasAttachments) {
        const headers = [
            `From: ${opts.from}`,
            `To: ${opts.to.join(', ')}`,
            opts.cc.length ? `Cc: ${opts.cc.join(', ')}` : '',
            `Subject: ${opts.subject}`,
            'MIME-Version: 1.0',
            `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
        ].filter(Boolean).join('\r\n');
        return `${headers}\r\n\r\n${altPart}`;
    }
    const mixedBoundary = `mix-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const headers = [
        `From: ${opts.from}`,
        `To: ${opts.to.join(', ')}`,
        opts.cc.length ? `Cc: ${opts.cc.join(', ')}` : '',
        `Subject: ${opts.subject}`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    ].filter(Boolean).join('\r\n');
    const parts = [
        `--${mixedBoundary}`,
        `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
        '',
        altPart,
    ];
    for (const att of opts.attachments) {
        const filename = (att.filename || 'attachment').replace(/[\r\n"]/g, '_');
        const ctype = att.contentType || 'application/octet-stream';
        parts.push(`--${mixedBoundary}`, `Content-Type: ${ctype}; name="${filename}"`, 'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename="${filename}"`, '', encodeAttachmentContent(att));
    }
    parts.push(`--${mixedBoundary}--`, '');
    return `${headers}\r\n\r\n${parts.join('\r\n')}`;
}
function asList(value) {
    if (!value)
        return [];
    if (Array.isArray(value))
        return value.map((v) => String(v).trim()).filter(Boolean);
    return String(value)
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
}
// Send an email via SMTP. Mirrors sendInvoiceViaSmtp in src/routes/invoices.ts
// step-for-step so any caller benefits from the same protocol behaviour.
export async function sendSmtpEmail(env, message) {
    const brandName = message.fromName || 'Mariox Software Pvt Ltd';
    const user = env.SMTP_USER?.trim() || env.SENDER_EMAIL?.trim();
    const pass = normalizeSmtpSecret(env.SMTP_PASS || env.APP_PASSWORD);
    const host = env.SMTP_HOST?.trim() || (user ? 'smtp.gmail.com' : '');
    if (!host || !user || !pass) {
        throw new Error('SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASS (or SENDER_EMAIL and APP_PASSWORD) are required');
    }
    const port = Number(env.SMTP_PORT || 587);
    const secure = env.SMTP_SECURE === 'true' || port === 465;
    const from = env.SMTP_FROM?.trim() || env.SENDER_EMAIL?.trim() || user;
    const localName = 'devportal.local';
    const to = asList(message.to);
    const cc = asList(message.cc);
    const recipients = [...to, ...cc];
    if (!recipients.length) {
        throw new Error('At least one recipient email is required');
    }
    const net = await import('node:net');
    const tls = await import('node:tls');
    let socket = secure
        ? tls.connect({ host, port, servername: host })
        : net.connect({ host, port });
    await new Promise((resolve, reject) => {
        const readyEvent = secure ? 'secureConnect' : 'connect';
        socket.once(readyEvent, () => resolve());
        socket.once('error', reject);
    });
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = '';
    const cleanup = async () => {
        try {
            socket.removeAllListeners();
        }
        catch { }
        try {
            socket.end();
        }
        catch { }
        try {
            socket.destroy();
        }
        catch { }
    };
    const readSmtpReply = async () => {
        return new Promise((resolve, reject) => {
            const onError = (error) => {
                cleanup().finally(() => reject(error));
            };
            const lines = [];
            const onData = (chunk) => {
                buffer += decoder.decode(chunk, { stream: true });
                while (true) {
                    const newlineIndex = buffer.indexOf('\n');
                    if (newlineIndex < 0)
                        break;
                    const rawLine = buffer.slice(0, newlineIndex).replace(/\r$/, '');
                    buffer = buffer.slice(newlineIndex + 1);
                    if (!rawLine)
                        continue;
                    lines.push(rawLine);
                    const reply = parseReplyLine(rawLine);
                    if (reply && reply.done) {
                        socket.off('data', onData);
                        socket.off('error', onError);
                        resolve({ code: reply.code, lines });
                        return;
                    }
                }
            };
            socket.on('data', onData);
            socket.once('error', onError);
        });
    };
    const sendCommand = async (command, allowed, action) => {
        await new Promise((resolve, reject) => {
            socket.write(encoder.encode(command + '\r\n'), (error) => (error ? reject(error) : resolve()));
        });
        const reply = await readSmtpReply();
        if (!allowed.includes(reply.code)) {
            throw new Error(`${action} failed: ${getLastReplyLine(reply)}`);
        }
        return reply;
    };
    try {
        let reply = await readSmtpReply();
        expectSmtp(reply, [220], 'SMTP greeting');
        reply = await sendCommand(`EHLO ${localName}`, [250], 'EHLO');
        if (!secure) {
            const hasStartTls = reply.lines.some((line) => /STARTTLS/i.test(line));
            if (!hasStartTls) {
                throw new Error('SMTP server does not offer STARTTLS');
            }
            await sendCommand('STARTTLS', [220], 'STARTTLS');
            const secureSocket = tls.connect({
                socket: socket,
                servername: host,
            });
            await new Promise((resolve, reject) => {
                secureSocket.once('secureConnect', () => resolve());
                secureSocket.once('error', reject);
            });
            socket = secureSocket;
            buffer = '';
            reply = await sendCommand(`EHLO ${localName}`, [250], 'EHLO after STARTTLS');
            expectSmtp(reply, [250], 'EHLO after STARTTLS');
        }
        await sendCommand('AUTH LOGIN', [334], 'SMTP auth start');
        await sendCommand(btoa(user), [334], 'SMTP username');
        await sendCommand(btoa(pass), [235], 'SMTP password');
        await sendCommand(`MAIL FROM:<${from}>`, [250], 'MAIL FROM');
        for (const recipient of recipients) {
            await sendCommand(`RCPT TO:<${recipient}>`, [250, 251], `RCPT TO ${recipient}`);
        }
        await sendCommand('DATA', [354], 'DATA');
        const mime = buildMimeMessage({
            from: `${brandName} <${from}>`,
            to,
            cc,
            subject: message.subject,
            html: message.html,
            text: message.text,
            attachments: message.attachments,
        });
        await new Promise((resolve, reject) => {
            socket.write(encoder.encode(dotStuff(mime) + '\r\n.\r\n'), (error) => error ? reject(error) : resolve());
        });
        reply = await readSmtpReply();
        expectSmtp(reply, [250], 'SMTP message delivery');
        await new Promise((resolve, reject) => {
            socket.write(encoder.encode('QUIT\r\n'), (error) => (error ? reject(error) : resolve()));
        });
        try {
            await readSmtpReply();
        }
        catch { }
        return { from, recipients, provider: 'smtp' };
    }
    finally {
        await cleanup();
    }
}
