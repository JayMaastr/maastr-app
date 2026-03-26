import { NextResponse } from 'next/server';

// Price ID → subscription tier mapping
const PRICE_TIER = {
  'price_1TF16UCL6xuVEtSJ0vVrXKIV': 'industry_pro',
  'price_1TF165CL6xuVEtSJoGwsS8ER': 'studio_expert',
  'price_1TF15jCL6xuVEtSJ4O1j3rSw': 'home_studio_wiz',
};

// Update Supabase profile via REST API using service role key
async function updateProfile(userId, updates) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/profiles?id=eq.' + userId;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(updates),
  });
  return res.ok;
}

export async function POST(req) {
  const body = await req.text();
  const sig = req.headers.get('stripe-signature');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  // Verify Stripe signature if webhook secret is configured
  if (webhookSecret && sig) {
    // Simple timestamp + signature check
    try {
      const parts = sig.split(',').reduce((acc, p) => {
        const [k, v] = p.split('=');
        acc[k] = v;
        return acc;
      }, {});
      const timestamp = parts.t;
      const payload = timestamp + '.' + body;
      // Verify using Web Crypto API
      const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(webhookSecret),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
      );
      const sig256 = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
      const expected = Array.from(new Uint8Array(sig256)).map(b => b.toString(16).padStart(2, '0')).join('');
      const received = parts.v1;
      if (expected !== received) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
      }
    } catch (e) {
      return NextResponse.json({ error: 'Signature error: ' + e.message }, { status: 400 });
    }
  }

  let event;
  try { event = JSON.parse(body); } catch (e) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const obj = event.data?.object;

  if (event.type === 'checkout.session.completed') {
    const userId = obj.client_reference_id || obj.metadata?.user_id;
    const subId = obj.subscription;
    const custId = obj.customer;
    if (userId && subId) {
      // Get subscription to find price ID
      const subRes = await fetch('https://api.stripe.com/v1/subscriptions/' + subId, {
        headers: { 'Authorization': 'Bearer ' + process.env.STRIPE_SECRET_KEY }
      });
      const sub = await subRes.json();
      const priceId = sub.items?.data?.[0]?.price?.id;
      const tier = PRICE_TIER[priceId] || 'home_studio_wiz';
      await updateProfile(userId, {
        subscription_tier: tier,
        subscription_status: 'active',
        stripe_customer_id: custId,
        updated_at: new Date().toISOString(),
      });
    }
  }

  if (event.type === 'customer.subscription.updated') {
    const userId = obj.metadata?.user_id;
    if (userId) {
      const priceId = obj.items?.data?.[0]?.price?.id;
      const tier = PRICE_TIER[priceId] || 'home_studio_wiz';
      await updateProfile(userId, {
        subscription_tier: tier,
        subscription_status: obj.status === 'active' ? 'active' : obj.status,
        updated_at: new Date().toISOString(),
      });
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const userId = obj.metadata?.user_id;
    if (userId) {
      await updateProfile(userId, {
        subscription_tier: 'free',
        subscription_status: 'canceled',
        subscription_end_at: new Date(obj.ended_at * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
  }

  return NextResponse.json({ received: true });
}

export const config = { api: { bodyParser: false } };
