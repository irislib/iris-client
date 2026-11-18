// Served at /service-worker.js on the Sites apex to update existing Iris Client
// installations. Navigation falls through to the network, and recovery data and
// the separate /cashu/ registration stay available on this origin.
self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()))
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()))
