export default function TermsContent() {
  return (
    <>
      <p className="mb-3">
        <strong>Last Updated: {new Date().toLocaleDateString()}</strong>
      </p>

      <p className="mb-3">
        <strong>
          IMPORTANT: PLEASE READ CAREFULLY. BY USING THIS APPLICATION, YOU AGREE TO THESE
          TERMS.
        </strong>
      </p>

      <h3 className="font-bold mb-2 text-white">
        1. Software Provided &quot;AS IS&quot;
      </h3>
      <p className="mb-3">
        This software is provided &quot;AS IS&quot; without warranty of any kind, express
        or implied. We disclaim all warranties including merchantability, fitness for a
        particular purpose, and non-infringement. Use at your own risk.
      </p>

      <h3 className="font-bold mb-2 text-white">2. No Liability for Damages</h3>
      <p className="mb-3">
        We are not liable for any direct, indirect, incidental, special, consequential, or
        punitive damages arising from your use of this application, including but not
        limited to data loss, service interruption, or any other damages.
      </p>

      <h3 className="font-bold mb-2 text-white">
        3. Decentralized Social Network (Nostr)
      </h3>
      <p className="mb-3">
        This application connects to the Nostr protocol, a decentralized social network.
        We do not control the relays, content, or data you access. You are solely
        responsible for your interactions with third-party relays and content.
      </p>

      <h3 className="font-bold mb-2 text-white">
        4. Cashu Wallet - We Are Not the Custodian
      </h3>
      <p className="mb-3">
        <strong>IMPORTANT: This application includes a Cashu ecash wallet.</strong>
      </p>
      <p className="mb-3">
        • Cashu ecash is custodial - mints hold the actual Bitcoin
        <br />
        • We are NOT the custodian of your funds
        <br />
        • We do NOT operate a Cashu mint
        <br />
        • We do NOT hold, control, or have access to your ecash tokens
        <br />• All ecash tokens are managed entirely on your device
      </p>
      <p className="mb-3">
        You interact directly with third-party Cashu mints who act as custodians. We have
        no control over, responsibility for, or liability regarding any mint&apos;s
        operation, reliability, or solvency.
      </p>

      <h3 className="font-bold mb-2 text-white">5. No Liability for Lost Funds</h3>
      <p className="mb-3">
        <strong>YOU ASSUME ALL RISKS OF FINANCIAL LOSS.</strong> We are not responsible
        for any loss of funds due to:
      </p>
      <p className="mb-3">
        • Mint failures, insolvency, or fraud
        <br />
        • Device loss, damage, or theft
        <br />
        • User error or forgotten credentials
        <br />
        • Software bugs or vulnerabilities
        <br />
        • Network issues or relay failures
        <br />• Any other cause whatsoever
      </p>

      <h3 className="font-bold mb-2 text-white">6. Experimental Technology</h3>
      <p className="mb-3">
        Cashu ecash is experimental technology. Ecash tokens are bearer assets - anyone
        with the token secret can spend them. You are solely responsible for securing your
        tokens and understanding the risks.
      </p>

      <h3 className="font-bold mb-2 text-white">7. User Responsibility</h3>
      <p className="mb-3">You are solely responsible for:</p>
      <p className="mb-3">
        • Backing up your data and keys
        <br />
        • Securing your device
        <br />
        • Verifying mint trustworthiness
        <br />
        • Compliance with applicable laws
        <br />• Understanding how Nostr and Cashu work
      </p>

      <h3 className="font-bold mb-2 text-white">8. No Financial Services</h3>
      <p className="mb-3">
        This application does not provide financial, investment, or legal advice. We are
        not a financial institution, money transmitter, or payment processor.
      </p>

      <h3 className="font-bold mb-2 text-white">9. Legal Compliance</h3>
      <p className="mb-3">
        You must comply with all applicable laws in your jurisdiction. Use is void where
        prohibited. We make no representations about legality in any jurisdiction.
      </p>

      <h3 className="font-bold mb-2 text-white">10. Privacy and Data Collection</h3>
      <p className="mb-3">
        All application data is stored locally on your device. We do not track your
        activity or collect analytics.
      </p>
      <p className="mb-3">
        <strong>Iris Username Service:</strong> If you register an iris.to username, we
        collect and store your public key, username, registration IP address, and country.
        This data is necessary to operate the username service and prevent abuse.
      </p>
      <p className="mb-3">Third-party services may log your activity:</p>
      <p className="mb-3">
        • Nostr relays may log connections and events
        <br />
        • Cashu mints may log connections and transactions
        <br />• File hosting services (for images/media uploads) may log uploads and IPs
      </p>

      <h3 className="font-bold mb-2 text-white">11. Modifications</h3>
      <p className="mb-3">
        We may modify these terms at any time. Continued use constitutes acceptance.
      </p>

      <h3 className="font-bold mb-2 text-white">12. Acceptance</h3>
      <p className="mb-3">
        By using this application, you acknowledge that you have read, understood, and
        agree to these terms.
      </p>
    </>
  )
}
