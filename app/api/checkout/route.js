import { NextResponse } from 'next/server';

export async function POST(req) {
  try {
    const { priceId, userId, userEmail } = await req.json();
    const origin = req.headers.get('origin') || 'https://maastr-app.vercel.app';

    const params = new URLSearchParams({
      mode: 'subscription',
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      success_url: origin + '/?checkout=success',
      cancel_url: origin + '/pricing',
      client_reference_id: userId || '',
      'subscription_data[metadata][user_id]': userId || '',
    });
    if (userEmail) params.set('customer_email', userEmail);

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.STRIPE_SECRET_KEY,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });

    const session = await res.json();
    if (session.error) throw new Error(session.error.message);
    return NextResponse.json({ url: session.url });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
