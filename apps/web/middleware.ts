import { auth } from '@/auth'
import { NextResponse } from 'next/server'

export default auth((req) => {
  const isLoggedIn   = !!req.auth
  const isLoginPage  = req.nextUrl.pathname === '/login'
  const isAuthApi    = req.nextUrl.pathname.startsWith('/api/auth')

  if (isAuthApi) return NextResponse.next()
  if (isLoginPage) {
    if (isLoggedIn) return NextResponse.redirect(new URL('/', req.url))
    return NextResponse.next()
  }
  if (!isLoggedIn) return NextResponse.redirect(new URL('/login', req.url))
  return NextResponse.next()
})

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
