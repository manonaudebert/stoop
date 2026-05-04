import { hash } from 'bcryptjs'
import { neon } from '@neondatabase/serverless'

export async function POST(req: Request) {
  let email: string, password: string
  try {
    ;({ email, password } = await req.json())
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 })
  }

  if (!email || !email.includes('@')) {
    return Response.json({ error: 'Valid email required' }, { status: 400 })
  }
  if (!password || password.length < 8) {
    return Response.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
  }

  const sql = neon(process.env.DATABASE_URL!)

  const existing = await sql`SELECT id FROM users WHERE email = ${email}`
  if (existing.length > 0) {
    return Response.json({ error: 'Email already registered' }, { status: 409 })
  }

  const passwordHash = await hash(password, 12)
  await sql`
    INSERT INTO users (id, email, password_hash)
    VALUES (gen_random_uuid()::text, ${email}, ${passwordHash})
  `

  return Response.json({ success: true })
}
