import puppeteer, { BrowserWorker } from "@cloudflare/puppeteer";
import robotsParser from "robots-parser";

type Message = {
  url: string;
};

export interface Env {
  CRAWLER_QUEUE: Queue<Message>;
  CRAWLER_SCREENSHOTS_KV: KVNamespace;
  CRAWLER_LINKS_KV: KVNamespace;
  CRAWLER_BROWSER: BrowserWorker;
}

type Result = {
  numCloudflareLinks: number;
  screenshot: ArrayBuffer;
};

type KeyMetadata = {
  date: number;
};

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    // util endpoint for testing purposes
    await env.CRAWLER_QUEUE.send({ url: await req.text() });
    return new Response("Success!");
  },
  async queue(batch: MessageBatch<Message>, env: Env): Promise<void> {
    const crawlPage = async (url: string): Promise<Result> => {
      const page = await (browser as puppeteer.Browser).newPage();

      await page.goto(url, {
        waitUntil: "load",
      });

      const numCloudflareLinks = await page.$$eval("a", (links) => {
        links = links.filter((link) => {
          try {
            return new URL(link.href).hostname.includes("cloudflare.com");
          } catch {
            return false;
          }
        });
        return links.length;
      });

      // to crawl recursively - uncomment this!
      /*await page.$$eval("a", async (links) => {
        const urls: MessageSendRequest<Message>[] = links.map((link) => {
          return {
            body: {
              url: link.href,
            },
          };
        });
        try {
          await env.CRAWLER_QUEUE.sendBatch(urls);
        } catch {} // do nothing, might've hit subrequest limit
      });*/

      await page.setViewport({
        width: 1920,
        height: 1080,
        deviceScaleFactor: 1,
      });

      return {
        numCloudflareLinks,
        screenshot: ((await page.screenshot({ fullPage: true })) as Buffer)
          .buffer,
      };
    };

    let browser: puppeteer.Browser | null = null;
    try {
      browser = await puppeteer.launch(env.CRAWLER_BROWSER);
    } catch {
      batch.retryAll();
      return;
    }

    for (const message of batch.messages) {
      const { url } = message.body;
      const timestamp = new Date().getTime();
      const resultKey = `${encodeURIComponent(url)}-${timestamp}`;

      const sameUrlCrawls = await env.CRAWLER_LINKS_KV.list({
        prefix: `${encodeURIComponent(url)}`,
      });

      let shouldSkip = false;
      for (const key of sameUrlCrawls.keys) {
        if (timestamp - (key.metadata as KeyMetadata)?.date < 60 * 60 * 1000) {
          // if crawled in last hour, skip
          message.ack();
          shouldSkip = true;
          break;
        }
      }
      if (shouldSkip) {
        continue;
      }

      let isAllowed = true;
      try {
        const robotsTextPath = new URL(url).origin + "/robots.txt";
        const response = await fetch(robotsTextPath);

        const robots = robotsParser(robotsTextPath, await response.text());
        isAllowed = robots.isAllowed(url) ?? true; // respect robots.txt!
      } catch {}

      if (!isAllowed) {
        message.ack();
        continue;
      }

      try {
        const { numCloudflareLinks, screenshot } = await crawlPage(url);
        await env.CRAWLER_LINKS_KV.put(
          resultKey,
          numCloudflareLinks.toString(),
          { metadata: { date: timestamp } }
        );
        await env.CRAWLER_SCREENSHOTS_KV.put(resultKey, screenshot, {
          metadata: { date: timestamp },
        });
        message.ack();
      } catch {
        message.retry();
      }
    }

    await browser.close();
  },
};
