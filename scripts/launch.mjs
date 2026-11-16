import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { inspect, promisify } from 'node:util';
import { execFile } from 'node:child_process';

const require = createRequire('/tmp/solanadeps/node_modules/launch.cjs');
const root = new URL('../', import.meta.url);
const website = 'https://make.fun/bounty/makefun-coin-promo-01';
const run = promisify(execFile);
const uploadEndpoints = [
  'https://pump.fun/api/ipfs',
  'https://frontend-api.pump.fun/api/ipfs',
  'https://front-end-api.pump.fun/api/ipfs',
  'https://www.pump.fun/api/ipfs',
];
const browserHeaders = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
};
let connection;
let submittedSignature;

async function main() {
  if (!process.argv[2]) throw new Error('Usage: node scripts/launch.mjs <keypair.json> [raw-content-base-url]');
  const rawBase = new URL(`${(process.argv[3] || 'https://raw.githubusercontent.com/aijaz52/coin-promo/main').replace(/\/+$/, '')}/`);
  if (rawBase.protocol !== 'https:') throw new Error('Raw content base URL must use HTTPS');
  const { Keypair, Connection, VersionedTransaction } = require('@solana/web3.js');
  const secret = JSON.parse(await readFile(process.argv[2], 'utf8'));
  if (!Array.isArray(secret) || secret.length !== 64 ||
      !secret.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    throw new Error('Keypair file must contain a JSON array of 64 byte values');
  }
  const wallet = await Keypair.fromSecretKey(Uint8Array.from(secret));
  const concept = await readFile(new URL('assets/concept.md', root), 'utf8');
  const name = concept.match(/^# (.+)$/m)?.[1]?.trim();
  const symbol = concept.match(/^Ticker: (.+)$/m)?.[1]?.trim();
  const description = concept.match(/(?:^|\n)## Description text\r?\n\r?\n([\s\S]*?)(?=\r?\n## |$)/)?.[1]?.trim();
  if (!name || !symbol || !description) throw new Error('Missing concept name, ticker, or description');
  if (!description.split(/\r?\n/).includes(website)) {
    throw new Error('Concept description must contain the bounty URL on its own line');
  }
  const logo = await readFile(new URL('assets/logo.png', root));
  async function upload(endpoint) {
    const form = new FormData();
    form.append('file', new Blob([logo], { type: 'image/png' }), 'logo.png');
    for (const [field, value] of Object.entries({ name, symbol, description, website })) {
      form.append(field, value);
    }
    const response = await fetch(endpoint, {
      method: 'POST', headers: browserHeaders, body: form, signal: AbortSignal.timeout(60_000),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`IPFS upload HTTP ${response.status}: ${text}`);
    const metadata = JSON.parse(text);
    const uri = metadata.metadataUri ?? metadata.uri;
    if (typeof uri !== 'string' || !uri) throw new Error(`IPFS response has no metadata URI: ${text}`);
    return uri;
  }
  let uri;
  for (const endpoint of uploadEndpoints) {
    console.log(`Trying metadata upload: ${endpoint}`);
    try {
      uri = await upload(endpoint);
      console.log(`Metadata uploaded: ${uri}`);
      break;
    } catch (error) {
      console.error(`Metadata upload failed at ${endpoint}:`, error);
    }
  }
  if (!uri) {
    const metadata = { name, symbol, description, image: new URL('assets/logo.png', rawBase).href };
    await writeFile(new URL('assets/metadata.json', root), `${JSON.stringify(metadata, null, 2)}\n`);
    const git = async (...args) => run('git', args, { cwd: root });
    for (const args of [['status', '--short'], ['diff'], ['log', '--oneline', '-10']]) {
      await git(...args);
    }
    await git('add', '--', 'assets/metadata.json');
    let changed = false;
    try {
      await git('diff', '--cached', '--quiet', '--', 'assets/metadata.json');
    } catch (error) {
      if (error.code !== 1) throw error;
      changed = true;
    }
    if (changed) {
      console.log((await git('commit', '--only', '-m', 'Add GitHub fallback token metadata', '--', 'assets/metadata.json')).stdout.trim());
    } else {
      console.log('Fallback metadata is already committed.');
    }
    uri = new URL('assets/metadata.json', rawBase).href;
    console.log(`GitHub metadata fallback: ${uri}`);
    console.log('The repo must be pushed to GitHub first so assets/metadata.json and assets/logo.png are publicly available at these raw URLs.');
    console.log('Continuing with the create transaction using the GitHub metadata URI.');
  }
  const mint = await Keypair.generate();
  console.log(`Requesting create transaction from https://pumpportal.fun/api/trade-local (metadata: ${uri})`);
  const response = await fetch('https://pumpportal.fun/api/trade-local', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicKey: wallet.publicKey.toBase58(), action: 'create',
      tokenMetadata: { uri, name, symbol, decimals: 6 },
      mint: mint.publicKey.toBase58(), denominatedInSol: 'true',
      amount: 1, slippage: 10, priorityFee: 0.0005, pool: 'pump',
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`trade-local HTTP ${response.status}: ${await response.text()}`);
  console.log(`trade-local HTTP ${response.status}: received create transaction`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') ?? '';
  let serialized = bytes;
  if (contentType.includes('json')) {
    const result = JSON.parse(bytes.toString('utf8'));
    const base64 = typeof result === 'string' ? result : result.transaction;
    if (typeof base64 !== 'string') throw new Error(`Unexpected PumpPortal response: ${bytes.toString('utf8')}`);
    serialized = Buffer.from(base64, 'base64');
  } else if (/^[A-Za-z0-9+/=\s]+$/.test(bytes.toString('utf8'))) {
    serialized = Buffer.from(bytes.toString('utf8').trim(), 'base64');
  }
  const transaction = VersionedTransaction.deserialize(serialized);
  await transaction.sign([mint, wallet]);
  connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed');
  console.log('Submitting signed create transaction with RPC preflight enabled.');
  submittedSignature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false, preflightCommitment: 'confirmed',
  });
  console.log(`Transaction submitted: ${submittedSignature}`);
  const confirmation = await connection.confirmTransaction(submittedSignature, 'confirmed');
  if (confirmation.value.err) {
    throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
  }
  const launch = { mint: mint.publicKey.toBase58(), create_signature: submittedSignature };
  await writeFile(new URL('LAUNCH.json', root), `${JSON.stringify(launch, null, 2)}\n`);
  console.log(`Launch confirmed: ${JSON.stringify(launch)}`);
}

main().catch(async (error) => {
  console.error(inspect(error, { depth: null, colors: false }));
  if (connection && typeof error.getLogs === 'function') {
    try {
      console.error('RPC logs:', await error.getLogs(connection));
    } catch (logError) {
      console.error('Unable to fetch RPC logs:', logError);
    }
  }
  if (connection && submittedSignature) {
    try {
      const transaction = await connection.getTransaction(submittedSignature, {
        commitment: 'confirmed', maxSupportedTransactionVersion: 0,
      });
      console.error('RPC logs:', transaction?.meta?.logMessages ?? 'Not available');
    } catch (logError) {
      console.error('Unable to fetch transaction logs:', logError);
    }
  }
  process.exitCode = 1;
});
