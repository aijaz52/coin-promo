import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { inspect } from 'node:util';

const require = createRequire('/tmp/solanadeps/node_modules/launch.cjs');
const root = new URL('../', import.meta.url);
const website = 'https://make.fun/bounty/makefun-coin-promo-01';
let connection;
let submittedSignature;

async function main() {
  if (!process.argv[2]) throw new Error('Usage: node scripts/launch.mjs <keypair.json>');
  const { Keypair, Connection, VersionedTransaction } = require('@solana/web3.js');
  const secret = JSON.parse(await readFile(process.argv[2], 'utf8'));
  if (!Array.isArray(secret) || secret.length !== 64 ||
      !secret.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    throw new Error('Keypair file must contain a JSON array of 64 byte values');
  }
  const wallet = Keypair.fromSecretKey(Uint8Array.from(secret));
  const concept = await readFile(new URL('assets/concept.md', root), 'utf8');
  const name = concept.match(/^# (.+)$/m)?.[1]?.trim();
  const symbol = concept.match(/^Ticker: (.+)$/m)?.[1]?.trim();
  const description = concept.match(/(?:^|\n)## Description text\r?\n\r?\n([\s\S]*?)(?=\r?\n## |$)/)?.[1]?.trim();
  if (!name || !symbol || !description) throw new Error('Missing concept name, ticker, or description');
  if (!description.split(/\r?\n/).includes(website)) {
    throw new Error('Concept description must contain the bounty URL on its own line');
  }
  const logo = await readFile(new URL('assets/logo.png', root));
  async function upload(includeEmptySocials) {
    const form = new FormData();
    form.append('file', new Blob([logo], { type: 'image/png' }), 'logo.png');
    for (const [field, value] of Object.entries({ name, symbol, description, website })) {
      form.append(field, value);
    }
    if (includeEmptySocials) {
      form.append('twitter', '');
      form.append('telegram', '');
    }
    const response = await fetch('https://pump.fun/api/ipfs', {
      method: 'POST', body: form, signal: AbortSignal.timeout(60_000),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`IPFS upload HTTP ${response.status}: ${text}`);
    const metadata = JSON.parse(text);
    const uri = metadata.metadataUri ?? metadata.uri;
    if (typeof uri !== 'string' || !uri) throw new Error(`IPFS response has no metadata URI: ${text}`);
    return uri;
  }
  let uri;
  try {
    uri = await upload(true);
  } catch (error) {
    console.error('IPFS upload with empty social fields failed:', error);
    console.error('Retrying IPFS upload without twitter and telegram.');
    uri = await upload(false);
  }
  console.log(`Metadata uploaded: ${uri}`);
  const mint = Keypair.generate();
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
  if (!response.ok) throw new Error(`PumpPortal HTTP ${response.status}: ${await response.text()}`);
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
  transaction.sign([mint, wallet]);
  connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed');
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
