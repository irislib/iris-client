import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const relayConnectivitySource = fs.readFileSync(
  path.resolve(process.cwd(), 'src', 'shared', 'components', 'RelayConnectivityIndicator.tsx'),
  'utf8',
)
const networkSettingsSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src', 'pages', 'settings', 'Network.tsx'),
  'utf8',
)

describe('header relay connectivity indicator source', () => {
  it('keeps the full relay indicator behind the header connectivity setting', () => {
    expect(networkSettingsSource).toContain('Show connectivity in header')
    expect(relayConnectivitySource).toContain('if (!showRelayIndicator) return null')
    expect(relayConnectivitySource).toContain('if (showRelayIndicator || (isOnline && relayCount > 0)) return null')
    expect(relayConnectivitySource).toContain('aria-label="Offline"')
    expect(relayConnectivitySource).toContain('>\n      offline\n    </Link>')
  })
})
