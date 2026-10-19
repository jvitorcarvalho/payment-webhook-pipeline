import { loadConfig } from '@pipeline/shared';
import { computeSignature } from '@pipeline/shared/signature.js';
import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: join(__dirname, '..', '..', '..', '.env') });

const config = loadConfig();

interface GatewaySimOptions {
  count: number;
  duplicate?: string;
  url: string;
  delay: number;
}

function parseArgs(): GatewaySimOptions {
  const args = process.argv.slice(2);
  const options: GatewaySimOptions = {
    count: 3,
    url: `http://localhost:${config.ingestPort}/webhooks/payments`,
    delay: 100,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--count':
      case '-n': {
        const val = args[++i];
        if (val) options.count = parseInt(val, 10);
        break;
      }
      case '--duplicate':
      case '-d': {
        const val = args[++i];
        if (val) options.duplicate = val;
        break;
      }
      case '--url':
      case '-u': {
        const val = args[++i];
        if (val) options.url = val;
        break;
      }
      case '--delay': {
        const val = args[++i];
        if (val) options.delay = parseInt(val, 10);
        break;
      }
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Gateway Simulator - Sends signed fake payment events to the ingest API

Usage: npm run start -- [options]

Options:
  -n, --count <number>     Number of unique events to send (default: 3)
  -d, --duplicate <event_id>  Event ID to duplicate (send twice)
  -u, --url <url>          Target URL (default: http://localhost:3000/webhooks/payments)
  --delay <ms>             Delay between requests in ms (default: 100)
  -h, --help               Show this help
`);
}

function generateEvent(eventId: string) {
  return {
    event_id: eventId,
    amount: Math.floor(Math.random() * 10000) / 100,
    currency: 'BRL',
    customer: `Customer ${eventId}`,
    order_id: `order_${eventId}`,
    timestamp: new Date().toISOString(),
  };
}

async function sendEvent(url: string, event: Record<string, unknown>, webhookSecret: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  const rawBody = JSON.stringify(event);
  const signature = computeSignature(webhookSecret, timestamp, rawBody).toString('hex');
  const header = `t=${timestamp},v1=${signature}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-signature': header,
    },
    body: rawBody,
  });

  return { status: response.status, eventId: event.event_id };
}

async function main() {
  const options = parseArgs();

  console.log(`Sending ${options.count} unique event(s) to ${options.url}`);
  if (options.duplicate) {
    console.log(`Will duplicate event: ${options.duplicate}`);
  }

  // Generate unique event IDs
  const eventIds: string[] = [];
  for (let i = 0; i < options.count; i++) {
    eventIds.push(options.duplicate && i === 0 ? options.duplicate : `evt_sim_${Date.now()}_${i}`);
  }

  // Send each event
  for (const eventId of eventIds) {
    const event = generateEvent(eventId);
    const result = await sendEvent(options.url, event, config.webhookSecret);
    console.log(`  Event ${eventId}: HTTP ${result.status}`);

    if (options.delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, options.delay));
    }
  }

  // Send duplicate if specified
  if (options.duplicate) {
    console.log(`  Sending duplicate of ${options.duplicate}...`);
    const event = generateEvent(options.duplicate);
    const result = await sendEvent(options.url, event, config.webhookSecret);
    console.log(`  Event ${options.duplicate} (duplicate): HTTP ${result.status}`);
  }

  console.log('Done.');
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
