import Header from "@/shared/components/header/Header"

export default function PrivacyPage() {
  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Header title="Privacy Policy" slideUp={false} />
      <div className="flex-1 overflow-y-auto p-4 mx-4 md:p-8 pt-[calc(4rem+env(safe-area-inset-top))] pb-[calc(4rem+env(safe-area-inset-bottom))] md:pt-4 md:pb-4">
        <div className="flex justify-center">
          <div className="flex-1 max-w-4xl">
            <div className="prose max-w-prose">
              <h1>Privacy Policy</h1>

              <p>
                <strong>Last Updated: {new Date().toLocaleDateString()}</strong>
              </p>

              <h2>What Data We Collect</h2>
              <p>
                <strong>We collect minimal personal data.</strong> Iris runs on your
                device and connects to decentralized networks. We don&apos;t track your
                activity, collect analytics, or store your posts on our servers.
              </p>
              <p>
                <strong>Iris usernames (iris.to/username):</strong> If you register a
                username, we log your public key, username, registration IP address, and
                country. This data is necessary to prevent abuse and maintain the username
                service.
              </p>

              <h2>Your Data is Local</h2>
              <p>
                Everything is stored on your device: your keys, ecash tokens, settings,
                and cached content. You&apos;re responsible for securing your device and
                backing up your data. If you lose your device or clear storage, your data
                may be permanently lost.
              </p>

              <h2>Third-Party Services</h2>
              <p>Iris connects you to decentralized services we don&apos;t control:</p>
              <p>
                <strong>Nostr relays</strong> may log your IP address and store the posts
                you publish publicly. Content posted to Nostr is public and permanent.
              </p>
              <p>
                <strong>Cashu mints</strong> may log your IP and track ecash transactions.
                We don&apos;t operate any mints.
              </p>
              <p>
                <strong>File hosts</strong> may log uploads. Files you upload may be
                publicly accessible.
              </p>

              <h2>Your Control</h2>
              <p>
                You control your data. Delete it by clearing storage or uninstalling the
                app. Choose which relays and mints to use in settings. Export your data
                anytime.
              </p>

              <h2>Open Source</h2>
              <p>
                Iris is open source. Verify our privacy claims at{" "}
                <a
                  href="https://files.iris.to/#/npub1xndmdgymsf4a34rzr7346vp8qcptxf75pjqweh8naa8rklgxpfqqmfjtce/iris-client"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  files.iris.to
                </a>
              </p>

              <h2>Contact</h2>
              <p>
                Questions? Reach us at{" "}
                <a href="mailto:irismessenger@pm.me">irismessenger@pm.me</a>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
