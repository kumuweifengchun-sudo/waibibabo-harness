/** Validate unsigned macOS Actions settings without machine presets or signing credentials. */
import { appendFileSync, readFileSync } from 'node:fs'
import { desktopCiVersion } from './desktop-ci-version.mjs'
import { desktopTargetPlatform, resolveDesktopBuildTarget } from './desktop-build-paths.mjs'
import { localMacOSPackageEnvironment, validateDesktopPackageEnvironment } from './desktop-package-environment.mjs'

const target = desktopTargetPlatform(resolveDesktopBuildTarget())
if (target.platform !== 'darwin') throw new Error('macOS hosted packaging requires a macOS target')
if (!process.env.GITHUB_OUTPUT || !process.env.GITHUB_STEP_SUMMARY) throw new Error('Run this adapter from GitHub Actions')
const product = JSON.parse(readFileSync(new URL('../../../packages/llm/llm/src/waibibabo-product.json', import.meta.url), 'utf8'))
const version = desktopCiVersion(process.env, product.version)
validateDesktopPackageEnvironment(localMacOSPackageEnvironment(), target, { unsigned: true })
appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`)
appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
  `## macOS ${target.arch} unsigned installer`,
  '',
  `Version: ${version}`,
  '',
  'Download the DMG and ZIP from this run\'s Artifacts after packaging succeeds. SHA256SUMS.txt records their SHA-256 hashes.',
  '',
  'This build is unsigned and not notarized. macOS may block downloaded copies. Use it for internal testing; this workflow does not publish releases or update feeds.',
  '',
].join('\n'))
