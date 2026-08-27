/**
 * Request gate for the whole app.
 *
 * This was `middleware.ts` until Next 16 deprecated that file convention and
 * renamed it to `proxy`. It is a rename only — same NextRequest/NextResponse
 * API, same matcher semantics. The official codemod
 * (`npx @next/codemod@canary middleware-to-proxy .`) also renames a function
 * exported as `middleware` to `proxy`; that does not apply here, because
 * next-auth's `auth()` wrapper is a default export, which the proxy convention
 * accepts as-is.
 *
 * One behaviour worth knowing, inherited from the proxy convention: Next
 * buffers each request body in memory so it can be read both here and in the
 * route handler, capped at 10MB by default
 * (`experimental.proxyClientMaxBodySize`). Bodies over the cap are silently
 * truncated rather than rejected. The ingestion batches are the only large
 * bodies this app sends — 0.63MB per 1,000 rows on the current contract, ~2.3MB
 * once the e-file field map lands — so there is real headroom. If a future
 * phase raises MAX_ROWS or widens the column list far enough to approach 10MB,
 * raise the config rather than discovering it as a JSON parse error.
 */
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
