import { auth } from '@/auth'
import { NextResponse } from 'next/server'

export default auth((req) => {
  const isLoggedIn   = !!req.auth
  const path         = req.nextUrl.pathname
  const isLoginPage  = path === '/login'
  const isPublicApi  = path.startsWith('/api/auth') || path.startsWith('/api/filings') ||
                       path.startsWith('/api/organizations') || path.startsWith('/api/cohorts')

  if (isPublicApi) return NextResponse.next()
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
