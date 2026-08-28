/**
 * Creates a local certificate authority and a server certificate for serving
 * the web build to phones on your own network.
 *
 * Why this exists: a service worker only registers in a "secure context",
 * which means https or localhost. A phone reaching the laptop at
 * http://192.168.x.x is neither, so the app would run but could not be
 * installed to the home screen and would not work offline. Serving over https
 * fixes that — but a browser will not treat a certificate as valid unless it
 * chains to an authority the device trusts, and clicking past the warning does
 * NOT restore the secure context. So we make a small CA, install that once on
 * the phone, and sign the server certificate with it.
 *
 * The CA's private key never leaves this machine and signs nothing but this
 * one certificate. Delete certs/ to revoke the whole arrangement.
 *
 * Certificates are shaped to Apple's requirements, which are the strictest:
 * ECDSA P-256, subjectAltName present (a CommonName alone is ignored),
 * extendedKeyUsage serverAuth, and no more than 398 days of validity.
 *
 * Usage: node scripts/make-lan-cert.mjs [--days 397]
 */

import { mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { networkInterfaces } from 'node:os'

const run = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(root, 'certs')

const args = process.argv.slice(2)
const daysArg = args.indexOf('--days')
/** Apple rejects anything over 398 days outright. */
const DAYS = Math.min(daysArg >= 0 ? Number(args[daysArg + 1]) : 397, 398)

/** Every address a phone might reach this machine on. */
export function lanAddresses() {
  const found = []
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) found.push({ name, address: a.address })
    }
  }
  return found
}

async function openssl(...argv) {
  try {
    return await run('openssl', argv, { maxBuffer: 1024 * 1024 * 8 })
  } catch (err) {
    throw new Error(`openssl ${argv[0]} failed:\n${err.stderr || err.message}`)
  }
}

async function main() {
  const addresses = lanAddresses()
  if (addresses.length === 0) {
    console.error('No network address found. Connect to Wi-Fi and try again.')
    process.exit(1)
  }

  await rm(OUT, { recursive: true, force: true })
  await mkdir(OUT, { recursive: true })

  const caKey = join(OUT, 'ca.key')
  const caCrt = join(OUT, 'ca.crt')
  const srvKey = join(OUT, 'server.key')
  const srvCsr = join(OUT, 'server.csr')
  const srvCrt = join(OUT, 'server.crt')
  const extFile = join(OUT, 'server.ext')

  // --- the authority --------------------------------------------------------
  await openssl('ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', caKey)
  await openssl(
    'req', '-x509', '-new', '-key', caKey, '-sha256',
    // The CA outlives the leaf: reinstalling it on a phone is the annoying
    // part, so it is worth not repeating every year.
    '-days', '1825',
    '-out', caCrt,
    '-subj', '/CN=Chess Trainer Local CA/O=Chess Trainer',
    '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0',
    '-addext', 'keyUsage=critical,keyCertSign,cRLSign'
  )

  // --- the server certificate ----------------------------------------------
  await openssl('ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', srvKey)
  await openssl('req', '-new', '-key', srvKey, '-out', srvCsr, '-subj', '/CN=chess-trainer.local')

  // A CommonName is ignored by every modern browser; the SAN list is what
  // actually has to contain the address you type.
  const sans = [
    'DNS:localhost',
    'DNS:chess-trainer.local',
    'IP:127.0.0.1',
    ...addresses.map((a) => `IP:${a.address}`)
  ]
  await writeFile(
    extFile,
    [
      'basicConstraints=CA:FALSE',
      'keyUsage=critical,digitalSignature,keyEncipherment',
      'extendedKeyUsage=serverAuth',
      `subjectAltName=${sans.join(',')}`
    ].join('\n') + '\n',
    'utf8'
  )

  await openssl(
    'x509', '-req', '-in', srvCsr,
    '-CA', caCrt, '-CAkey', caKey, '-CAcreateserial',
    '-out', srvCrt, '-days', String(DAYS), '-sha256',
    '-extfile', extFile
  )

  await rm(srvCsr, { force: true })

  console.log('Certificate authority and server certificate written to certs/\n')
  console.log(`  Valid for ${DAYS} days, covering:`)
  for (const san of sans) console.log(`    ${san}`)
  console.log('\n  Install certs/ca.crt on the phone, then trust it.')
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('make-lan-cert.mjs')) {
  main().catch((err) => {
    console.error(err.message)
    process.exit(1)
  })
}
