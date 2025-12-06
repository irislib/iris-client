#!/usr/bin/env node

import {spawn} from "child_process"
import {readFileSync} from "fs"
import {setTimeout as sleep} from "timers/promises"

const REPORT_PATH = "./lighthouse-report"
const PORT = 4173
const URL = `http://localhost:${PORT}`

// Parse CLI args
const args = process.argv.slice(2)
const openReport = args.includes("--open")
const jsonOnly = args.includes("--json")

// Start preview server
console.log("Starting preview server...")
const server = spawn("npx", ["vite", "preview", "--port", PORT], {
  stdio: jsonOnly ? "ignore" : "inherit",
})

// Wait for server to be ready
await sleep(3000)

try {
  // Run lighthouse
  if (!jsonOnly) console.log("\nRunning Lighthouse audit...\n")

  const lhArgs = [
    "lighthouse",
    URL,
    "--only-categories=performance",
    "--output=json",
    "--output=html",
    `--output-path=${REPORT_PATH}`,
    "--quiet",
  ]

  if (openReport) lhArgs.push("--view")

  await new Promise((resolve, reject) => {
    const lh = spawn("npx", lhArgs, {
      stdio: jsonOnly ? "pipe" : "inherit",
    })
    lh.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`Exit ${code}`))))
  })

  // Parse and display results
  const report = JSON.parse(readFileSync(`${REPORT_PATH}.report.json`, "utf8"))
  const {categories, audits} = report
  const perf = categories.performance

  if (jsonOnly) {
    // Machine-readable output for LLMs
    console.log(
      JSON.stringify(
        {
          score: perf.score * 100,
          metrics: {
            fcp: audits["first-contentful-paint"].numericValue,
            lcp: audits["largest-contentful-paint"].numericValue,
            tbt: audits["total-blocking-time"].numericValue,
            cls: audits["cumulative-layout-shift"].numericValue,
            si: audits["speed-index"].numericValue,
            tti: audits.interactive.numericValue,
          },
          displayValues: {
            fcp: audits["first-contentful-paint"].displayValue,
            lcp: audits["largest-contentful-paint"].displayValue,
            tbt: audits["total-blocking-time"].displayValue,
            cls: audits["cumulative-layout-shift"].displayValue,
            si: audits["speed-index"].displayValue,
            tti: audits.interactive.displayValue,
          },
          issues: Object.entries(audits)
            .filter(([_, v]) => v.score !== null && v.score < 0.9 && v.numericValue)
            .sort((a, b) => (b[1].numericValue || 0) - (a[1].numericValue || 0))
            .slice(0, 10)
            .map(([k, v]) => ({
              id: k,
              title: v.title,
              score: v.score,
              displayValue: v.displayValue,
            })),
          reports: {
            json: `${REPORT_PATH}.report.json`,
            html: `${REPORT_PATH}.report.html`,
          },
        },
        null,
        2
      )
    )
  } else {
    // Human-readable output
    const score = Math.round(perf.score * 100)
    const scoreEmoji = score >= 90 ? "🟢" : score >= 50 ? "🟡" : "🔴"

    console.log(`\n${"=".repeat(60)}`)
    console.log(`  LIGHTHOUSE PERFORMANCE REPORT`)
    console.log(`${"=".repeat(60)}\n`)
    console.log(`  Overall Score: ${scoreEmoji} ${score}/100\n`)
    console.log(`  Core Web Vitals:`)
    console.log(`  ├─ FCP: ${audits["first-contentful-paint"].displayValue}`)
    console.log(`  ├─ LCP: ${audits["largest-contentful-paint"].displayValue}`)
    console.log(`  ├─ TBT: ${audits["total-blocking-time"].displayValue}`)
    console.log(`  ├─ CLS: ${audits["cumulative-layout-shift"].displayValue}`)
    console.log(`  ├─ SI:  ${audits["speed-index"].displayValue}`)
    console.log(`  └─ TTI: ${audits.interactive.displayValue}\n`)

    // Top issues
    const issues = Object.entries(audits)
      .filter(([_, v]) => v.score !== null && v.score < 0.9 && v.numericValue)
      .sort((a, b) => (b[1].numericValue || 0) - (a[1].numericValue || 0))
      .slice(0, 5)

    if (issues.length > 0) {
      console.log(`  Top Issues:`)
      issues.forEach(([_, v], i) => {
        const prefix = i === issues.length - 1 ? "└─" : "├─"
        console.log(`  ${prefix} ${v.title}`)
        console.log(`     ${v.displayValue || ""} (score: ${(v.score * 100).toFixed(0)})`)
      })
      console.log()
    }

    console.log(`  Reports:`)
    console.log(`  ├─ JSON: ${REPORT_PATH}.report.json`)
    console.log(`  └─ HTML: ${REPORT_PATH}.report.html`)
    console.log(`\n${"=".repeat(60)}\n`)

    if (!openReport) {
      console.log(`💡 Run with --open to view HTML report in browser\n`)
    }
  }
} finally {
  // Cleanup
  server.kill()
}
