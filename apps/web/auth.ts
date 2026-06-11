import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { query } from '@/lib/db'

interface DbUser {
  id: number
  email: string
  name: string | null
  password_hash: string
  role: string
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
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

        const rows = await query<DbUser>`
          SELECT id, email, name, password_hash, role
          FROM users
          WHERE email = ${email}
          LIMIT 1
        `
        const user = rows[0]
        if (!user) return null

        const valid = await bcrypt.compare(password, user.password_hash)
        if (!valid) return null

        return { id: String(user.id), email: user.email, name: user.name ?? undefined, role: user.role }
      },
    }),
  ],
  pages: { signIn: '/login' },
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token['id']   = (user as any).id
        token['role'] = (user as any).role
      }
      return token
    },
    session({ session, token }) {
      if (session.user) {
        (session.user as any).id   = token['id'] as string
        (session.user as any).role = token['role'] as string
      }
      return session
    },
  },
})
