interface Env {
  GHL_LOCATION_ID: string;
  GHL_API_KEY: string;
  TURNSTILE_SECRET_KEY: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // Parse JSON body
  let data: Record<string, string>;
  try {
    data = await request.json();
  } catch {
    return Response.json({ status: 'error', message: 'Invalid request' }, { status: 400 });
  }

  // Honeypot check
  if (data._hp) {
    return Response.json({ status: 'success' });
  }

  // Turnstile verification — fail closed
  const turnstileSecret = env.TURNSTILE_SECRET_KEY;
  if (!turnstileSecret) {
    console.error('[submit] TURNSTILE_SECRET_KEY not set');
    return Response.json({ status: 'error', message: 'Server configuration error' }, { status: 500 });
  }

  const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret: turnstileSecret,
      response: data.turnstileToken,
    }),
  });
  const { success: turnstileOk } = await verifyRes.json() as { success: boolean };
  if (!turnstileOk) {
    return Response.json({ status: 'error', message: 'Bot check failed' }, { status: 403 });
  }

  // Phone normalization to E.164
  function normalizePhone(raw: string): string {
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
    return `+${digits}`;
  }

  const firstName = (data.firstName || '').trim();
  const lastName = (data.lastName || '').trim();
  const email = (data.email || '').trim();
  const phone = normalizePhone(data.phone || '');
  const message = (data.message || '').trim();

  if (!firstName || !email || !phone) {
    return Response.json({ status: 'error', message: 'Missing required fields' }, { status: 400 });
  }

  // GHL Contacts API
  const ghlRes = await fetch('https://services.leadconnectorhq.com/contacts/', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.GHL_API_KEY}`,
      'Version': '2021-07-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      locationId: env.GHL_LOCATION_ID,
      firstName,
      lastName,
      email,
      phone,
      source: 'Website Contact Form',
      tags: ['website-lead'],
    }),
  });

  let contactId: string | null = null;

  if (ghlRes.status === 400) {
    const body = await ghlRes.json() as { message?: string; meta?: { contactId?: string } };
    if (body.message?.includes('duplicated') || body.meta?.contactId) {
      contactId = body.meta?.contactId || null;
    } else {
      console.error('[submit] GHL 400:', JSON.stringify(body));
      return Response.json({ status: 'error', message: 'Submission failed' }, { status: 500 });
    }
  } else if (!ghlRes.ok) {
    console.error('[submit] GHL error:', ghlRes.status);
    return Response.json({ status: 'error', message: 'Submission failed' }, { status: 500 });
  } else {
    const ghlBody = await ghlRes.json() as { contact?: { id?: string } };
    contactId = ghlBody.contact?.id || null;
  }

  // Post project description as a contact note so it's visible in GHL + Slack
  if (message && contactId) {
    await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}/notes`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.GHL_API_KEY}`,
        'Version': '2021-07-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: contactId,
        body: `Website Inquiry:\n${message}`,
      }),
    });
  }

  return Response.json({ status: 'success' });
};
