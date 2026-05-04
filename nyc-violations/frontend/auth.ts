import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { compare } from 'bcryptjs'
import { neon } from '@neondatabase/serverless'

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email:    { label: 'Email',    type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email    = credentials?.email    as string | undefined
        const password = credentials?.password as string | undefined
        if (!email || !password) return null

        const sql  = neon(process.env.DATABASE_URL!)
        const rows = await sql`
          SELECT id, email, password_hash FROM users WHERE email = ${email}
        `
        const user = rows[0]
        if (!user) return null

        const valid = await compare(password, user.password_hash as string)
        if (!valid) return null

        return { id: user.id as string, email: user.email as string }
      },
    }),
  ],
  session: { strategy: 'jwt' },
  pages: { signIn: '/' },
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.id = user.id
      return token
    },
    session({ session, token }) {
      if (token.id) session.user.id = token.id as string
      return session
    },
  },
})
