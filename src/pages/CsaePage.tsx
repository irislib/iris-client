import Header from "@/shared/components/header/Header"

export default function CsaePage() {
  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Header title="Child Safety Standards" slideUp={false} />
      <div className="flex-1 overflow-y-auto p-4 mx-4 md:p-8 pt-[calc(4rem+env(safe-area-inset-top))] pb-[calc(4rem+env(safe-area-inset-bottom))] md:pt-4 md:pb-4">
        <div className="flex justify-center">
          <div className="flex-1 max-w-4xl">
            <div className="prose max-w-prose">
              <h1>Child Safety Standards</h1>

              <p>
                <strong>Last Updated: {new Date().toLocaleDateString()}</strong>
              </p>

              <h2>Our Commitment</h2>
              <p>
                Iris is committed to protecting children from sexual abuse and
                exploitation (CSAE). We have zero tolerance for child sexual abuse
                material (CSAM) and actively work to prevent its distribution on our
                platform.
              </p>

              <h2>Content Moderation Tools</h2>
              <p>Users have access to the following safety features:</p>
              <ul>
                <li>
                  <strong>Report Function:</strong> Every post includes a report button to
                  flag inappropriate content
                </li>
                <li>
                  <strong>User Blocking:</strong> Users can block accounts to prevent
                  interaction and hide their content
                </li>
                <li>
                  <strong>Content Filtering:</strong> Users can customize their content
                  preferences in settings
                </li>
              </ul>

              <h2>Decentralized Architecture</h2>
              <p>
                <strong>Important:</strong> Iris is a client application for the
                decentralized Nostr protocol. We do not host or store user-generated
                content. Content is stored on independent third-party relay servers that
                we do not operate or control.
              </p>
              <p>When users encounter illegal content, they should:</p>
              <ul>
                <li>Use the report function within the app</li>
                <li>Contact the relay operator hosting the content directly</li>
                <li>
                  Report CSAM to the National Center for Missing & Exploited Children
                  (NCMEC) at{" "}
                  <a
                    href="https://report.cybertip.org"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    report.cybertip.org
                  </a>
                </li>
                <li>
                  Contact local law enforcement or the Internet Watch Foundation in your
                  region
                </li>
              </ul>

              <h2>Linked Content</h2>
              <p>
                Posts may contain links to external websites and media hosted by third
                parties. Iris does not host this content. Users should report illegal
                external content to the hosting provider or appropriate authorities.
              </p>

              <h2>Reporting to Authorities</h2>
              <p>
                If you encounter CSAM or suspect child exploitation, please report it
                immediately:
              </p>
              <ul>
                <li>
                  <strong>United States:</strong>{" "}
                  <a
                    href="https://report.cybertip.org"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    CyberTipline (NCMEC)
                  </a>
                </li>
                <li>
                  <strong>International:</strong>{" "}
                  <a
                    href="https://www.iwf.org.uk"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Internet Watch Foundation
                  </a>
                </li>
                <li>
                  <strong>Emergency:</strong> Contact your local law enforcement
                </li>
              </ul>

              <h2>Contact Us</h2>
              <p>
                For questions about our child safety standards or to report concerns,
                contact us at <a href="mailto:irismessenger@pm.me">irismessenger@pm.me</a>
              </p>

              <h2>Transparency</h2>
              <p>
                Iris is open source software. Our code and safety implementations can be
                reviewed at{" "}
                <a
                  href="https://files.iris.to/#/npub1xndmdgymsf4a34rzr7346vp8qcptxf75pjqweh8naa8rklgxpfqqmfjtce/iris-client"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  files.iris.to
                </a>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
