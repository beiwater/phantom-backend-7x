import puppeteer, { Page } from 'puppeteer';

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:3000';

interface LatencyResult {
  round: number;
  type: 'send' | 'reply';
  domLatencyMs: number;
  networkLatencyMs: number;
}

async function createUser(label: string): Promise<{ email: string; sessionid: string; companyName: string }> {
  const companyName = `DomTester_${label}_${Date.now()}`;
  const email = `dom_${label}_${Date.now()}@domain.local`;
  const res = await fetch(`${baseUrl}/api/v2/auth/email/connect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password123!', company: companyName })
  });
  if (!res.ok) {
    throw new Error(`Registration failed: ${res.status} ${await res.text()}`);
  }
  const rawCookie = (res.headers.getSetCookie?.() || []).find(c => c.startsWith('sessionid='));
  if (!rawCookie) {
    throw new Error('No sessionid cookie returned');
  }
  const sessionid = rawCookie.split(';')[0].split('=')[1];
  return { email, sessionid, companyName };
}

async function getSendButton(page: Page) {
  const handle = await page.evaluateHandle(() => {
    const svg = document.querySelector('svg[data-icon="paper-plane"]');
    return svg?.closest('button') || document.querySelector('button.css-15ic6os');
  });
  return handle.asElement() as any;
}

async function main() {
  console.log('================================================================');
  console.log('       Real Browser DOM Chat Latency & Parity Benchmark         ');
  console.log(` Target: ${baseUrl}`);
  console.log('================================================================\n');

  console.log('[Setup] Registering 2 test players (Sender Alice & Receiver Bob)...');
  const alice = await createUser('Alice');
  const bob = await createUser('Bob');
  console.log(`  -> Alice created: ${alice.companyName}`);
  console.log(`  -> Bob created: ${bob.companyName}`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900']
  });

  try {
    // 1. Setup Alice's tab
    console.log('\n[Setup] Opening Alice chat tab in isolated context...');
    const contextAlice = await browser.createBrowserContext();
    const pageAlice = await contextAlice.newPage();
    await pageAlice.setViewport({ width: 1440, height: 900 });
    await pageAlice.setCookie({ name: 'sessionid', value: alice.sessionid, domain: '127.0.0.1', path: '/' });
    await pageAlice.goto(`${baseUrl}/zh-cn/messages/chatroom_Game/`, { waitUntil: 'networkidle2' });

    const rulesAlice = await pageAlice.$('.js-test-chat-rules-ok');
    if (rulesAlice) {
      await rulesAlice.click();
      await new Promise(r => setTimeout(r, 400));
    }
    await pageAlice.waitForSelector('textarea', { timeout: 10000 });
    console.log('  -> Alice is in chatroom and textarea is ready.');

    // 2. Setup Bob's tab in separate isolated context
    console.log('[Setup] Opening Bob chat tab in isolated context...');
    const contextBob = await browser.createBrowserContext();
    const pageBob = await contextBob.newPage();
    await pageBob.setViewport({ width: 1440, height: 900 });
    await pageBob.setCookie({ name: 'sessionid', value: bob.sessionid, domain: '127.0.0.1', path: '/' });
    await pageBob.goto(`${baseUrl}/zh-cn/messages/chatroom_Game/`, { waitUntil: 'networkidle2' });

    const rulesBob = await pageBob.$('.js-test-chat-rules-ok');
    if (rulesBob) {
      await rulesBob.click();
      await new Promise(r => setTimeout(r, 400));
    }
    await pageBob.waitForSelector('textarea', { timeout: 10000 });
    console.log('  -> Bob is in chatroom and textarea is ready.\n');

    const results: LatencyResult[] = [];

    // Run 3 consecutive rounds of Send & Reply
    for (let round = 1; round <= 3; round++) {
      console.log(`------------------ Round ${round} ------------------`);

      // A. Alice sends a new message
      const aliceMsg = `Alice_Msg_Round${round}_${Date.now()}`;
      console.log('  [Step A.1] Typing message:', aliceMsg);
      await pageAlice.focus('textarea');
      await pageAlice.type('textarea', aliceMsg);

      let aliceReqStart = 0;
      let aliceReqEnd = 0;
      const onAliceReq = (req: { url: () => string }) => {
        if (req.url().includes('/api/v2/message/')) {
          aliceReqStart = performance.now();
          console.log('  [Step A.req] POST /api/v2/message/ started');
        }
      };
      const onAliceRes = (res: { url: () => string; status: () => number }) => {
        if (res.url().includes('/api/v2/message/')) {
          aliceReqEnd = performance.now();
          console.log('  [Step A.res] POST /api/v2/message/ responded:', res.status());
        }
      };
      pageAlice.on('request', onAliceReq);
      pageAlice.on('response', onAliceRes);

      console.log('  [Step A.2] Finding send button');
      const sendBtnAlice = await getSendButton(pageAlice);
      if (!sendBtnAlice) throw new Error('Send button not found in Alice tab');
      const btnHtml = await pageAlice.evaluate(b => b.outerHTML, sendBtnAlice);
      console.log('  [Step A.2.btn] Button found:', btnHtml);

      console.log('  [Step A.3] Clicking send button');
      const sendStart = performance.now();
      await sendBtnAlice.click();

      console.log('  [Step A.4] Waiting for text to appear in Alice DOM');
      await pageAlice.waitForFunction(
        text => document.body.innerText.includes(text),
        { timeout: 10000 },
        aliceMsg
      );
      console.log('  [Step A.5] Alice DOM updated!');
      const sendEnd = performance.now();
      pageAlice.off('request', onAliceReq);
      pageAlice.off('response', onAliceRes);

      const sendDomMs = sendEnd - sendStart;
      const sendNetMs = aliceReqEnd > aliceReqStart ? aliceReqEnd - aliceReqStart : 0;

      results.push({
        round,
        type: 'send',
        domLatencyMs: sendDomMs,
        networkLatencyMs: sendNetMs
      });

      console.log(`[Alice -> Send Message]`);
      console.log(`  • DOM Render Latency:    ${sendDomMs.toFixed(2)} ms (Button Click -> DOM Updated)`);
      console.log(`  • Network POST Latency:  ${sendNetMs.toFixed(2)} ms (HTTP /api/v2/message/)`);

      // Wait for Bob's tab to receive Alice's message via live update or refresh
      const bobReceiveStart = performance.now();
      await pageBob.waitForFunction(
        text => document.body.innerText.includes(text),
        { timeout: 15000 },
        aliceMsg
      );
      const bobReceiveMs = performance.now() - bobReceiveStart;
      console.log(`  • Bob Received in DOM:   ${bobReceiveMs.toFixed(2)} ms`);

      // B. Bob replies to Alice's message
      const replyButtons = await pageBob.$$('button[aria-label="Reply"]');
      if (replyButtons.length > 0) {
        await replyButtons[replyButtons.length - 1].click();
        await new Promise(r => setTimeout(r, 200));
      }

      const bobReplyMsg = `Bob_Reply_Round${round}_${Date.now()}`;
      await pageBob.type('textarea', ` ${bobReplyMsg}`);

      let bobReqStart = 0;
      let bobReqEnd = 0;
      const onBobReq = (req: { url: () => string }) => {
        if (req.url().includes('/api/v2/message/')) bobReqStart = performance.now();
      };
      const onBobRes = (res: { url: () => string }) => {
        if (res.url().includes('/api/v2/message/')) bobReqEnd = performance.now();
      };
      pageBob.on('request', onBobReq);
      pageBob.on('response', onBobRes);

      const sendBtnBob = await getSendButton(pageBob);
      if (!sendBtnBob) throw new Error('Send button not found in Bob tab');

      const replyStart = performance.now();
      await sendBtnBob.click();

      // Wait for Bob's DOM to render the reply
      await pageBob.waitForFunction(
        text => document.body.innerText.includes(text),
        { timeout: 10000 },
        bobReplyMsg
      );
      const replyEnd = performance.now();
      pageBob.off('request', onBobReq);
      pageBob.off('response', onBobRes);

      const replyDomMs = replyEnd - replyStart;
      const replyNetMs = bobReqEnd > bobReqStart ? bobReqEnd - bobReqStart : 0;

      results.push({
        round,
        type: 'reply',
        domLatencyMs: replyDomMs,
        networkLatencyMs: replyNetMs
      });

      console.log(`[Bob -> Send Reply]`);
      console.log(`  • DOM Render Latency:    ${replyDomMs.toFixed(2)} ms (Reply Click -> DOM Updated)`);
      console.log(`  • Network POST Latency:  ${replyNetMs.toFixed(2)} ms (HTTP /api/v2/message/)`);

      // Alice receives Bob's reply in her DOM
      const aliceReceiveStart = performance.now();
      await pageAlice.waitForFunction(
        text => document.body.innerText.includes(text),
        { timeout: 15000 },
        bobReplyMsg
      );
      const aliceReceiveMs = performance.now() - aliceReceiveStart;
      console.log(`  • Alice Received in DOM: ${aliceReceiveMs.toFixed(2)} ms\n`);
    }

    // Summary statistics
    console.log('================================================================');
    console.log('                     BENCHMARK SUMMARY                          ');
    console.log('================================================================');
    const sendDoms = results.filter(r => r.type === 'send').map(r => r.domLatencyMs);
    const sendNets = results.filter(r => r.type === 'send').map(r => r.networkLatencyMs);
    const replyDoms = results.filter(r => r.type === 'reply').map(r => r.domLatencyMs);
    const replyNets = results.filter(r => r.type === 'reply').map(r => r.networkLatencyMs);

    const avg = (arr: number[]) => (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2);
    const min = (arr: number[]) => Math.min(...arr).toFixed(2);
    const max = (arr: number[]) => Math.max(...arr).toFixed(2);

    console.log(`[Send Message (Alice)]`);
    console.log(`  DOM Latency (ms):      Avg = ${avg(sendDoms)} ms  |  Min = ${min(sendDoms)} ms  |  Max = ${max(sendDoms)} ms`);
    console.log(`  Network POST (ms):     Avg = ${avg(sendNets)} ms  |  Min = ${min(sendNets)} ms  |  Max = ${max(sendNets)} ms`);
    console.log(`[Reply Message (Bob)]`);
    console.log(`  DOM Latency (ms):      Avg = ${avg(replyDoms)} ms  |  Min = ${min(replyDoms)} ms  |  Max = ${max(replyDoms)} ms`);
    console.log(`  Network POST (ms):     Avg = ${avg(replyNets)} ms  |  Min = ${min(replyNets)} ms  |  Max = ${max(replyNets)} ms`);
    console.log('================================================================');

  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('Benchmark error:', err);
  process.exit(1);
});
